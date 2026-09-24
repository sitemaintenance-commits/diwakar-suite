-- =====================================================================
-- TECHNICIAN SCOPE
--
-- A technician should log in and see the form, not the system. So the
-- field-entry functions carry their own authorisation (the caller must
-- hold om.daily_entry and be assigned to the site) instead of requiring
-- the wider Generation permission, and the default Technician role is
-- trimmed to: Dashboard · Daily Entry · Tickets (their own).
--
-- None of this is hard-coded: Super Admin can widen or narrow the role
-- in Role Management at any time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Field entry, self-authorising.
-- SECURITY DEFINER so a technician needs no direct rights on
-- generation_records; the checks below are the whole authorisation:
--   * the module permission (view / create / edit on om.daily_entry)
--   * the site must be one of app.my_site_ids()
-- ---------------------------------------------------------------------
create or replace function public.save_field_entry(
  p_site_id uuid,
  p_date date,
  p_readings jsonb,
  p_insolation numeric default null,
  p_grid_outage numeric default 0,
  p_plant_outage numeric default 0,
  p_remarks text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total numeric(14,3);
  v_expected numeric(14,3);
  v_id uuid;
  v_exists boolean;
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

  select coalesce(sum(greatest(r.kwh, 0)), 0) into v_total
  from jsonb_to_recordset(coalesce(p_readings, '[]'::jsonb)) r(label text, kwh numeric);

  select round(ss.capacity_dc_kwp * ss.expected_yield, 3) into v_expected
  from public.solar_sites ss where ss.site_id = p_site_id;

  insert into public.generation_records
    (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
     grid_outage_hrs, plant_outage_hrs, remarks, inverter_readings, source, created_by)
  values (p_site_id, p_date, v_total, v_expected, p_insolation,
          coalesce(p_grid_outage, 0), coalesce(p_plant_outage, 0), nullif(trim(coalesce(p_remarks, '')), ''),
          coalesce(p_readings, '[]'::jsonb), 'field', auth.uid())
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

  return jsonb_build_object('id', v_id, 'generation_kwh', v_total, 'date', p_date);
end;
$$;

-- The form's own data, limited to the caller's sites in the query itself.
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

grant execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.get_field_entry(date) to authenticated;
revoke execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text),
                        public.get_field_entry(date) from anon, public;

-- ---------------------------------------------------------------------
-- Trim the default Technician role to the field job.
-- ---------------------------------------------------------------------
delete from public.role_permissions rp
using public.roles r, public.modules m
where rp.role_id = r.id and rp.module_id = m.id
  and r.key = 'technician'
  and m.key in ('om.sites', 'om.monitor', 'om.generation', 'om.maintenance', 'om.equipment', 'tasks', 'daily.reports');

do $$
declare
  v_entry uuid := (select id from public.modules where key = 'om.daily_entry');
  v_tickets uuid := (select id from public.modules where key = 'om.tickets');
  v_role uuid := (select id from public.roles where key = 'technician');
begin
  -- The form.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select v_role, v_entry, a, 'all'
  from unnest(array['view','create','edit']::public.perm_action[]) a
  on conflict (role_id, module_id, action) do update set scope = excluded.scope;

  -- Raising and updating their own breakdown tickets stays with them.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select v_role, v_tickets, a, 'own'
  from unnest(array['view','create','edit']::public.perm_action[]) a
  on conflict (role_id, module_id, action) do update set scope = excluded.scope;
end $$;
