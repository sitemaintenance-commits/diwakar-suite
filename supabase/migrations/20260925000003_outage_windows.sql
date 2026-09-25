-- =====================================================================
-- OUTAGE WINDOWS
--
-- The O&M team does not record "0.22 hours". They record when the plant
-- was down:
--
--     Grid Failure :-
--     18:10 - 18:23
--     Plant Trip :-
--     11:46 - 12:10
--
-- Until now the suite asked for a decimal and the importer threw the
-- windows away after adding them up. Two things were lost: WHEN the
-- outage happened, and whether it was the grid or the plant.
--
-- Now the windows are the record. The hours are derived from them, so
-- the two can never disagree, and a reading can still be entered as a
-- plain number where nobody wrote the times down.
-- =====================================================================

alter table public.generation_records
  add column if not exists outage_windows jsonb not null default '[]'::jsonb;

comment on column public.generation_records.outage_windows is
  'Each window the plant was down: [{kind: grid|plant, from: "HH:MM", to: "HH:MM"}]. '
  'grid_outage_hrs and plant_outage_hrs are derived from this when it is present.';

-- ---------------------------------------------------------------------
-- Hours for one kind of outage, or for all of them.
--
-- A window that ends before it starts is a typo, not a night shift:
-- it contributes nothing rather than a negative.
-- ---------------------------------------------------------------------
create or replace function app.outage_hours(p_windows jsonb, p_kind text default null)
returns numeric
language sql immutable
set search_path = ''
as $$
  select coalesce(round(sum(greatest(
             (split_part(w."to", ':', 1)::int * 60 + split_part(w."to", ':', 2)::int)
           - (split_part(w."from", ':', 1)::int * 60 + split_part(w."from", ':', 2)::int),
           0))::numeric / 60, 2), 0)
  from jsonb_to_recordset(coalesce(p_windows, '[]'::jsonb)) w(kind text, "from" text, "to" text)
  where w."from" ~ '^\d{1,2}:\d{2}$' and w."to" ~ '^\d{1,2}:\d{2}$'
    and (p_kind is null or coalesce(w.kind, 'grid') = p_kind);
$$;

-- ---------------------------------------------------------------------
-- Turn the sheet's free text into windows.
--
-- A line naming the plant switches the windows below it to 'plant';
-- anything else belongs to the grid, which is the common case. Both
-- hyphens and en dashes are accepted, because both are used.
-- ---------------------------------------------------------------------
create or replace function app.parse_outage_windows(p_text text)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_kind text := 'grid';
  v_out jsonb := '[]'::jsonb;
  ln text;
  m text[];
begin
  if p_text is null or btrim(p_text) = ''
     or lower(btrim(p_text)) in ('no', 'nil', 'none', 'na', 'n/a', '-') then
    return '[]'::jsonb;
  end if;

  for ln in select regexp_split_to_table(p_text, E'\n') loop
    if ln ~* '(plant|trip|inverter)' then
      v_kind := 'plant';
    elsif ln ~* '(grid|discom|feeder|jvvnl|avvnl|jdvvnl)' then
      v_kind := 'grid';
    end if;

    for m in
      select regexp_matches(ln, '(\d{1,2}):(\d{2})\s*[-‐-―]\s*(\d{1,2}):(\d{2})', 'g')
    loop
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'kind', v_kind,
        'from', lpad(m[1], 2, '0') || ':' || m[2],
        'to',   lpad(m[3], 2, '0') || ':' || m[4]));
    end loop;
  end loop;

  return v_out;
end;
$$;

-- The old text parser now delegates, so there is one definition of what
-- an outage window is.
create or replace function app.parse_outage_hours(p_text text)
returns numeric
language sql immutable
set search_path = ''
as $$
  select app.outage_hours(app.parse_outage_windows(p_text));
$$;

-- =====================================================================
-- The field form now accepts windows. Hours stay accepted for a site
-- that only writes a total, so nothing that already works breaks.
-- =====================================================================
drop function if exists public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text);

create or replace function public.save_field_entry(
  p_site_id uuid,
  p_date date,
  p_readings jsonb,
  p_insolation numeric default null,
  p_grid_outage numeric default 0,
  p_plant_outage numeric default 0,
  p_remarks text default null,
  p_outage_windows jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total numeric(14,3);
  v_expected numeric(14,3);
  v_id uuid;
  v_exists boolean;
  v_windows jsonb := coalesce(p_outage_windows, '[]'::jsonb);
  v_grid numeric;
  v_plant numeric;
begin
  if p_site_id is null or p_date is null then
    raise exception 'Site and date are required.' using errcode = '22023';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot record a reading for a future date.' using errcode = '22023';
  end if;
  if not app.can_access_site(p_site_id) then
    raise exception 'You are not assigned to this site.' using errcode = '42501';
  end if;

  select exists (select 1 from public.generation_records
                 where site_id = p_site_id and gen_date = p_date and deleted_at is null)
    into v_exists;

  if v_exists then
    if not (app.has_perm('om.daily_entry', 'edit') or app.has_perm('om.generation', 'edit')) then
      raise exception 'You do not have permission to change a saved entry.' using errcode = '42501';
    end if;
  else
    if not (app.has_perm('om.daily_entry', 'create') or app.has_perm('om.generation', 'create')) then
      raise exception 'You do not have permission to record readings.' using errcode = '42501';
    end if;
  end if;

  -- Windows win where they were given: the hours are then a consequence
  -- of the record rather than a second number to keep in step.
  if jsonb_array_length(v_windows) > 0 then
    v_grid := app.outage_hours(v_windows, 'grid');
    v_plant := app.outage_hours(v_windows, 'plant');
  else
    v_grid := coalesce(p_grid_outage, 0);
    v_plant := coalesce(p_plant_outage, 0);
  end if;

  select coalesce(sum(greatest(r.kwh, 0)), 0) into v_total
  from jsonb_to_recordset(coalesce(p_readings, '[]'::jsonb)) r(label text, kwh numeric);

  select round(ss.capacity_dc_kwp * ss.expected_yield, 3) into v_expected
  from public.solar_sites ss where ss.site_id = p_site_id;

  insert into public.generation_records
    (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
     grid_outage_hrs, plant_outage_hrs, outage_windows, remarks, inverter_readings, source, created_by)
  values (p_site_id, p_date, v_total, v_expected, p_insolation,
          v_grid, v_plant, v_windows, nullif(trim(coalesce(p_remarks, '')), ''),
          coalesce(p_readings, '[]'::jsonb), 'field', auth.uid())
  on conflict (site_id, gen_date) do update
    set generation_kwh = excluded.generation_kwh,
        expected_kwh = coalesce(public.generation_records.expected_kwh, excluded.expected_kwh),
        irradiation_kwh_m2 = excluded.irradiation_kwh_m2,
        grid_outage_hrs = excluded.grid_outage_hrs,
        plant_outage_hrs = excluded.plant_outage_hrs,
        outage_windows = excluded.outage_windows,
        remarks = excluded.remarks,
        inverter_readings = excluded.inverter_readings,
        source = 'field'
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'generation_kwh', v_total, 'date', p_date,
                            'grid_outage_hrs', v_grid, 'plant_outage_hrs', v_plant);
end;
$$;

grant execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text, jsonb) to authenticated;
revoke execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text, jsonb)
  from anon, public;

-- The form needs the windows back when it reloads a day.
create or replace function public.get_field_entry(p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_sites uuid[] := app.my_site_ids();
begin
  if not (app.has_perm('om.daily_entry', 'view') or app.has_perm('om.generation', 'view')) then
    raise exception 'Access denied: om.daily_entry VIEW permission required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'date', v_date,
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'site_id', s.id,
        'name', s.name,
        'location', coalesce(s.district, s.location),
        'capacity_dc_kwp', coalesce(ss.capacity_dc_kwp, s.capacity_kwp),
        'inverter_count', coalesce(ss.inverter_count, 12),
        'stage', coalesce(ss.stage, 'commissioned'),
        'entry', (select jsonb_build_object(
                    'id', g.id, 'generation_kwh', g.generation_kwh, 'irradiation', g.irradiation_kwh_m2,
                    'grid_outage_hrs', g.grid_outage_hrs, 'plant_outage_hrs', g.plant_outage_hrs,
                    'outage_windows', g.outage_windows,
                    'remarks', g.remarks, 'readings', g.inverter_readings, 'source', g.source)
                  from public.generation_records g
                  where g.site_id = s.id and g.gen_date = v_date and g.deleted_at is null))
        order by s.name)
      from public.sites s
      left join public.solar_sites ss on ss.site_id = s.id
      where s.status = 'active' and s.id = any (v_sites)), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', g.gen_date, 'site', s.name, 'generation_kwh', g.generation_kwh, 'source', g.source)
        order by g.gen_date desc, s.name)
      from public.generation_records g join public.sites s on s.id = g.site_id
      where g.gen_date >= v_date - 7 and g.deleted_at is null and g.site_id = any (v_sites)), '[]'::jsonb));
end;
$$;

-- =====================================================================
-- The importer keeps the windows instead of flattening them, and splits
-- grid from plant the way the sheet labels them.
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
  delete from _imp_gen;

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
