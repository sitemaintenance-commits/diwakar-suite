-- =====================================================================
-- The importer's scratch table is emptied with a bare DELETE, which
-- pg_safeupdate rejects: "DELETE requires a WHERE clause". The table is
-- a per-session temporary one that is dropped on commit, so there was
-- never anything to guard against -- but the guard cannot tell, and a
-- project with safe updates on could not import at all.
--
-- Only this one statement changes. Everything else is the function as
-- 20260925000003 left it.
-- =====================================================================

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
  v_unknown text[] := '{}';
  v_sites uuid[] := app.my_site_ids();
  v_from date;
  v_to date;
  r record;
  v_site_id uuid;
  v_expected numeric;
begin
  if not app.has_perm('om.generation', 'create') then
    raise exception 'Access denied: om.generation CREATE permission required to import readings.'
      using errcode = '42501';
  end if;

  create temporary table if not exists _imp_gen (
    gen_date date, site_name text, generation numeric, insolation numeric,
    windows jsonb, remarks text
  ) on commit drop;
  delete from _imp_gen where true;

  if jsonb_typeof(p_payload) = 'array' then
    insert into _imp_gen
    select nullif(x->>'date', '')::date,
           coalesce(nullif(x->>'short', ''), x->>'site'),
           nullif(x->>'generation', '')::numeric,
           nullif(nullif(x->>'insolation', '')::numeric, 0),
           app.parse_outage_windows(x->>'outage'),
           nullif(trim(coalesce(x->>'remarks', '')), '')
    from jsonb_array_elements(p_payload) x;
  else
    insert into _imp_gen
    select d.key::date,
           coalesce(nullif(x->>'short', ''), x->>'site'),
           nullif(x->>'generation', '')::numeric,
           nullif(nullif(x->>'insolation', '')::numeric, 0),
           app.parse_outage_windows(x->>'outage'),
           nullif(trim(coalesce(x->>'remarks', '')), '')
    from jsonb_each(coalesce(p_payload->'reports', '{}'::jsonb)) d,
         jsonb_array_elements(d.value) x;
  end if;

  delete from _imp_gen where generation is null or generation <= 0 or gen_date is null;

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

    if exists (select 1 from public.generation_records g
               where g.site_id = v_site_id and g.gen_date = r.gen_date and g.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
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
    values (v_site_id, r.gen_date, r.generation, v_expected, r.insolation,
            app.outage_hours(r.windows, 'grid'), app.outage_hours(r.windows, 'plant'),
            r.windows, r.remarks, 'legacy', auth.uid());
    v_inserted := v_inserted + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'om.generation', 'generation_records', null,
      format('Imported %s O&M reading(s) from the legacy dashboard', v_inserted),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                         'ignored', v_ignored, 'from', v_from, 'to', v_to));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'unknown_sites', to_jsonb(v_unknown), 'from', v_from, 'to', v_to,
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;
