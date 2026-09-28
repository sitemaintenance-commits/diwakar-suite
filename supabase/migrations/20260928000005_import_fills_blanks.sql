-- =====================================================================
-- A SECOND IMPORT FILLS IN WHAT THE FIRST ONE LEFT OUT
--
-- Production was loaded on 26 Sep from om-generation-import.json: 2,596
-- readings, generation only (insolation for May-Aug). The fuller history
-- -- outage times, remarks, the rest of the insolation -- comes later, and
-- the importer used to skip every day already present, so none of it
-- could ever land.
--
-- A day that is already here is now handled like this:
--   * entered or corrected in the suite (source not 'legacy', or edited
--     since: updated_by set)  -> left exactly as it is, as before;
--   * written by an earlier import and untouched since -> its blanks are
--     filled: outage windows and hours if it has none, remarks if it has
--     none, insolation if it has none; an impossible stored insolation is
--     replaced, or cleared when there is nothing valid to put there;
--   * generation is never changed by an import.
--
-- Filling a row sets updated_by, so a re-run leaves it alone. The result
-- reports how many rows were filled ('filled').
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
  v_bad_ins text[] := '{}';
  v_suspect_pr text[] := '{}';
  v_max_ins numeric := app.max_insolation();
  v_dc numeric;
  v_filled int := 0;
  g record;
  v_set_ins numeric;
  v_set_out boolean;
  v_set_rem boolean;
  v_clear_ins boolean;
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

  -- An insolation above what the sun can deliver is a typo (44.77 for
  -- 4.477). The reading keeps its generation; the insolation becomes
  -- "not recorded" and is listed, rather than turning into a PR of 1,000%.
  select coalesce(array_agg(gen_date::text || ' ' || site_name || ': ' || insolation::text
                            order by gen_date, site_name), '{}')
    into v_bad_ins
  from _imp_gen where insolation > v_max_ins;
  update _imp_gen set insolation = null where insolation > v_max_ins;

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

    select * into g from public.generation_records x
    where x.site_id = v_site_id and x.gen_date = r.gen_date and x.deleted_at is null;

    if found then
      -- Already here. A reading somebody has entered or corrected in the
      -- suite is never touched. A row an earlier import wrote, and nobody
      -- has edited since, has its blanks filled: the first import carried
      -- generation only, so its outage times, remarks and most of its
      -- insolation never arrived. Generation itself is never changed.
      if g.source = 'legacy' and g.updated_by is null then
        v_set_ins := case when r.insolation is not null
                               and (g.irradiation_kwh_m2 is null or g.irradiation_kwh_m2 > v_max_ins)
                          then r.insolation end;
        -- An impossible stored insolation goes even when there is nothing
        -- valid to replace it with: not recorded beats a PR of 1,000%.
        v_clear_ins := v_set_ins is null and g.irradiation_kwh_m2 > v_max_ins;
        v_set_out := jsonb_array_length(coalesce(g.outage_windows, '[]'::jsonb)) = 0
                     and g.grid_outage_hrs + g.plant_outage_hrs = 0
                     and (jsonb_array_length(r.windows) > 0 or v_grid + v_plant > 0);
        v_set_rem := g.remarks is null and v_remarks is not null;

        -- The PR check covers the stored reading too, with the insolation
        -- it will end up holding.
        select ss.capacity_dc_kwp into v_dc from public.solar_sites ss where ss.site_id = v_site_id;
        if v_dc > 0 and not v_clear_ins and coalesce(v_set_ins, g.irradiation_kwh_m2) > 0
           and g.generation_kwh / (coalesce(v_set_ins, g.irradiation_kwh_m2) * v_dc) > 1 then
          v_suspect_pr := v_suspect_pr || (r.gen_date::text || ' ' || r.site_name || ': PR '
                          || round(100 * g.generation_kwh / (coalesce(v_set_ins, g.irradiation_kwh_m2) * v_dc))::text || '%');
        end if;
        if v_set_ins is not null or v_clear_ins or v_set_out or v_set_rem then
          v_filled := v_filled + 1;
          if not p_dry_run then
            update public.generation_records x
            set irradiation_kwh_m2 = case when v_clear_ins then null else coalesce(v_set_ins, x.irradiation_kwh_m2) end,
                outage_windows     = case when v_set_out then r.windows else x.outage_windows end,
                grid_outage_hrs    = case when v_set_out then v_grid else x.grid_outage_hrs end,
                plant_outage_hrs   = case when v_set_out then v_plant else x.plant_outage_hrs end,
                remarks            = case when v_set_rem then v_remarks else x.remarks end
            where x.id = g.id;
          end if;
          continue;
        end if;
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if coalesce(r.generation, 0) = 0 then
      v_failures := v_failures + 1;
    end if;

    select round(ss.capacity_dc_kwp * ss.expected_yield, 3), ss.capacity_dc_kwp into v_expected, v_dc
    from public.solar_sites ss where ss.site_id = v_site_id;

    -- A PR over 100% means the insolation or the generation is wrong.
    -- Both are kept as the sheet has them; the day is listed for a look --
    -- in a dry run too, so it can be checked before anything is written.
    if v_dc > 0 and r.insolation > 0 and r.generation / (r.insolation * v_dc) > 1 then
      v_suspect_pr := v_suspect_pr || (r.gen_date::text || ' ' || r.site_name || ': PR '
                      || round(100 * r.generation / (r.insolation * v_dc))::text || '%');
    end if;

    if p_dry_run then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    insert into public.generation_records
      (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
       grid_outage_hrs, plant_outage_hrs, outage_windows, remarks, source, created_by)
    values (v_site_id, r.gen_date, coalesce(r.generation, 0), v_expected, r.insolation,
            v_grid, v_plant, r.windows, v_remarks, 'legacy', auth.uid());
    v_inserted := v_inserted + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'om.generation', 'generation_records', null,
      format('Imported %s O&M reading(s) and filled in %s from the legacy dashboard', v_inserted, v_filled),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                         'full_day_failures', v_failures, 'needs_review', to_jsonb(v_review),
                         'filled', v_filled, 'insolation_rejected', to_jsonb(v_bad_ins), 'suspect_pr', to_jsonb(v_suspect_pr),
                         'from', v_from, 'to', v_to));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'full_day_failures', v_failures, 'needs_review', to_jsonb(v_review),
                            'filled', v_filled, 'insolation_rejected', to_jsonb(v_bad_ins), 'suspect_pr', to_jsonb(v_suspect_pr),
                            'unknown_sites', to_jsonb(v_unknown), 'from', v_from, 'to', v_to,
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;
