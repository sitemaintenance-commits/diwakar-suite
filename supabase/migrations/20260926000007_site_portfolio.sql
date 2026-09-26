-- =====================================================================
-- SOLAR SITES — A PORTFOLIO VIEW THAT IS NOT PART OF O&M
--
-- Two changes that go together:
--
--  * "Solar Sites" inside O&M is the technical register -- capacity,
--    inverters, DISCOM, tariff. It is renamed "Generation Sites",
--    which is what it actually is.
--
--  * "Solar Sites" becomes a section of its own at the top of the
--    sidebar, next to Dashboard: every plant on one screen, what each
--    generated today and this month, and anything wanting attention.
--    Someone running the company should not have to go into O&M to see
--    whether the plants are running.
--
-- It is a separate module with its own permission, so leadership can be
-- given the overview without being given the O&M section. A group whose
-- single module shares its label renders flat in the sidebar, which is
-- how Dashboard sits there, so this sits the same way.
-- =====================================================================

update public.modules
set label = 'Generation Sites',
    description = 'Plant technical register: capacity, inverters, DISCOM and tariff',
    updated_at = now()
where key = 'om.sites';

insert into public.module_groups (key, label, icon, sort_order)
values ('portfolio', 'Solar Sites', 'SunMedium', 5)
on conflict (key) do update
  set label = excluded.label, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'sites.overview', 'Solar Sites',
       'Every plant on one screen: today, this month, and what needs attention',
       '/solar-sites', 'SunMedium', 10,
       '{view,export}'::public.perm_action[], true, true, true, true, 4
from public.module_groups g where g.key = 'portfolio'
on conflict (key) do update
  set group_id = excluded.group_id, label = excluded.label, route = excluded.route,
      show_in_nav = true, is_enabled = true, updated_at = now();

-- Who sees it. Super Admin needs no grant; everyone else does.
do $$
declare
  v_mod uuid := (select id from public.modules where key = 'sites.overview');
begin
  -- Leadership and administration see every plant.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_mod, a, 'all'::public.perm_scope
  from public.roles r, unnest(array['view','export']::public.perm_action[]) a
  where r.key in ('admin', 'management')
  on conflict do nothing;

  -- An O&M manager sees the plants they are assigned to, and nothing else.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_mod, 'view'::public.perm_action, 'all'::public.perm_scope
  from public.roles r where r.key = 'om_manager'
  on conflict do nothing;
end $$;


-- ---------------------------------------------------------------------
-- The overview itself.
--
-- SECURITY DEFINER, so it has to apply the site scope itself: it reads
-- app.my_site_ids() exactly as the table policies would, and a caller
-- assigned to one plant sees one plant.
-- ---------------------------------------------------------------------
create or replace function public.get_site_portfolio(p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date  date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_from  date := date_trunc('month', v_date)::date;
  v_sites uuid[] := app.my_site_ids();
  v_rows  jsonb;
begin
  if not app.has_perm('sites.overview', 'view') then
    raise exception 'Access denied: sites.overview VIEW permission required.'
      using errcode = '42501';
  end if;

  with mine as (
    select s.id, s.name, s.code, coalesce(s.district, s.location) as location,
           s.status,
           coalesce(ss.capacity_dc_kwp, 0) as dc,
           coalesce(ss.capacity_ac_kw, 0)  as ac,
           ss.commissioning_date, ss.stage, ss.inverter_count
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.id = any (v_sites) and coalesce(ss.capacity_dc_kwp, 0) > 0
  ),
  today as (
    select g.site_id, sum(g.generation_kwh) as kwh
    from public.generation_records g
    where g.deleted_at is null and g.gen_date = v_date
    group by g.site_id
  ),
  mtd as (
    select g.site_id,
           sum(g.generation_kwh) as kwh,
           count(*) as days,
           max(g.gen_date) as last_day
    from public.generation_records g
    where g.deleted_at is null and g.gen_date between v_from and v_date
    group by g.site_id
  ),
  tick as (
    select t.site_id,
           count(*) filter (where t.status not in ('resolved', 'closed')) as open_tickets,
           count(*) filter (where t.status not in ('resolved', 'closed')
                              and t.priority = 'critical') as critical_tickets
    from public.maintenance_tickets t
    where t.deleted_at is null
    group by t.site_id
  )
  select jsonb_agg(jsonb_build_object(
           'site_id', m.id, 'name', m.name, 'code', m.code, 'location', m.location,
           'status', m.status, 'stage', m.stage,
           'capacity_dc_kwp', m.dc, 'capacity_ac_kw', m.ac,
           'inverter_count', m.inverter_count,
           'commissioning_date', m.commissioning_date,
           'today_kwh', coalesce(t.kwh, 0),
           'month_kwh', coalesce(mt.kwh, 0),
           'days_reported', coalesce(mt.days, 0),
           'last_reading', mt.last_day,
           -- CUF over the days actually reported, so a half-filled month
           -- does not read as a collapse in output.
           'month_cuf', case when coalesce(mt.days, 0) > 0 and m.dc > 0
                             then round((mt.kwh / (m.dc * 24 * mt.days) * 100)::numeric, 2) end,
           'specific_yield', case when coalesce(mt.days, 0) > 0 and m.dc > 0
                                  then round((mt.kwh / mt.days / m.dc)::numeric, 2) end,
           'reported_today', (t.kwh is not null),
           'open_tickets', coalesce(tk.open_tickets, 0),
           'critical_tickets', coalesce(tk.critical_tickets, 0))
         order by m.name)
    into v_rows
  from mine m
  left join today t  on t.site_id  = m.id
  left join mtd   mt on mt.site_id = m.id
  left join tick  tk on tk.site_id = m.id;

  v_rows := coalesce(v_rows, '[]'::jsonb);

  return jsonb_build_object(
    'date', v_date,
    'month_from', v_from,
    'sites', jsonb_array_length(v_rows),
    'rows', v_rows,
    'total_dc_kwp', (select coalesce(sum((x->>'capacity_dc_kwp')::numeric), 0)
                     from jsonb_array_elements(v_rows) x),
    'today_kwh', (select coalesce(sum((x->>'today_kwh')::numeric), 0)
                  from jsonb_array_elements(v_rows) x),
    'month_kwh', (select coalesce(sum((x->>'month_kwh')::numeric), 0)
                  from jsonb_array_elements(v_rows) x),
    'reported_today', (select count(*) from jsonb_array_elements(v_rows) x
                       where (x->>'reported_today')::boolean),
    'open_tickets', (select coalesce(sum((x->>'open_tickets')::int), 0)
                     from jsonb_array_elements(v_rows) x),
    'critical_tickets', (select coalesce(sum((x->>'critical_tickets')::int), 0)
                         from jsonb_array_elements(v_rows) x));
end;
$$;

grant execute on function public.get_site_portfolio(date) to authenticated;
revoke execute on function public.get_site_portfolio(date) from anon, public;
