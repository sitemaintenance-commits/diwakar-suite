-- =====================================================================
-- A DAY THE PLANT DID NOT RUN IS STILL A DAY TO RECORD
--
-- The importer dropped every row with zero generation. Most of those are
-- right to drop -- a plant that was not commissioned yet, or a reading
-- nobody filed -- but not this:
--
--     2026-08-08  Niwai  0 kWh  "Plant Trip Failure"
--     2026-08-09  Niwai  0 kWh  "Plant Side Failure"
--     2026-08-10  Niwai  0 kWh  "Plant Side Failure"
--
-- Those are three days of downtime. Dropping them made the Shutdown and
-- Month Review pages under-report it, and left the days looking like a
-- reading was simply never filed.
--
-- Now a zero-generation row is:
--   * imported as a full day of downtime when its outage column names a
--     failure but carries no clock times -- the sheet's way of saying
--     "down all day". The hours are the peak sun hours (om.peak_sun_hours,
--     11), so it counts as exactly one shutdown day, split grid/plant by
--     the same words the window parser uses. The original text is kept in
--     the remarks.
--   * listed back as `needs_review` when it has clock times. Zero kWh with
--     a few minutes of grid failure is a missing reading, not a result, and
--     guessing would put a false zero into CUF.
--   * dropped as before otherwise.
-- =====================================================================

create or replace function public.import_om_generation(p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_skipped int := 0;
  v_ignored int := 0;
  v_failures int := 0;
  v_unknown text[] := '{}';
  v_review text[] := '{}';
  v_sites uuid[] := app.my_site_ids();
  v_peak numeric := coalesce(
    (select (value #>> '{}')::numeric from public.app_settings where key = 'om.peak_sun_hours'), 11);
  v_from date;
  v_to date;
  r record;
  v_site_id uuid;
  v_expected numeric;
  v_grid numeric;
  v_plant numeric;
  v_remarks text;
begin
  if not app.has_perm('om.generation', 'create') then
    raise exception 'Access denied: om.generation CREATE permission required to import readings.'
      using errcode = '42501';
  end if;

  create temporary table if not exists _imp_gen (
    gen_date date, site_name text, generation numeric, insolation numeric,
    windows jsonb, outage_text text, remarks text
  ) on commit drop;
  delete from _imp_gen where true;

  if jsonb_typeof(p_payload) = 'array' then
    insert into _imp_gen
    select nullif(x->>'date', '')::date,
           coalesce(nullif(x->>'short', ''), x->>'site'),
           nullif(x->>'generation', '')::numeric,
           nullif(nullif(x->>'insolation', '')::numeric, 0),
           app.parse_outage_windows(x->>'outage'),
           nullif(btrim(coalesce(x->>'outage', '')), ''),
           nullif(trim(coalesce(x->>'remarks', '')), '')
    from jsonb_array_elements(p_payload) x;
  else
    insert into _imp_gen
    select d.key::date,
           coalesce(nullif(x->>'short', ''), x->>'site'),
           nullif(x->>'generation', '')::numeric,
           nullif(nullif(x->>'insolation', '')::numeric, 0),
           app.parse_outage_windows(x->>'outage'),
           nullif(btrim(coalesce(x->>'outage', '')), ''),
           nullif(trim(coalesce(x->>'remarks', '')), '')
    from jsonb_each(coalesce(p_payload->'reports', '{}'::jsonb)) d,
         jsonb_array_elements(d.value) x;
  end if;

  delete from _imp_gen where gen_date is null or coalesce(generation, 0) < 0;

  -- Zero generation with no outage written against it: nothing happened
  -- that the suite can record.
  delete from _imp_gen
  where coalesce(generation, 0) = 0
    and (outage_text is null
         or lower(outage_text) in ('no', 'nil', 'none', 'na', 'n/a', '-'));

  select min(gen_date), max(gen_date) into v_from, v_to from _imp_gen;

  for r in select * from _imp_gen order by gen_date, site_name loop
    select s.id into v_site_id
    from public.sites s
    where lower(s.name) = lower(r.site_name)
       or lower(split_part(r.site_name, ' - ', 1)) = lower(s.name)
    limit 1;

    if v_site_id is null then
      v_ignored := v_ignored + 1;
      if not (r.site_name = any (v_unknown)) then
        v_unknown := v_unknown || r.site_name;
      end if;
      continue;
    end if;

    if not (v_site_id = any (v_sites)) then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    v_remarks := r.remarks;
    if coalesce(r.generation, 0) = 0 then
      if jsonb_array_length(r.windows) > 0 then
        -- Clock times but no energy: a reading that was never filed.
        v_review := v_review || (r.gen_date::text || ' ' || r.site_name);
        continue;
      end if;
      -- Down all day.
      if r.outage_text ~* '(grid|discom|feeder|jvvnl|avvnl|jdvvnl)'
         and r.outage_text !~* '(plant|trip|inverter)' then
        v_grid := v_peak;  v_plant := 0;
      else
        v_grid := 0;       v_plant := v_peak;
      end if;
      v_remarks := concat_ws(' · ', r.outage_text, r.remarks);
    else
      v_grid := app.outage_hours(r.windows, 'grid');
      v_plant := app.outage_hours(r.windows, 'plant');
    end if;

    if exists (select 1 from public.generation_records g
               where g.site_id = v_site_id and g.gen_date = r.gen_date and g.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if coalesce(r.generation, 0) = 0 then
      v_failures := v_failures + 1;
    end if;

    if p_dry_run then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    select round(ss.capacity_dc_kwp * ss.expected_yield, 3) into v_expected
    from public.solar_sites ss where ss.site_id = v_site_id;

    insert into public.generation_records
      (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
       grid_outage_hrs, plant_outage_hrs, outage_windows, remarks, source, created_by)
    values (v_site_id, r.gen_date, coalesce(r.generation, 0), v_expected, r.insolation,
            v_grid, v_plant, r.windows, v_remarks, 'legacy', auth.uid());
    v_inserted := v_inserted + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'om.generation', 'generation_records', null,
      format('Imported %s O&M reading(s) from the legacy dashboard', v_inserted),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                         'full_day_failures', v_failures, 'needs_review', to_jsonb(v_review),
                         'from', v_from, 'to', v_to));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'full_day_failures', v_failures, 'needs_review', to_jsonb(v_review),
                            'unknown_sites', to_jsonb(v_unknown), 'from', v_from, 'to', v_to,
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;
