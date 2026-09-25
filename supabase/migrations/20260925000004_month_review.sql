-- =====================================================================
-- MONTH REVIEW
--
-- From "June Month Review.xlsx" and "July Month Review.xlsx" — the
-- monthly pack the O&M team takes into its review meeting.
--
-- It does NOT use the same arithmetic as the daily report, and that is
-- deliberate. The monthly view judges the plant on the days it could
-- actually have generated:
--
--   shutdown days   = outage hours / 11          (confirmed by Diwakar)
--   effective days  = days in month - shutdown days
--   forecast (pro)  = monthly target / days in month * effective days
--   S.Y.            = actual / effective days / DC     <- PER DAY
--   DC CUF %        = actual / (DC * 24 * effective days) * 100
--   PR %            = actual / (cumulative insolation * DC) * 100
--
-- The daily report divides by calendar days and reports S.Y. as a period
-- total. Both are kept: the daily view answers "what came out", the
-- month review answers "how well did the plant run when it could".
--
-- Differences from the spreadsheets, all deliberate:
--   * days in month is real, not the 30 and 31 hard-coded in the files
--     (July's own sheet subtracts from 31 on one tab and 30 on another)
--   * insolation is summed from the daily readings rather than typed, so
--     it cannot be copied from the previous month by accident
--   * PR is left unavailable when insolation was never recorded, rather
--     than dividing by zero
-- =====================================================================

create table public.site_monthly_targets (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  year          int not null check (year between 2000 and 2100),
  month         int not null check (month between 1 and 12),
  forecast_kwh  numeric(14,2) not null default 0 check (forecast_kwh >= 0),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  unique (site_id, year, month)
);
create index site_monthly_targets_period_idx on public.site_monthly_targets(year, month);

alter table public.site_monthly_targets enable row level security;
grant select, insert, update, delete on public.site_monthly_targets to authenticated;
create policy tgt_select on public.site_monthly_targets for select to authenticated
  using ((select app.has_any_perm(array['om.analytics','om.monitor','om.sites'], 'view'))
         and site_id = any ((select app.my_site_ids())::uuid[]));
create policy tgt_insert on public.site_monthly_targets for insert to authenticated
  with check ((select app.has_perm('om.sites', 'create'))
              and site_id = any ((select app.my_site_ids())::uuid[]));
create policy tgt_update on public.site_monthly_targets for update to authenticated
  using ((select app.has_perm('om.sites', 'edit'))
         and site_id = any ((select app.my_site_ids())::uuid[])) with check (true);
create policy tgt_delete on public.site_monthly_targets for delete to authenticated
  using ((select app.has_perm('om.sites', 'delete')));
create trigger touch_row before update on public.site_monthly_targets
  for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.site_monthly_targets
  for each row execute function app.audit_row_change('om.sites');

-- The targets the two review packs carry. Other months need the
-- company's own figures; the review shows a blank target rather than
-- guessing one.
insert into public.site_monthly_targets (site_id, year, month, forecast_kwh)
select s.id, 2026, v.m, v.kwh
from (values
  (6, 'Sadas', 373900), (6, 'Suaap', 433700), (6, 'Bassi', 611600), (6, 'Budsu', 343100),
  (6, 'Jerthi', 486400), (6, 'Niwai', 348000), (6, 'Indo Ka Bas', 457000),
  (6, 'Ganeshgarh', 454300), (6, 'Budhwara', 589000), (6, 'Kadel', 433900),
  (6, 'Thikariya', 576300),
  (7, 'Sadas', 361436.67), (7, 'Suaap', 432652.7), (7, 'Bassi', 611600), (7, 'Budsu', 343100),
  (7, 'Jerthi', 486400), (7, 'Niwai', 348000), (7, 'Indo Ka Bas', 457000),
  (7, 'Ganeshgarh', 454300), (7, 'Budhwara', 606600), (7, 'Kadel', 450950),
  (7, 'Thikariya', 618500)
) as v(m, name, kwh)
join public.sites s on s.name = v.name
on conflict (site_id, year, month) do nothing;

-- Peak sun hours, confirmed as 11 by Diwakar on 25 Sep 2026. A setting
-- rather than a constant, because it is a convention and not a law.
insert into public.app_settings (key, value)
values ('om.peak_sun_hours', '11'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- The review itself.
-- =====================================================================
create or replace function public.get_month_review(p_year int default null, p_month int default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_year int := coalesce(p_year, extract(year from v_today)::int);
  v_month int := coalesce(p_month, extract(month from v_today)::int);
  v_from date := make_date(v_year, v_month, 1);
  v_to date := (v_from + interval '1 month - 1 day')::date;
  v_days int := extract(day from v_to)::int;
  v_peak numeric := coalesce(
    (select (value #>> '{}')::numeric from public.app_settings where key = 'om.peak_sun_hours'), 11);
  v_sites uuid[] := app.my_site_ids();
  v jsonb;
begin
  if not app.has_perm('om.analytics', 'view') then
    raise exception 'Access denied: om.analytics VIEW permission required.' using errcode = '42501';
  end if;

  with site as (
    select s.id, s.name, coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as dc
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and s.id = any (v_sites) and coalesce(ss.capacity_dc_kwp, 0) > 0
  ),
  gen as (
    select g.site_id,
           sum(g.generation_kwh) as actual,
           sum(g.grid_outage_hrs + g.plant_outage_hrs) as outage_hrs,
           sum(g.irradiation_kwh_m2) as insolation,
           count(*) filter (where g.irradiation_kwh_m2 is not null) as insolation_days,
           count(*) as reported_days
    from public.generation_records g
    where g.deleted_at is null and g.site_id = any (v_sites)
      and g.gen_date between v_from and v_to
    group by g.site_id
  ),
  calc as (
    select s.id, s.name, s.dc,
           coalesce(g.actual, 0) as actual,
           coalesce(g.outage_hrs, 0) as outage_hrs,
           g.insolation,
           coalesce(g.reported_days, 0) as reported_days,
           t.forecast_kwh as forecast,
           round(coalesce(g.outage_hrs, 0) / v_peak, 4) as shutdown_days,
           greatest(v_days - coalesce(g.outage_hrs, 0) / v_peak, 0.01) as effective_days
    from site s
    left join gen g on g.site_id = s.id
    left join public.site_monthly_targets t
           on t.site_id = s.id and t.year = v_year and t.month = v_month
  ),
  final as (
    select c.*,
           case when c.forecast is not null
                then round(c.forecast / v_days * c.effective_days, 2) end as forecast_prorated,
           case when c.actual > 0 and c.dc > 0
                then round(c.actual / c.effective_days / c.dc, 2) end as sy_per_day,
           case when c.actual > 0 and c.dc > 0
                then round(100 * c.actual / (c.dc * 24 * c.effective_days), 2) end as dc_cuf,
           case when c.actual > 0 and c.dc > 0 and c.insolation > 0
                then round(100 * c.actual / (c.insolation * c.dc), 2) end as pr
    from calc c
  )
  select jsonb_build_object(
    'year', v_year, 'month', v_month,
    'from', v_from, 'to', v_to,
    'days_in_month', v_days,
    'peak_sun_hours', v_peak,
    'site_count', (select count(*) from final),
    'capacity_dc_kwp', coalesce((select sum(dc) from final), 0),
    'forecast_total', (select sum(forecast) from final),
    'forecast_prorated_total', (select sum(forecast_prorated) from final),
    'actual_total', coalesce((select sum(actual) from final), 0),
    'diff_total', (select sum(actual) - sum(forecast_prorated) from final
                   where forecast_prorated is not null),
    'shutdown_days_total', coalesce((select round(sum(shutdown_days), 2) from final), 0),
    'missing_targets', (select count(*) from final where forecast is null),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'site_id', id, 'site', name, 'capacity_dc_kwp', dc,
               'forecast', forecast,
               'shutdown_days', shutdown_days,
               'effective_days', round(effective_days, 2),
               'forecast_prorated', forecast_prorated,
               'actual', actual,
               'diff', case when forecast_prorated is not null
                            then round(actual - forecast_prorated, 2) end,
               'specific_yield', sy_per_day,
               'dc_cuf', dc_cuf,
               'insolation', insolation,
               'pr', pr,
               'reported_days', reported_days)
             order by name)
      from final), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

grant execute on function public.get_month_review(int, int) to authenticated;
revoke execute on function public.get_month_review(int, int) from anon, public;

-- The shutdown analysis now reads the same setting instead of carrying
-- its own default, so there is one place the 11 lives.
create or replace function public.get_shutdown_analysis(
  p_month date default null,
  p_peak_hours numeric default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
  v_end date := (v_month + interval '1 month - 1 day')::date;
  v_days int := extract(day from v_end)::int;
  v_peak numeric := coalesce(nullif(p_peak_hours, 0),
    (select (value #>> '{}')::numeric from public.app_settings where key = 'om.peak_sun_hours'), 11);
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
