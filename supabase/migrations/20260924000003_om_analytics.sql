-- =====================================================================
-- O&M ANALYTICS
--
-- Replaces the Dashboard, Charts, Shutdown and Overall tabs of the O&M
-- CRM with four read-only functions over the readings the suite already
-- holds. Every one of them is scoped to the caller's sites, so the same
-- page shows a site engineer their plant and the O&M head the portfolio.
--
-- The formulas are the ones the legacy sheets use and the ones already
-- used by get_generation_summary():
--   DC CUF %       = 100 * kWh / (kWp(DC) * days * 24)
--   AC CUF %       = 100 * kWh / (kW(AC)  * days * 24)
--   Specific yield = kWh / kWp(DC)
--   PR %           = 100 * kWh / (insolation * kWp(DC))
--   Shutdown days  = outage hours / peak sun hours (11 by default)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The day view: "All Sites Performance" with its four tiles and the
--    site ranking. One row per accessible site, whether or not it has a
--    reading — a missing reading is a fact worth seeing.
-- ---------------------------------------------------------------------
create or replace function public.get_daily_performance(p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_sites uuid[] := app.my_site_ids();
  v jsonb;
begin
  if not app.has_perm('om.monitor', 'view') then
    raise exception 'Access denied: om.monitor VIEW permission required.' using errcode = '42501';
  end if;

  with site as (
    select s.id, s.name, coalesce(s.district, s.location) as location,
           coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as dc,
           coalesce(ss.capacity_ac_kw, 0) as ac,
           ss.tilt_degrees as tilt
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and s.id = any (v_sites)
  ),
  day as (
    select g.site_id, g.generation_kwh, g.irradiation_kwh_m2, g.grid_outage_hrs,
           g.plant_outage_hrs, g.remarks, g.source
    from public.generation_records g
    where g.gen_date = v_date and g.deleted_at is null and g.site_id = any (v_sites)
  ),
  perf as (
    select s.id, s.name, s.location, s.dc, s.ac, s.tilt,
           coalesce(d.generation_kwh, 0) as kwh,
           d.irradiation_kwh_m2 as insolation,
           coalesce(d.grid_outage_hrs, 0) as grid_outage,
           coalesce(d.plant_outage_hrs, 0) as plant_outage,
           d.remarks, d.source,
           (d.site_id is not null) as reported,
           case when s.dc > 0 and d.generation_kwh > 0
                then round(d.generation_kwh / s.dc, 2) end as sy,
           case when s.dc > 0 and d.irradiation_kwh_m2 > 0 and d.generation_kwh > 0
                then round(100 * d.generation_kwh / (d.irradiation_kwh_m2 * s.dc), 2) end as pr,
           case when s.dc > 0 and d.generation_kwh > 0
                then round(100 * d.generation_kwh / (s.dc * 24), 2) end as dc_cuf,
           case when s.ac > 0 and d.generation_kwh > 0
                then round(100 * d.generation_kwh / (s.ac * 24), 2) end as ac_cuf
    from site s left join day d on d.site_id = s.id
  )
  select jsonb_build_object(
    'date', v_date,
    'site_count', (select count(*) from site),
    'reported_count', (select count(*) from perf where reported),
    'capacity_dc_kwp', coalesce((select sum(dc) from site), 0),
    'capacity_ac_kw', coalesce((select sum(ac) from site), 0),
    'total_generation', coalesce((select sum(kwh) from perf), 0),
    'total_grid_outage', coalesce((select sum(grid_outage) from perf), 0),
    'avg_pr', (select round(avg(pr), 2) from perf where pr is not null),
    'avg_insolation', (select round(avg(insolation), 2) from perf where insolation is not null),
    'dc_cuf', (select case when sum(dc) > 0 and sum(kwh) > 0
                            then round(100 * sum(kwh) / (sum(dc) * 24), 2) end from perf),
    'ac_cuf', (select case when sum(ac) > 0 and sum(kwh) > 0
                            then round(100 * sum(kwh) / (sum(ac) * 24), 2) end from perf),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'site_id', id, 'name', name, 'location', location,
               'capacity_dc_kwp', dc, 'capacity_ac_kw', ac, 'tilt', tilt,
               'generation_kwh', kwh, 'insolation', insolation,
               'specific_yield', sy, 'pr', pr, 'dc_cuf', dc_cuf, 'ac_cuf', ac_cuf,
               'grid_outage', grid_outage, 'plant_outage', plant_outage,
               'remarks', remarks, 'source', source, 'reported', reported)
             order by name)
      from perf), '[]'::jsonb),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'generation_kwh', kwh,
                                          'specific_yield', sy, 'pr', pr)
                       order by kwh desc, name)
      from perf where kwh > 0), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. The Charts tab: one site over a date range, with the four metrics
--    on the same rows so the page can switch between them without
--    another round trip.
-- ---------------------------------------------------------------------
create or replace function public.get_site_analysis(
  p_site_id uuid,
  p_from date default null,
  p_to date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, v_to - 29);
  v_sites uuid[] := app.my_site_ids();
  v_dc numeric;
  v_ac numeric;
  v_name text;
  v jsonb;
begin
  if not app.has_perm('om.analytics', 'view') then
    raise exception 'Access denied: om.analytics VIEW permission required.' using errcode = '42501';
  end if;
  if p_site_id is null then
    raise exception 'A site is required.' using errcode = '22023';
  end if;
  if not (p_site_id = any (v_sites)) then
    raise exception 'You are not assigned to this site.' using errcode = '42501';
  end if;

  select s.name, coalesce(ss.capacity_dc_kwp, s.capacity_kwp), coalesce(ss.capacity_ac_kw, 0)
    into v_name, v_dc, v_ac
  from public.sites s left join public.solar_sites ss on ss.site_id = s.id
  where s.id = p_site_id;

  with metric as (
    select g.gen_date,
           g.generation_kwh as kwh,
           g.irradiation_kwh_m2 as insolation,
           g.grid_outage_hrs as outage,
           case when v_dc > 0 and g.generation_kwh > 0 then round(g.generation_kwh / v_dc, 2) end as sy,
           case when v_dc > 0 and g.irradiation_kwh_m2 > 0 and g.generation_kwh > 0
                then round(100 * g.generation_kwh / (g.irradiation_kwh_m2 * v_dc), 2) end as pr,
           case when v_dc > 0 and g.generation_kwh > 0
                then round(100 * g.generation_kwh / (v_dc * 24), 2) end as dc_cuf,
           case when v_ac > 0 and g.generation_kwh > 0
                then round(100 * g.generation_kwh / (v_ac * 24), 2) end as ac_cuf,
           g.remarks
    from public.generation_records g
    where g.site_id = p_site_id and g.deleted_at is null
      and g.gen_date between v_from and v_to
  )
  select jsonb_build_object(
    'site_id', p_site_id, 'site', v_name, 'from', v_from, 'to', v_to,
    'capacity_dc_kwp', coalesce(v_dc, 0), 'capacity_ac_kw', coalesce(v_ac, 0),
    'record_count', (select count(*) from metric),
    'total_generation', coalesce((select sum(kwh) from metric), 0),
    'total_outage', coalesce((select sum(outage) from metric), 0),
    'avg_pr', (select round(avg(pr), 2) from metric where pr is not null),
    'avg_dc_cuf', (select round(avg(dc_cuf), 2) from metric where dc_cuf is not null),
    'avg_ac_cuf', (select round(avg(ac_cuf), 2) from metric where ac_cuf is not null),
    'latest', (select jsonb_build_object('date', gen_date, 'generation_kwh', kwh, 'pr', pr,
                                         'dc_cuf', dc_cuf, 'ac_cuf', ac_cuf)
               from metric order by gen_date desc limit 1),
    'best', (select jsonb_build_object('date', gen_date, 'generation_kwh', kwh, 'pr', pr,
                                       'dc_cuf', dc_cuf, 'ac_cuf', ac_cuf)
             from metric order by kwh desc, gen_date desc limit 1),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', gen_date, 'generation_kwh', kwh, 'insolation', insolation,
               'specific_yield', sy, 'pr', pr, 'dc_cuf', dc_cuf, 'ac_cuf', ac_cuf,
               'grid_outage', outage, 'remarks', remarks)
             order by gen_date)
      from metric), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The Shutdown tab. "Shutdown days" converts outage hours into whole
--    generating days lost, at p_peak_hours of useful sun per day, which
--    is how the O&M sheet reports downtime to the client.
-- ---------------------------------------------------------------------
create or replace function public.get_shutdown_analysis(
  p_month date default null,
  p_peak_hours numeric default 11)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
  v_end date := (v_month + interval '1 month - 1 day')::date;
  v_days int := extract(day from v_end)::int;
  v_peak numeric := case when coalesce(p_peak_hours, 0) <= 0 then 11 else p_peak_hours end;
  v_sites uuid[] := app.my_site_ids();
  v jsonb;
begin
  if not app.has_perm('om.analytics', 'view') then
    raise exception 'Access denied: om.analytics VIEW permission required.' using errcode = '42501';
  end if;

  with site as (
    select s.id, s.name from public.sites s
    where s.status = 'active' and s.id = any (v_sites)
  ),
  gen as (
    select g.site_id, g.gen_date, g.grid_outage_hrs, g.plant_outage_hrs
    from public.generation_records g
    where g.deleted_at is null and g.site_id = any (v_sites)
      and g.gen_date between v_month and v_end
  ),
  per_site as (
    select s.id, s.name,
           coalesce(sum(g.grid_outage_hrs), 0) as grid_hours,
           coalesce(sum(g.plant_outage_hrs), 0) as plant_hours,
           coalesce(sum(g.grid_outage_hrs + g.plant_outage_hrs), 0) as hours
    from site s left join gen g on g.site_id = s.id
    group by s.id, s.name
  )
  select jsonb_build_object(
    'month', v_month, 'month_days', v_days, 'peak_hours', v_peak,
    'total_hours', coalesce((select sum(hours) from per_site), 0),
    'total_shutdown_days', coalesce((select round(sum(hours) / v_peak, 2) from per_site), 0),
    'site_count', (select count(*) from site),
    'highest', (select jsonb_build_object('site', name, 'hours', hours,
                                          'shutdown_days', round(hours / v_peak, 2))
                from per_site order by hours desc, name limit 1),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'site_id', id, 'site', name,
               'hours', hours, 'grid_hours', grid_hours, 'plant_hours', plant_hours,
               'shutdown_days', round(hours / v_peak, 4),
               'monthly_days', round(v_days - (hours / v_peak), 2))
             order by name)
      from per_site), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', g.gen_date, 'site', s.name, 'site_id', s.id,
               'hours', g.grid_outage_hrs + g.plant_outage_hrs,
               'grid_hours', g.grid_outage_hrs, 'plant_hours', g.plant_outage_hrs,
               'shutdown_days', round((g.grid_outage_hrs + g.plant_outage_hrs) / v_peak, 4))
             order by g.gen_date desc, s.name)
      from gen g join site s on s.id = g.site_id
      where g.grid_outage_hrs + g.plant_outage_hrs > 0), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. The Overall tab: the portfolio, month by month.
-- ---------------------------------------------------------------------
create or replace function public.get_portfolio_analytics(p_year int default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Kolkata'))::int);
  v_from date := make_date(v_year, 1, 1);
  v_to date := make_date(v_year, 12, 31);
  v_sites uuid[] := app.my_site_ids();
  v jsonb;
begin
  if not app.has_perm('om.analytics', 'view') then
    raise exception 'Access denied: om.analytics VIEW permission required.' using errcode = '42501';
  end if;

  with site as (
    select s.id, s.name, coalesce(s.district, s.location) as location,
           coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as dc
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and s.id = any (v_sites)
  ),
  gen as (
    select g.site_id, g.gen_date, g.generation_kwh, g.grid_outage_hrs,
           extract(month from g.gen_date)::int as mon
    from public.generation_records g
    where g.deleted_at is null and g.site_id = any (v_sites)
      and g.gen_date between v_from and v_to
  ),
  by_month as (
    select mon, sum(generation_kwh) as kwh, count(distinct gen_date) as days
    from gen group by mon
  )
  select jsonb_build_object(
    'year', v_year,
    'site_count', (select count(*) from site),
    'total_generation', coalesce((select sum(generation_kwh) from gen), 0),
    'reporting_days', coalesce((select count(distinct gen_date) from gen), 0),
    'months_reported', coalesce((select count(*) from by_month), 0),
    'capacity_dc_kwp', coalesce((select sum(dc) from site), 0),
    'best_month', (select jsonb_build_object('month', mon, 'generation_kwh', kwh)
                   from by_month order by kwh desc, mon limit 1),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', mon, 'generation_kwh', kwh, 'days', days)
                       order by mon)
      from by_month), '[]'::jsonb),
    'ranking', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object('site', s.name, 'site_id', s.id,
                                  'generation_kwh', coalesce(sum(g.generation_kwh), 0),
                                  'specific_yield', case when s.dc > 0
                                    then round(coalesce(sum(g.generation_kwh), 0) / s.dc, 1) end) x
        from site s left join gen g on g.site_id = s.id
        group by s.id, s.name, s.dc
        order by coalesce(sum(g.generation_kwh), 0) desc, s.name) q), '[]'::jsonb),
    'outage_by_site', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object('site', s.name, 'hours', coalesce(sum(g.grid_outage_hrs), 0)) x
        from site s left join gen g on g.site_id = s.id
        group by s.id, s.name
        order by coalesce(sum(g.grid_outage_hrs), 0) desc, s.name) q), '[]'::jsonb),
    'matrix', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'site', s.name, 'site_id', s.id,
                 'total', coalesce(sum(g.kwh), 0),
                 'months', coalesce(jsonb_object_agg(g.mon::text, g.kwh) filter (where g.mon is not null),
                                    '{}'::jsonb)) x
        from site s
        left join (select site_id, mon, sum(generation_kwh) as kwh
                   from gen group by site_id, mon) g on g.site_id = s.id
        group by s.id, s.name
        order by s.name) q), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

grant execute on function public.get_daily_performance(date) to authenticated;
grant execute on function public.get_site_analysis(uuid, date, date) to authenticated;
grant execute on function public.get_shutdown_analysis(date, numeric) to authenticated;
grant execute on function public.get_portfolio_analytics(int) to authenticated;
revoke execute on function public.get_daily_performance(date),
                        public.get_site_analysis(uuid, date, date),
                        public.get_shutdown_analysis(date, numeric),
                        public.get_portfolio_analytics(int) from anon, public;

-- ---------------------------------------------------------------------
-- Module
-- ---------------------------------------------------------------------
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'om.analytics', 'Solar Analytics',
       'Per-site trends, shutdown analysis and the portfolio year view',
       '/operations/analytics', 'BarChart3', 35,
       '{view,export}'::public.perm_action[], false, true, true, true, 4
from public.module_groups g where g.key = 'operations'
on conflict (key) do nothing;

do $$
declare
  v_an uuid := (select id from public.modules where key = 'om.analytics');
begin
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_an, a, 'all'
  from public.roles r, unnest(array['view','export']::public.perm_action[]) a
  where r.key in ('om_manager', 'admin', 'management')
  on conflict do nothing;
end $$;
