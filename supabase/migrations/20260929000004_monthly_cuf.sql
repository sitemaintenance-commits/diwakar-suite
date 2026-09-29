-- =====================================================================
-- MONTHLY GENERATION AND CUF, THE WAY THE O&M TEAM KEEPS IT
--
-- Source: "CUF On AC & DC Capacity.xlsx", confirmed by the O&M team as
-- the correct monthly record. One tab per plant holds the month's
-- generation per inverter (the inverter meters), the JMR (the joint meter
-- reading the DISCOM bills) where there is one, and the TL loss between
-- them. Its Main tab gives each plant's CUF since the month it first ran
-- on its full DC capacity.
--
-- What it settles:
--
--   * CUF for a month = generation / (capacity x 24 x days in the month)
--     x 100, on DC and on AC capacity alike. Calendar days -- the Month
--     Review used to divide by "effective" days (net of shutdown), which
--     read higher than the company's own figure. A month still running
--     counts the days that have passed.
--   * A month's generation is the month's recorded total (inverter meters)
--     where there is one; otherwise the sum of the daily readings. The
--     workbook reaches back to August 2024, which the daily history does
--     not, and it has the commissioning months the daily history is short
--     of (Budhwara, Kadel and Thikariya in April).
--   * Capacities as the workbook states them: Jerthi DC 3,496 (not 3,361),
--     Bhojusar DC 3,263 (not 3,280; the technicians' form says 3.263 MW
--     too), Budsu DC 2,439 (the Main tab's "Actual DC Capacity").
--   * Each plant's LOA (contracted) capacity and the month it reached full
--     load, from which its lifetime CUF is counted.
--
-- The Main tab's own totals stop at May 2026; get_cuf_report with
-- p_upto = May 2026 reproduces them exactly, and any later month extends
-- them.
-- =====================================================================

alter table public.solar_sites
  add column if not exists loa_capacity_kw numeric(12,3),
  add column if not exists full_load_from date;
comment on column public.solar_sites.loa_capacity_kw is 'Capacity awarded in the LOA (contracted capacity), kW.';
comment on column public.solar_sites.full_load_from is
  'First month the plant ran on its full DC capacity; lifetime CUF counts from here.';

update public.solar_sites ss
set capacity_dc_kwp = coalesce(v.dc, ss.capacity_dc_kwp),
    loa_capacity_kw = v.loa,
    full_load_from = v.full_load::date
from (values
  ('Sadas',       null::numeric, 1890::numeric, '2024-10-01'),
  ('Suaap',       null,          3300,          '2025-11-01'),
  ('Bassi',       null,          3410,          '2025-12-01'),
  ('Budsu',       2439,          1950,          '2025-11-01'),
  ('Jerthi',      3496,          2780,          '2025-11-01'),
  ('Niwai',       null,          2780,          '2025-08-01'),
  ('Indo Ka Bas', null,          2520,          '2026-02-01'),
  ('Ganeshgarh',  null,          2520,          '2026-04-01'),
  ('Budhwara',    null,          3330,          '2026-04-01'),
  ('Kadel',       null,          2410,          '2026-05-01'),
  ('Thikariya',   null,          3430,          '2026-05-01'),
  ('Bhojusar',    3263,          null,          '2026-08-01')
) as v(name, dc, loa, full_load)
join public.sites s on s.name = v.name
where ss.site_id = s.id;

-- ---------------------------------------------------------------------
-- The month's recorded generation per plant.
-- ---------------------------------------------------------------------
create table public.site_monthly_generation (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  year          int not null check (year between 2000 and 2100),
  month         int not null check (month between 1 and 12),
  inverter_kwh  numeric(14,3) not null check (inverter_kwh >= 0),
  jmr_kwh       numeric(14,3) check (jmr_kwh is null or jmr_kwh >= 0),
  source        text not null default 'manual',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  unique (site_id, year, month)
);
comment on table public.site_monthly_generation is
  'A plant''s generation for a month as the O&M team records it: the inverter meters'' total, and the JMR (DISCOM joint meter reading) when there is one.';
create index site_monthly_generation_period_idx on public.site_monthly_generation(year, month);

alter table public.site_monthly_generation enable row level security;
grant select, insert, update, delete on public.site_monthly_generation to authenticated;
create policy smg_select on public.site_monthly_generation for select to authenticated
  using ((select app.has_any_perm(array['om.analytics','om.monitor','om.sites'], 'view'))
         and site_id = any ((select app.my_site_ids())::uuid[]));
create policy smg_insert on public.site_monthly_generation for insert to authenticated
  with check ((select app.has_perm('om.sites', 'create'))
              and site_id = any ((select app.my_site_ids())::uuid[]));
create policy smg_update on public.site_monthly_generation for update to authenticated
  using ((select app.has_perm('om.sites', 'edit'))
         and site_id = any ((select app.my_site_ids())::uuid[])) with check (true);
create policy smg_delete on public.site_monthly_generation for delete to authenticated
  using ((select app.has_perm('om.sites', 'delete')));
create trigger touch_row before update on public.site_monthly_generation
  for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.site_monthly_generation
  for each row execute function app.audit_row_change('om.sites');

insert into public.site_monthly_generation (site_id, year, month, inverter_kwh, jmr_kwh, source, notes)
select s.id, v.y, v.m, v.kwh, v.jmr, 'workbook', 'CUF On AC & DC Capacity.xlsx'
from (values
  ('Sadas', 2024, 8, 182289, 176680),
  ('Sadas', 2024, 9, 306089, 295880),
  ('Sadas', 2024, 10, 366488, 353480),
  ('Sadas', 2024, 11, 389140, 374000),
  ('Sadas', 2024, 12, 360176, 346240),
  ('Sadas', 2025, 1, 389802, 373680),
  ('Sadas', 2025, 2, 415708, 398200),
  ('Sadas', 2025, 3, 502196, null),
  ('Sadas', 2025, 4, 454488, 436920),
  ('Sadas', 2025, 5, 412817, 397280),
  ('Sadas', 2025, 6, 315923, 304880),
  ('Sadas', 2025, 7, 252129, 244160),
  ('Sadas', 2025, 8, 267880, 259480),
  ('Sadas', 2025, 9, 272651, 264280),
  ('Sadas', 2025, 10, 278320, 269240),
  ('Sadas', 2025, 11, 360923, 348120),
  ('Sadas', 2025, 12, 363650, 348320),
  ('Sadas', 2026, 1, 341501, 328000),
  ('Sadas', 2026, 2, 372178, 356880),
  ('Sadas', 2026, 3, 442894, 425200),
  ('Sadas', 2026, 4, 443406, 426840),
  ('Sadas', 2026, 5, 436174.3, 419840),
  ('Sadas', 2026, 6, 391674, 377640),
  ('Sadas', 2026, 7, 295666, 285760),
  ('Sadas', 2026, 8, 249077, 240720),
  ('Suaap', 2025, 10, 297860.1, 293850),
  ('Suaap', 2025, 11, 350399.8, 346000),
  ('Suaap', 2025, 12, 371860.9, 366650),
  ('Suaap', 2026, 1, 401069.6, 396700),
  ('Suaap', 2026, 2, 429848.7, 421000),
  ('Suaap', 2026, 3, 504263, 493750),
  ('Suaap', 2026, 4, 504698, 494300),
  ('Suaap', 2026, 5, 507384.4, 497650),
  ('Suaap', 2026, 6, 479612, 468050),
  ('Suaap', 2026, 7, 429786, 421200),
  ('Suaap', 2026, 8, 430416.9, 421750),
  ('Bassi', 2025, 11, 13053.06, null),
  ('Bassi', 2025, 12, 457684, null),
  ('Bassi', 2026, 1, 521429.73, null),
  ('Bassi', 2026, 2, 566489.13, null),
  ('Bassi', 2026, 3, 671509.57, null),
  ('Bassi', 2026, 4, 660216.13, null),
  ('Bassi', 2026, 5, 671910.14, null),
  ('Bassi', 2026, 6, 655856, null),
  ('Bassi', 2026, 7, 575985, null),
  ('Bassi', 2026, 8, 546497.95, null),
  ('Budsu', 2025, 10, 73162.74, 50320),
  ('Budsu', 2025, 11, 273023.18, 269280),
  ('Budsu', 2025, 12, 290827.04, 286520),
  ('Budsu', 2026, 1, 294426.41, 290040),
  ('Budsu', 2026, 2, 324073.82, 319080),
  ('Budsu', 2026, 3, 381359.62, 375920),
  ('Budsu', 2026, 4, 381023.64, 375520),
  ('Budsu', 2026, 5, 417647.74, 411760),
  ('Budsu', 2026, 6, 390967, 385400),
  ('Budsu', 2026, 7, 342984, 337920),
  ('Budsu', 2026, 8, 302614.22, 298760),
  ('Jerthi', 2025, 8, 1850.91, null),
  ('Jerthi', 2025, 9, 313225, null),
  ('Jerthi', 2025, 10, 385017, null),
  ('Jerthi', 2025, 11, 416196, null),
  ('Jerthi', 2025, 12, 433399, null),
  ('Jerthi', 2026, 1, 414403, null),
  ('Jerthi', 2026, 2, 458903, null),
  ('Jerthi', 2026, 3, 501028, null),
  ('Jerthi', 2026, 4, 522399.48, null),
  ('Jerthi', 2026, 5, 537137.96, null),
  ('Jerthi', 2026, 6, 506801, null),
  ('Jerthi', 2026, 7, 456029, null),
  ('Jerthi', 2026, 8, 435780, null),
  ('Niwai', 2025, 6, 242261.72, null),
  ('Niwai', 2025, 7, 241968.93, null),
  ('Niwai', 2025, 8, 277261.22, null),
  ('Niwai', 2025, 9, 305143.57, null),
  ('Niwai', 2025, 10, 297799.59, null),
  ('Niwai', 2025, 11, 277403.05, null),
  ('Niwai', 2025, 12, 293250.41, null),
  ('Niwai', 2026, 1, 250941.05, null),
  ('Niwai', 2026, 2, 311971.03, null),
  ('Niwai', 2026, 3, 377001.3, null),
  ('Niwai', 2026, 4, 391300.95, null),
  ('Niwai', 2026, 5, 427567, null),
  ('Niwai', 2026, 6, 370739, null),
  ('Niwai', 2026, 7, 327231, null),
  ('Niwai', 2026, 8, 266324.21, null),
  ('Indo Ka Bas', 2026, 1, 184118, 178000),
  ('Indo Ka Bas', 2026, 2, 472324, 460500),
  ('Indo Ka Bas', 2026, 3, 505892, 494000),
  ('Indo Ka Bas', 2026, 4, 515100, 502500),
  ('Indo Ka Bas', 2026, 5, 549567, 537000),
  ('Indo Ka Bas', 2026, 6, 512115, 502000),
  ('Indo Ka Bas', 2026, 7, 449248, 438500),
  ('Indo Ka Bas', 2026, 8, 423940, 414500),
  ('Ganeshgarh', 2026, 2, 10099.41, null),
  ('Ganeshgarh', 2026, 3, 286066.65, null),
  ('Ganeshgarh', 2026, 4, 391414.98, null),
  ('Ganeshgarh', 2026, 5, 517371.45, null),
  ('Ganeshgarh', 2026, 6, 482506, null),
  ('Ganeshgarh', 2026, 7, 464923, null),
  ('Ganeshgarh', 2026, 8, 477102, null),
  ('Budhwara', 2026, 3, 48948, 48300),
  ('Budhwara', 2026, 4, 614764, 604380),
  ('Budhwara', 2026, 5, 777605, 765300),
  ('Budhwara', 2026, 6, 737866, 726300),
  ('Budhwara', 2026, 7, 571042, 562980),
  ('Budhwara', 2026, 8, 491300.38, 484980),
  ('Kadel', 2026, 3, 6152.63, null),
  ('Kadel', 2026, 4, 390985.37, null),
  ('Kadel', 2026, 5, 544631.31, null),
  ('Kadel', 2026, 6, 528425, null),
  ('Kadel', 2026, 7, 428389, null),
  ('Kadel', 2026, 8, 389224, null),
  ('Thikariya', 2026, 3, 2297.04, 2280),
  ('Thikariya', 2026, 4, 493308.39, 485820),
  ('Thikariya', 2026, 5, 774685.16, 761820),
  ('Thikariya', 2026, 6, 742703, 730380),
  ('Thikariya', 2026, 7, 622320, 612960),
  ('Thikariya', 2026, 8, 613780.41, 604800),
  ('Bhojusar', 2026, 8, 322437, null)
) as v(name, y, m, kwh, jmr)
join public.sites s on s.name = v.name
on conflict (site_id, year, month) do nothing;

-- ---------------------------------------------------------------------
-- A month's generation and the days it is judged over.
-- ---------------------------------------------------------------------
/** Days a month is judged over: all of them, or those passed if it is still running. */
create or replace function app.cuf_days(p_year int, p_month int)
returns int
language sql stable
set search_path = ''
as $$
  select case
    when make_date(p_year, p_month, 1) > (now() at time zone 'Asia/Kolkata')::date then 0
    when date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) = make_date(p_year, p_month, 1)
      then greatest(extract(day from (now() at time zone 'Asia/Kolkata')::date)::int - 1, 1)
    else extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::int
  end;
$$;

/** The month's generation for a plant: the recorded monthly total, or the daily readings added up. */
create or replace function app.month_generation(p_site uuid, p_year int, p_month int,
                                                out kwh numeric, out source text)
language sql stable
set search_path = ''
as $$
  select coalesce(m.inverter_kwh, d.kwh),
         case when m.inverter_kwh is not null then 'monthly record'
              when d.kwh is not null then 'daily readings' end
  from (select 1) one
  left join public.site_monthly_generation m
    on m.site_id = p_site and m.year = p_year and m.month = p_month
  left join lateral (
    select sum(g.generation_kwh) as kwh from public.generation_records g
    where g.site_id = p_site and g.deleted_at is null
      and g.gen_date >= make_date(p_year, p_month, 1)
      and g.gen_date < make_date(p_year, p_month, 1) + interval '1 month') d on true;
$$;

-- ---------------------------------------------------------------------
-- The report: the Main tab, and the month-by-month CUF behind it.
-- ---------------------------------------------------------------------
create or replace function public.get_cuf_report(p_year int default null, p_upto date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_year int := coalesce(p_year, extract(year from v_today)::int);
  -- Lifetime runs to the end of this month: by default the last complete one.
  v_upto date := date_trunc('month', coalesce(p_upto, (date_trunc('month', v_today) - interval '1 day')::date))::date;
  v_sites uuid[] := app.my_om_site_ids();
  v jsonb;
begin
  if not app.has_perm('om.analytics', 'view') then
    raise exception 'Access denied: om.analytics VIEW permission required.' using errcode = '42501';
  end if;

  with site as (
    select s.id, s.name, coalesce(s.district, s.location) as location,
           coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as dc, ss.capacity_ac_kw as ac,
           ss.loa_capacity_kw as loa, ss.full_load_from
    from public.sites s join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and s.id = any (v_sites)
  ),
  months as (
    select s.id as site_id, extract(year from d)::int as y, extract(month from d)::int as m
    from site s,
         generate_series(least(coalesce(s.full_load_from, v_upto), make_date(v_year, 1, 1)),
                         greatest(v_upto, make_date(v_year, 12, 1)), interval '1 month') d
  ),
  month_gen as (
    select mo.site_id, mo.y, mo.m, g.kwh, g.source,
           r.jmr_kwh, app.cuf_days(mo.y, mo.m) as days
    from months mo
    cross join lateral app.month_generation(mo.site_id, mo.y, mo.m) g
    left join public.site_monthly_generation r on r.site_id = mo.site_id and r.year = mo.y and r.month = mo.m
  ),
  lifetime as (
    select s.id, sum(mg.kwh) as kwh, sum(mg.days) filter (where mg.kwh is not null) as days,
           count(*) filter (where mg.kwh is not null) as months
    from site s
    join month_gen mg on mg.site_id = s.id
    where s.full_load_from is not null
      and make_date(mg.y, mg.m, 1) between s.full_load_from and v_upto
    group by s.id
  )
  select jsonb_build_object(
    'year', v_year,
    'upto', v_upto,
    'plants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'site_id', s.id, 'name', s.name, 'location', s.location,
               'capacity_dc_kwp', s.dc, 'capacity_ac_kw', s.ac, 'loa_capacity_kw', s.loa,
               'full_load_from', s.full_load_from,
               'total_kwh', l.kwh, 'days', l.days, 'months', l.months,
               'cuf_dc', case when s.dc > 0 and l.days > 0 then round(100 * l.kwh / (s.dc * 24 * l.days), 3) end,
               'cuf_ac', case when s.ac > 0 and l.days > 0 then round(100 * l.kwh / (s.ac * 24 * l.days), 3) end)
             order by s.full_load_from nulls last, s.name)
      from site s left join lifetime l on l.id = s.id), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object(
               'site_id', s.id, 'site', s.name, 'year', mg.y, 'month', mg.m,
               'generation_kwh', mg.kwh, 'source', mg.source, 'jmr_kwh', mg.jmr_kwh,
               'tl_loss_pct', case when mg.jmr_kwh is not null and mg.kwh > 0
                                   then round(100 * (mg.kwh - mg.jmr_kwh) / mg.kwh, 3) end,
               'days', mg.days,
               'running', date_trunc('month', v_today) = make_date(mg.y, mg.m, 1),
               'cuf_dc', case when s.dc > 0 and mg.days > 0 and mg.kwh is not null
                              then round(100 * mg.kwh / (s.dc * 24 * mg.days), 3) end,
               'cuf_ac', case when s.ac > 0 and mg.days > 0 and mg.kwh is not null
                              then round(100 * mg.kwh / (s.ac * 24 * mg.days), 3) end)
             order by s.name, mg.m)
      from site s join month_gen mg on mg.site_id = s.id
      where mg.y = v_year), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

grant execute on function public.get_cuf_report(int, date) to authenticated;
revoke execute on function public.get_cuf_report(int, date) from anon, public;

-- =====================================================================
-- Month Review: the month's recorded total, and CUF on calendar days (DC
-- and AC). Forecast proration and S.Y. per effective day are unchanged.
-- (latest definition, from 20260925000004_month_review.sql)
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
    select s.id, s.name, coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as dc, ss.capacity_ac_kw as ac
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
    select s.id, s.name, s.dc, s.ac,
           -- the month's recorded total where there is one, else the daily readings
           coalesce(r.inverter_kwh, g.actual, 0) as actual,
           coalesce(g.outage_hrs, 0) as outage_hrs,
           g.insolation,
           coalesce(g.reported_days, 0) as reported_days,
           t.forecast_kwh as forecast,
           round(coalesce(g.outage_hrs, 0) / v_peak, 4) as shutdown_days,
           greatest(v_days - coalesce(g.outage_hrs, 0) / v_peak, 0.01) as effective_days
    from site s
    left join gen g on g.site_id = s.id
    left join public.site_monthly_generation r
           on r.site_id = s.id and r.year = v_year and r.month = v_month
    left join public.site_monthly_targets t
           on t.site_id = s.id and t.year = v_year and t.month = v_month
  ),
  final as (
    select c.*,
           case when c.forecast is not null
                then round(c.forecast / v_days * c.effective_days, 2) end as forecast_prorated,
           case when c.actual > 0 and c.dc > 0
                then round(c.actual / c.effective_days / c.dc, 2) end as sy_per_day,
           -- CUF on calendar days, as the O&M monthly record computes it
           case when c.actual > 0 and c.dc > 0 and app.cuf_days(v_year, v_month) > 0
                then round(100 * c.actual / (c.dc * 24 * app.cuf_days(v_year, v_month)), 2) end as dc_cuf,
           case when c.actual > 0 and c.ac > 0 and app.cuf_days(v_year, v_month) > 0
                then round(100 * c.actual / (c.ac * 24 * app.cuf_days(v_year, v_month)), 2) end as ac_cuf,
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
               'ac_cuf', ac_cuf,
               'capacity_ac_kw', ac,
               'insolation', insolation,
               'pr', pr,
               'reported_days', reported_days)
             order by name)
      from final), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;
