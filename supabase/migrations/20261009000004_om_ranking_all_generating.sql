-- The ranking counts every active plant with a DC capacity, whatever its
-- stage label: Bhojusar generates and reports daily but is still marked
-- "installation" in the plant settings.
create or replace function public.get_om_site_ranking(p_days int default 7)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_to date := case when extract(hour from v_now) >= 18 then v_now::date else v_now::date - 1 end;
  v_days int := least(greatest(coalesce(p_days, 7), 3), 31);
  v_from date := v_to - (v_days - 1);
  v_month_days numeric := extract(day from (date_trunc('month', v_to) + interval '1 month - 1 day'));
begin
  if not (app.sees_all('om.daily_entry') or app.sees_all('om.monitor') or app.sees_all('om.generation')) then
    return null;
  end if;

  return (
    with site as (
      select s.id, s.name, ss.capacity_dc_kwp as dc
      from public.sites s
      join public.solar_sites ss on ss.site_id = s.id and ss.capacity_dc_kwp > 0
      where s.status = 'active'
    ),
    m as (
      select st.id, st.name, st.dc,
             count(g.id) as days,
             coalesce(sum(g.generation_kwh), 0) as kwh,
             case when count(g.id) > 0 then round(100 * sum(g.generation_kwh) / (st.dc * 24 * count(g.id)), 2) end as cuf,
             round(100 * sum(g.generation_kwh) filter (where g.irradiation_kwh_m2 > 0)
                   / nullif(sum(g.irradiation_kwh_m2 * st.dc) filter (where g.irradiation_kwh_m2 > 0), 0), 1) as pr,
             count(g.id) filter (where g.irradiation_kwh_m2 > 0) as pr_days,
             -- this month's part of the period, for the forecast
             sum(g.generation_kwh) filter (where g.gen_date >= date_trunc('month', v_to)) as kwh_month,
             count(g.id) filter (where g.gen_date >= date_trunc('month', v_to)) as days_month
      from site st
      left join public.generation_records g on g.site_id = st.id and g.deleted_at is null
       and g.gen_date between v_from and v_to and g.generation_kwh > 0
      group by st.id, st.name, st.dc
    ),
    med as (select percentile_cont(0.5) within group (order by cuf) as v from m where cuf is not null),
    banded as (
      select m.*, med.v as median,
             (select round(100 * m.kwh_month / nullif(t.forecast_kwh / v_month_days * m.days_month, 0), 1)
              from public.site_monthly_targets t
              where t.site_id = m.id and t.year = extract(year from v_to) and t.month = extract(month from v_to)) as forecast_pct,
             case
               when m.days <= v_days - 2 then 'attention'
               when m.pr is not null and m.pr < 75 then 'attention'
               when m.cuf < med.v * 0.92 then 'attention'
               when m.cuf >= med.v * 1.02 then 'best'
               when m.pr is not null and m.pr >= 80 and m.cuf >= med.v then 'best'
               else 'good' end as status,
             case
               when m.days <= v_days - 2 then format('readings for only %s of %s days', m.days, v_days)
               when m.pr is not null and m.pr < 75 then format('PR %s%% is low', m.pr)
               when m.cuf < med.v * 0.92 then format('CUF %s%% below the fleet', round(100 - 100 * m.cuf / med.v))
               when m.cuf >= med.v * 1.02 then format('CUF %s%% above the fleet', round(100 * m.cuf / med.v - 100))
               when m.pr is not null and m.pr >= 80 and m.cuf >= med.v then format('PR %s%%', m.pr)
               else 'in line with the fleet' end as reason
      from m cross join med
    )
    select jsonb_build_object(
      'from', v_from, 'to', v_to, 'days', v_days,
      'median_cuf', (select round(v::numeric, 2) from med),
      'sites', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'rank', rn, 'site_id', id, 'name', name, 'cuf', cuf, 'pr', pr, 'pr_days', pr_days,
                 'days', days, 'generation_kwh', kwh, 'forecast_pct', forecast_pct,
                 'status', status, 'reason', reason) order by rn)
        from (select b.*, row_number() over (order by (b.status = 'attention'), b.cuf desc nulls last, b.name) rn
              from banded b) q), '[]'::jsonb))
  );
end;
$$;
