-- =====================================================================
-- O&M FIELD ENTRY — replaces the technician Google Form
--
-- The existing O&M CRM collects one row per site per day through a
-- Google Form with exactly these fields:
--     Date · Site · Insolation · Grid Outage · INV-01 … INV-12 · Remarks
-- and totals the inverter readings into the day's generation. The sheet
-- is then synced into the dashboard, which derives PR, DC CUF, AC CUF
-- and specific yield.
--
-- This migration brings that form into the suite: technicians submit it
-- directly (seeing only their own sites and only these fields), and the
-- O&M head sees the result immediately — no form, no sheet, no sync.
-- =====================================================================

-- Per-inverter readings, kept next to the day's totals.
alter table public.generation_records
  add column inverter_readings jsonb not null default '[]'::jsonb;   -- [{label, kwh}]

comment on column public.generation_records.inverter_readings is
  'Per-inverter readings as entered in the field; generation_kwh is their sum.';

-- Plant facts the dashboard needs.
alter table public.solar_sites add column tilt_degrees numeric(5,2);
alter table public.solar_sites add column stage text not null default 'commissioned';  -- design / installation / commissioned

-- ---------------------------------------------------------------------
-- The real portfolio (from the company's own O&M and Project dashboards)
-- ---------------------------------------------------------------------
-- "Phalodi" was a placeholder; the two Phalodi plants are Suaap and
-- Indo Ka Bas, so the placeholder becomes Indo Ka Bas.
update public.sites set name = 'Indo Ka Bas', code = 'INDOKABAS', district = 'Phalodi' where name = 'Phalodi';

insert into public.sites (code, name, district, state, status)
values
  ('BUDSU', 'Budsu', 'Kuchaman', 'Rajasthan', 'active'),
  ('JERTHI', 'Jerthi', 'Sikar', 'Rajasthan', 'active'),
  ('NIWAI', 'Niwai', 'Tonk', 'Rajasthan', 'active'),
  ('GANESHGARH', 'Ganeshgarh', 'Sri Ganganagar', 'Rajasthan', 'active'),
  ('BUDHWARA', 'Budhwara', 'Pisangan', 'Rajasthan', 'active'),
  ('KADEL', 'Kadel', 'Pushkar', 'Rajasthan', 'active'),
  ('BHOJUSAR', 'Bhojusar', null, 'Rajasthan', 'active'),
  ('DEEGOD', 'Deegod', null, 'Rajasthan', 'active')
on conflict (name) do nothing;

update public.sites s set district = v.district, state = 'Rajasthan', capacity_kwp = v.dc
from (values
  ('Sadas', 'Chittorgarh', 2903), ('Suaap', 'Phalodi', 3305), ('Bassi', 'Sikar', 4418),
  ('Budsu', 'Kuchaman', 2438), ('Jerthi', 'Sikar', 3496), ('Niwai', 'Tonk', 2640),
  ('Indo Ka Bas', 'Phalodi', 3274), ('Ganeshgarh', 'Sri Ganganagar', 3272),
  ('Budhwara', 'Pisangan', 4340), ('Kadel', 'Pushkar', 3124), ('Thikariya', 'Reengus', 4473),
  ('Bhojusar', null, 3280), ('Deegod', null, 0)
) as v(name, district, dc)
where s.name = v.name;

insert into public.solar_sites (site_id, capacity_dc_kwp, capacity_ac_kw, tilt_degrees, inverter_count, stage, monitoring_source)
select s.id, v.dc, v.ac, v.tilt, 12, v.stage, 'manual'
from (values
  ('Sadas', 2903, 2065, 22, 'commissioned'), ('Suaap', 3305, 2700, 22, 'commissioned'),
  ('Bassi', 4418, 3300, 8, 'commissioned'), ('Budsu', 2438, 1925, 8, 'commissioned'),
  ('Jerthi', 3496, 2750, 8, 'commissioned'), ('Niwai', 2640, 2200, 8, 'commissioned'),
  ('Indo Ka Bas', 3274, 2475, 22, 'commissioned'), ('Ganeshgarh', 3272, 2475, 22, 'commissioned'),
  ('Budhwara', 4340, 3300, 8, 'commissioned'), ('Kadel', 3124, 2475, 8, 'commissioned'),
  ('Thikariya', 4473, 3300, 8, 'commissioned'), ('Bhojusar', 3280, 2520, 8, 'installation'),
  ('Deegod', 0, 0, null, 'design')
) as v(name, dc, ac, tilt, stage)
join public.sites s on s.name = v.name
on conflict (site_id) do update
  set capacity_dc_kwp = excluded.capacity_dc_kwp,
      capacity_ac_kw = excluded.capacity_ac_kw,
      tilt_degrees = excluded.tilt_degrees,
      inverter_count = coalesce(public.solar_sites.inverter_count, excluded.inverter_count),
      stage = excluded.stage;

-- ---------------------------------------------------------------------
-- The field entry itself.
-- SECURITY INVOKER: a technician can only write for a site they are
-- assigned to, because the INSERT/UPDATE policy on generation_records
-- checks site access. Totals are computed here, never sent by the client.
-- ---------------------------------------------------------------------
create or replace function public.save_field_entry(
  p_site_id uuid,
  p_date date,
  p_readings jsonb,                      -- [{"label":"INV-01","kwh":1234.5}, ...]
  p_insolation numeric default null,
  p_grid_outage numeric default 0,
  p_plant_outage numeric default 0,
  p_remarks text default null)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_total numeric(14,3);
  v_expected numeric(14,3);
  v_id uuid;
begin
  if p_site_id is null or p_date is null then
    raise exception 'Site and date are required.' using errcode = '22023';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot record a reading for a future date.' using errcode = '22023';
  end if;

  select coalesce(sum(greatest(r.kwh, 0)), 0) into v_total
  from jsonb_to_recordset(coalesce(p_readings, '[]'::jsonb)) r(label text, kwh numeric);

  select round(ss.capacity_dc_kwp * ss.expected_yield, 3) into v_expected
  from public.solar_sites ss where ss.site_id = p_site_id;

  insert into public.generation_records
    (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
     grid_outage_hrs, plant_outage_hrs, remarks, inverter_readings, source)
  values (p_site_id, p_date, v_total, v_expected, p_insolation,
          coalesce(p_grid_outage, 0), coalesce(p_plant_outage, 0), nullif(trim(coalesce(p_remarks, '')), ''),
          coalesce(p_readings, '[]'::jsonb), 'field')
  on conflict (site_id, gen_date) do update
    set generation_kwh = excluded.generation_kwh,
        expected_kwh = coalesce(public.generation_records.expected_kwh, excluded.expected_kwh),
        irradiation_kwh_m2 = excluded.irradiation_kwh_m2,
        grid_outage_hrs = excluded.grid_outage_hrs,
        plant_outage_hrs = excluded.plant_outage_hrs,
        remarks = excluded.remarks,
        inverter_readings = excluded.inverter_readings,
        source = 'field'
  returning id into v_id;

  if v_id is null then
    raise exception 'You do not have access to this site.' using errcode = '42501';
  end if;

  return jsonb_build_object('id', v_id, 'generation_kwh', v_total, 'date', p_date);
end;
$$;

grant execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text) to authenticated;
revoke execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text) from anon, public;

-- What a technician needs to open the form: their sites, the inverter
-- labels for each, and what they already submitted for the chosen day.
create or replace function public.get_field_entry(p_date date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
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
                    'remarks', g.remarks, 'readings', g.inverter_readings, 'source', g.source)
                  from public.generation_records g
                  where g.site_id = s.id and g.gen_date = v_date and g.deleted_at is null))
        order by s.name)
      from public.sites s
      left join public.solar_sites ss on ss.site_id = s.id
      where s.status = 'active'), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', g.gen_date, 'site', s.name, 'generation_kwh', g.generation_kwh, 'source', g.source)
        order by g.gen_date desc, s.name)
      from public.generation_records g join public.sites s on s.id = g.site_id
      where g.gen_date >= v_date - 7 and g.deleted_at is null), '[]'::jsonb));
end;
$$;

grant execute on function public.get_field_entry(date) to authenticated;
revoke execute on function public.get_field_entry(date) from anon, public;

-- ---------------------------------------------------------------------
-- A module of its own, so a technician's menu can contain just this.
-- ---------------------------------------------------------------------
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'om.daily_entry', 'Daily Entry',
       'The field form technicians fill in for their site each day',
       '/operations/daily-entry', 'ClipboardList', 5,
       '{view,create,edit}'::public.perm_action[], true, true, true, true, 4
from public.module_groups g where g.key = 'operations'
on conflict (key) do nothing;

do $$
declare
  v_entry uuid := (select id from public.modules where key = 'om.daily_entry');
  v_gen uuid := (select id from public.modules where key = 'om.generation');
begin
  -- Technicians: the form, their own entries, nothing else new.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_entry, a, 'all'          -- "all" here still means "their sites only"
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key = 'technician'
  on conflict do nothing;

  -- The O&M head, admins and management see the same data.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_entry, a, 'all'
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key in ('om_manager', 'admin')
  on conflict do nothing;

  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_entry, 'view', 'all' from public.roles r where r.key = 'management'
  on conflict do nothing;

  -- A technician filling the form also needs to write the generation row.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_gen, a, 'all'
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key = 'technician'
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Monitoring: add the figures the existing dashboard shows
-- (AC CUF, specific yield, insolation) alongside DC CUF and PR.
-- ---------------------------------------------------------------------
create or replace function public.get_generation_summary(p_from date default null, p_to date default null, p_site uuid default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from date := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to date := coalesce(p_to, v_today);
  v jsonb;
begin
  if not public.has_permission('om.monitor', 'view') and not public.has_permission('om.generation', 'view') then
    return '{}'::jsonb;
  end if;

  with sites as (
    select s.id, s.name, s.capacity_kwp,
           coalesce(ss.capacity_ac_kw, s.capacity_kwp) as capacity_ac,
           coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as capacity_dc,
           ss.expected_yield, ss.tilt_degrees
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and (p_site is null or s.id = p_site)
  ),
  gen as (
    select g.site_id, g.gen_date, g.generation_kwh, g.expected_kwh, g.irradiation_kwh_m2,
           g.grid_outage_hrs, g.plant_outage_hrs
    from public.generation_records g
    where (p_site is null or g.site_id = p_site) and g.deleted_at is null
  ),
  totals as (
    select coalesce((select sum(capacity_dc) from sites), 0) as cap_dc,
           coalesce((select sum(capacity_ac) from sites), 0) as cap_ac,
           (v_to - v_from + 1) as days,
           coalesce((select sum(generation_kwh) from gen where gen_date between v_from and v_to), 0) as energy
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'has_data', exists (select 1 from gen),
    'today',       coalesce((select sum(generation_kwh) from gen where gen_date = v_today), 0),
    'yesterday',   coalesce((select sum(generation_kwh) from gen where gen_date = v_today - 1), 0),
    'month',       coalesce((select sum(generation_kwh) from gen where gen_date >= date_trunc('month', v_today)::date and gen_date <= v_today), 0),
    'year',        coalesce((select sum(generation_kwh) from gen where gen_date >= date_trunc('year', v_today)::date and gen_date <= v_today), 0),
    'period',      (select energy from totals),
    'expected_period', (select sum(expected_kwh) from gen where gen_date between v_from and v_to),
    'capacity_kwp', (select cap_dc from totals),
    'capacity_ac_kw', (select cap_ac from totals),
    'site_count',   coalesce((select count(*) from sites), 0),
    'cuf', (select case when cap_dc > 0 and days > 0 and energy > 0
                        then round(100 * energy / (cap_dc * days * 24), 2) end from totals),
    'ac_cuf', (select case when cap_ac > 0 and days > 0 and energy > 0
                        then round(100 * energy / (cap_ac * days * 24), 2) end from totals),
    'specific_yield', (select case when cap_dc > 0 and energy > 0 then round(energy / cap_dc, 2) end from totals),
    'pr', (
      select case when sum(g.irradiation_kwh_m2 * s.capacity_dc) > 0
                  then round(100 * sum(g.generation_kwh) / sum(g.irradiation_kwh_m2 * s.capacity_dc), 2) end
      from gen g join sites s on s.id = g.site_id
      where g.gen_date between v_from and v_to and g.irradiation_kwh_m2 is not null),
    'insolation', (select round(avg(irradiation_kwh_m2), 2) from gen
                   where gen_date between v_from and v_to and irradiation_kwh_m2 is not null),
    'plant_availability', (
      select case when count(*) > 0 then round(100 * (1 - sum(plant_outage_hrs) / (count(*) * 24.0)), 2) end
      from gen where gen_date between v_from and v_to),
    'grid_availability', (
      select case when count(*) > 0 then round(100 * (1 - sum(grid_outage_hrs) / (count(*) * 24.0)), 2) end
      from gen where gen_date between v_from and v_to),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'site_id', s.id, 'name', s.name, 'capacity_kwp', s.capacity_dc, 'capacity_ac_kw', s.capacity_ac,
        'tilt', s.tilt_degrees,
        'today', coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date = v_today), 0),
        'month', coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date >= date_trunc('month', v_today)::date), 0),
        'period', coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date between v_from and v_to), 0),
        'expected_period', (select sum(expected_kwh) from gen where site_id = s.id and gen_date between v_from and v_to),
        'specific_yield', case when s.capacity_dc > 0
                               then round(coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date between v_from and v_to), 0) / s.capacity_dc, 2) end,
        'pr', (select case when sum(g.irradiation_kwh_m2) > 0 and s.capacity_dc > 0
                           then round(100 * sum(g.generation_kwh) / (sum(g.irradiation_kwh_m2) * s.capacity_dc), 2) end
               from gen g where g.site_id = s.id and g.gen_date between v_from and v_to and g.irradiation_kwh_m2 is not null),
        'grid_outage', coalesce((select sum(grid_outage_hrs) from gen where site_id = s.id and gen_date between v_from and v_to), 0),
        'last_reading', (select max(gen_date) from gen where site_id = s.id),
        'open_tickets', coalesce((select count(*) from public.maintenance_tickets t
                                  where t.site_id = s.id and t.status not in ('resolved','closed') and t.deleted_at is null), 0))
        order by s.name)
      from sites s), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.gen_date, 'kwh', d.kwh, 'expected', d.expected) order by d.gen_date)
      from (select gen_date, sum(generation_kwh) as kwh, sum(expected_kwh) as expected
            from gen where gen_date between v_from and v_to group by gen_date) d), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

grant execute on function public.get_generation_summary(date, date, uuid) to authenticated;
