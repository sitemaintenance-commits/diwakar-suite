-- =====================================================================
-- PRODUCTION SETUP — run in the Supabase dashboard SQL Editor
--
-- Sections 1-3 come BEFORE the history import. 4 onwards come after.
-- Anything marked  <<< YOU  needs a real value from you.
--
-- Several things that used to live here are now done by migrations and
-- need no action: the real inverter counts, the per-inverter register,
-- eight commissioning dates, the plant capacities settled on the Daily
-- Report tab, and the peak sun hours (11).
-- =====================================================================


-- =====================================================================
-- SECTION 1 — Make yourself Super Admin
--
-- First add your user in the dashboard: Authentication -> Users -> Add
-- user, with Auto Confirm ticked and {"full_name": "Your Name"} in the
-- User Metadata box. Then run this with that email.
-- =====================================================================

-- <<< YOU
select app.bootstrap_super_admin('your.email@diwakarsolar.com');

-- It refuses to run again once a Super Admin exists. That is the one
-- door into the system.


-- =====================================================================
-- SECTION 2 — Commissioning dates for the four that are missing
--
-- Sadas, Niwai, Jerthi, Suaap, Budsu, Bassi, Indo Ka Bas and Ganeshgarh
-- already came across from "Master All Commissioned Sites.xlsx".
-- =====================================================================

-- <<< YOU
-- update public.solar_sites ss set commissioning_date = v.d::date
-- from (values
--   ('Budhwara',  '2026-04-01'),
--   ('Kadel',     '2026-04-01'),
--   ('Thikariya', '2026-04-01'),
--   ('Bhojusar',  '2026-08-01')
-- ) as v(name, d)
-- join public.sites s on s.name = v.name
-- where ss.site_id = s.id;


-- =====================================================================
-- SECTION 3 — Who awards the month-end marks
--
-- In the legacy PMS the last 20 marks were set by Rajpal Singh and
-- Vishnu Soni. APPROVE on om.performance is what allows that, and it
-- currently sits with the whole O&M Manager role.
--
-- Do this in Administration -> Role Management if you would rather see
-- it, or create a small role for the two of them here.
-- =====================================================================

-- Who can award them today:
select r.name as role, m.key as module, rp.action, rp.scope
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
join public.modules m on m.id = rp.module_id
where m.key = 'om.performance' and rp.action = 'approve';


-- ===============  EVERYTHING BELOW RUNS AFTER THE IMPORT  =============


-- =====================================================================
-- SECTION 4 — Verify the import against the old app
--
-- Compare with the O&M CRM's "Overall" tab:
--    Jan 2,408   Feb 2,938   Mar 3,670   Apr 4,940   May 6,160
--    Jun 5,797   Jul 4,959   Aug 4,933   Sep 3,871
--    Total 39,673.6 MWh
--
-- Those were read off bar labels, so within ~1% is a pass. A month that
-- is wildly off means readings did not map — stop and investigate.
-- =====================================================================

select to_char(date_trunc('month', gen_date), 'Mon YYYY') as month,
       round(sum(generation_kwh) / 1000, 1) as mwh,
       count(*) as readings,
       count(distinct site_id) as sites
from public.generation_records
where deleted_at is null and gen_date >= '2026-01-01'
group by date_trunc('month', gen_date)
order by date_trunc('month', gen_date);

-- Grand total — expect roughly 39,673 MWh across ~2,584 readings.
select round(sum(generation_kwh) / 1000, 1) as total_mwh,
       count(*) as readings,
       min(gen_date) as first_day,
       max(gen_date) as last_day
from public.generation_records where deleted_at is null;


-- =====================================================================
-- SECTION 5 — Monthly forecast targets
--
-- The Month Review compares actual against these. June and July 2026
-- came across from the two review packs; every other month is blank and
-- the review will say so rather than invent a number.
--
-- "Master All Commissioned Sites.xlsx" could not be used: its forecast
-- column holds day counts on some tabs, forecasts on others, and nothing
-- on five of them. These have to come from whoever sets the targets.
-- =====================================================================

-- What is already loaded:
select s.name, t.month, t.forecast_kwh
from public.site_monthly_targets t join public.sites s on s.id = t.site_id
where t.year = 2026 order by t.month, s.name;

-- <<< YOU — add the rest, one row per plant per month.
-- insert into public.site_monthly_targets (site_id, year, month, forecast_kwh)
-- select s.id, 2026, v.m, v.kwh
-- from (values
--   (8, 'Sadas', 0), (8, 'Suaap', 0), (8, 'Bassi', 0)
--   -- ... every plant, every month you have a target for
-- ) as v(m, name, kwh)
-- join public.sites s on s.name = v.name
-- on conflict (site_id, year, month) do update set forecast_kwh = excluded.forecast_kwh;


-- =====================================================================
-- SECTION 6 — Link technician logins to the contact register
--
-- Run after the field team have accounts. It matches on name, so anyone
-- whose login name differs from the roster stays unlinked — the second
-- query lists them.
-- =====================================================================

update public.om_team_members m set user_id = p.id
from public.profiles p
where lower(trim(p.full_name)) = lower(trim(m.full_name))
  and m.user_id is null;

select m.full_name, s.name as site, m.mobile
from public.om_team_members m
join public.sites s on s.id = m.site_id
where m.user_id is null and m.deleted_at is null
order by s.name, m.full_name;


-- =====================================================================
-- SECTION 7 — Optional: a generation baseline
--
-- NOT required, and not a company figure. expected_yield (kWh per kWp
-- per day) exists nowhere in the spreadsheets — what the company
-- forecasts is monthly generation in kWh, which is Section 5.
--
-- Setting it only adds a "% of expected" hint on Solar Monitor and a
-- dashed line on one chart. None of S.Y., PR, DC CUF or AC CUF use it,
-- and it can be filled in at any time, including after the import.
--
-- If you want it, derive it from the history rather than guessing:
-- =====================================================================

select s.name,
       round(avg(g.generation_kwh / nullif(ss.capacity_dc_kwp, 0))::numeric, 2) as real_yield,
       count(*) as days_of_history
from public.generation_records g
join public.sites s        on s.id = g.site_id
join public.solar_sites ss on ss.site_id = g.site_id
where g.generation_kwh > 0 and g.deleted_at is null
group by s.name order by s.name;

-- Then put those figures in, and backfill the stored baseline:
-- update public.solar_sites ss set expected_yield = v.y
-- from (values ('Sadas', 4.8), ('Bassi', 4.5)) as v(name, y)
-- join public.sites s on s.name = v.name
-- where ss.site_id = s.id;

-- update public.generation_records g
-- set expected_kwh = round(ss.capacity_dc_kwp * ss.expected_yield, 3)
-- from public.solar_sites ss
-- where ss.site_id = g.site_id and g.expected_kwh is null
--   and ss.expected_yield is not null;


-- =====================================================================
-- SECTION 8 — Commercial details (not urgent)
--
-- None of this is needed for the daily cycle. It matters when you start
-- reconciling generation against DISCOM bills.
-- =====================================================================

-- <<< YOU
-- update public.solar_sites ss set
--   discom = v.discom, consumer_no = v.consumer, tariff_per_kwh = v.tariff,
--   grid_connection = v.grid, module_make = v.module_make, inverter_make = v.inv_make
-- from (values
--   ('Sadas', 'AVVNL',  'XXXXXXXXXX', 3.14, '33 kV', 'Adani 550 Wp',  'Sungrow'),
--   ('Suaap', 'JdVVNL', 'XXXXXXXXXX', 3.02, '33 kV', 'Waaree 545 Wp', 'Sungrow')
--   -- ... the remaining 11
-- ) as v(name, discom, consumer, tariff, grid, module_make, inv_make)
-- join public.sites s on s.name = v.name
-- where ss.site_id = s.id;


-- =====================================================================
-- SECTION 9 — Health check, run any time
-- =====================================================================

select
  (select count(*) from public.sites)                                      as sites,
  (select count(*) from public.solar_sites where capacity_dc_kwp > 0)      as solar_sites,
  (select count(*) from public.site_inverters)                             as inverters,
  (select count(*) from public.om_team_members where deleted_at is null)   as team_members,
  (select count(*) from public.om_checklist_items)                         as checklist_points,
  (select count(*) from public.profiles where status = 'active')           as active_users,
  (select count(*) from public.generation_records where deleted_at is null) as readings,
  (select count(*) from public.site_monthly_targets)                       as monthly_targets,
  (select count(*) from public.modules where is_enabled)                   as enabled_modules;
