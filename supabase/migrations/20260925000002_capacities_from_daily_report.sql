-- =====================================================================
-- CAPACITIES: THE DAILY REPORT TAB IS AUTHORITATIVE
--
-- The company's files carried up to four figures for the same plant.
-- Diwakar's decision (25 Sep 2026): the "Daily Report" tab of
-- "Sites DC Load <month> 2026.xlsx" wins, because it is the sheet the
-- O&M team fills in every day and the one the live dashboard mirrors.
--
-- Applying it changes two plants. Every other site already matched.
--
--   Jerthi DC     3,496 -> 3,361   (Master file said 3,496, Monthly
--                                   Report 3,254, its ten inverters
--                                   sum to 3,528.7)
--   Bhojusar AC   2,520 -> 2,475
--
-- Capacity is not stored on a reading, so every CUF, PR and specific
-- yield figure — history included — recalculates from this.
-- =====================================================================

update public.solar_sites ss set capacity_dc_kwp = v.dc, capacity_ac_kw = v.ac
from (values
  ('Sadas',       2903, 2065),
  ('Suaap',       3305, 2700),
  ('Bassi',       4418, 3300),
  ('Budsu',       2438, 1925),
  ('Jerthi',      3361, 2750),
  ('Niwai',       2640, 2200),
  ('Indo Ka Bas', 3274, 2475),
  ('Ganeshgarh',  3272, 2475),
  ('Budhwara',    4340, 3300),
  ('Kadel',       3124, 2475),
  ('Thikariya',   4473, 3300),
  ('Bhojusar',    3280, 2475)
) as v(name, dc, ac)
join public.sites s on s.name = v.name
where ss.site_id = s.id
  and (ss.capacity_dc_kwp is distinct from v.dc or ss.capacity_ac_kw is distinct from v.ac);

-- public.sites carries a headline capacity too; keep the two in step.
update public.sites s set capacity_kwp = ss.capacity_dc_kwp
from public.solar_sites ss
where ss.site_id = s.id and s.capacity_kwp is distinct from ss.capacity_dc_kwp;
