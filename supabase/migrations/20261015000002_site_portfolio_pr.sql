-- =====================================================================
-- SOLAR SITES SHOWS PR
--
-- The portfolio already had CUF and specific yield; it now also has the
-- performance ratio, worked out the way the O&M site ranking and the Solar
-- Monitor do it: generation over (insolation x DC capacity), using only the
-- days that have an insolation reading (insolation comes from the office
-- report sheet). A plant without any insolation for the month shows no PR,
-- not zero. The fleet figure weights each plant by its DC capacity.
-- =====================================================================

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
    select g.site_id, sum(g.generation_kwh) as kwh,
           sum(g.generation_kwh) filter (where g.irradiation_kwh_m2 > 0) as pr_kwh,
           sum(g.irradiation_kwh_m2) filter (where g.irradiation_kwh_m2 > 0) as irr
    from public.generation_records g
    where g.deleted_at is null and g.gen_date = v_date
    group by g.site_id
  ),
  mtd as (
    select g.site_id,
           sum(g.generation_kwh) as kwh,
           count(*) as days,
           max(g.gen_date) as last_day,
           sum(g.generation_kwh) filter (where g.irradiation_kwh_m2 > 0) as pr_kwh,
           sum(g.irradiation_kwh_m2) filter (where g.irradiation_kwh_m2 > 0) as irr,
           count(*) filter (where g.irradiation_kwh_m2 > 0) as pr_days
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
           -- PR on the days that have an insolation reading: energy out over
           -- the energy the sun put on the panels (insolation x DC).
           'month_pr', case when coalesce(mt.irr, 0) > 0 and m.dc > 0
                            then round((mt.pr_kwh / (mt.irr * m.dc) * 100)::numeric, 1) end,
           'pr_days', coalesce(mt.pr_days, 0),
           'today_pr', case when coalesce(t.irr, 0) > 0 and m.dc > 0
                            then round((t.pr_kwh / (t.irr * m.dc) * 100)::numeric, 1) end,
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
    -- Fleet PR: each plant weighted by its capacity.
    'month_pr', (select round((sum((x->>'month_pr')::numeric * (x->>'capacity_dc_kwp')::numeric)
                               / nullif(sum((x->>'capacity_dc_kwp')::numeric), 0)), 1)
                 from jsonb_array_elements(v_rows) x where x->>'month_pr' is not null),
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
