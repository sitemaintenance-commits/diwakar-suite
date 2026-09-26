-- =====================================================================
-- The four commissioning dates that "Master All Commissioned Sites.xlsx"
-- did not carry, supplied by the company.
--
-- Each one agrees with when generation first appears in the monthly
-- workbooks, which is the only independent check available:
--   Budhwara  22 Mar, first reading late March
--   Kadel     25 Mar, first reading 15 Apr
--   Thikariya 28 Mar, first reading 17 Apr
--   Bhojusar   7 Aug, first reading  8 Aug
-- =====================================================================

update public.solar_sites ss
set commissioning_date = v.d::date
from (values
  ('Budhwara',  '2026-03-22'),
  ('Kadel',     '2026-03-25'),
  ('Thikariya', '2026-03-28'),
  ('Bhojusar',  '2026-08-07')
) as v(name, d)
join public.sites s on s.name = v.name
where ss.site_id = s.id;

-- Every commissioned plant should now have a date. Deegod is still a
-- placeholder with no capacity and no readings, so it is excluded.
do $$
declare
  v_missing text;
begin
  select string_agg(s.name, ', ' order by s.name) into v_missing
  from public.solar_sites ss
  join public.sites s on s.id = ss.site_id
  where ss.commissioning_date is null and ss.capacity_dc_kwp > 0;

  if v_missing is not null then
    raise notice 'Still without a commissioning date: %', v_missing;
  end if;
end $$;
