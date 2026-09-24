-- =====================================================================
-- PRODUCTION SETUP — run in the Supabase dashboard SQL Editor
--
-- Run the sections IN ORDER. Sections 1-4 come BEFORE importing the
-- O&M history; sections 6-8 come after.
--
-- Anything marked  <<< YOU  needs a real value from you before running.
-- =====================================================================


-- =====================================================================
-- SECTION 1 — Make yourself Super Admin           (run once, after you
--             have added your user in Authentication -> Users)
-- =====================================================================

-- <<< YOU: replace with the email you created in the dashboard.
select app.bootstrap_super_admin('your.email@diwakarsolar.com');

-- It refuses to run a second time once a Super Admin exists. That is
-- deliberate: it is the one door into the system.


-- =====================================================================
-- SECTION 2 — Provisional expected yield        (MUST run BEFORE import)
--
-- expected_kwh is calculated and STORED when a reading is written, from
-- capacity_dc_kwp * expected_yield. If this is null at import time, all
-- 2,584 historical rows get a null baseline and the "% of expected"
-- column stays blank for the whole history.
--
-- 4.5 kWh/kWp/day is a reasonable Rajasthan ground-mount average. You
-- replace it with each site's real figure in Section 6, once the
-- history can tell you the truth.
-- =====================================================================

update public.solar_sites
set expected_yield = 4.5
where capacity_dc_kwp > 0 and expected_yield is null;

-- Check: every commissioned site should now have a yield.
select s.name, ss.capacity_dc_kwp, ss.expected_yield
from public.solar_sites ss join public.sites s on s.id = ss.site_id
order by s.name;


-- =====================================================================
-- SECTION 3 — Inverter counts                  (visible to technicians)
--
-- Every site is currently set to 12, which was inferred from the old
-- form's INV-01...INV-12. The Daily Entry page draws exactly this many
-- reading boxes, so a wrong number is wrong on a technician's phone
-- every single day.
--
-- <<< YOU: replace each number with the real inverter count.
-- =====================================================================

update public.solar_sites ss set inverter_count = v.n
from (values
  ('Sadas',        12),
  ('Suaap',        12),
  ('Bassi',        12),
  ('Budsu',        12),
  ('Jerthi',       12),
  ('Niwai',        12),
  ('Indo Ka Bas',  12),
  ('Ganeshgarh',   12),
  ('Budhwara',     12),
  ('Kadel',        12),
  ('Thikariya',    12),
  ('Bhojusar',      9)     -- the Project CRM listed 9 inverters here
) as v(name, n)
join public.sites s on s.name = v.name
where ss.site_id = s.id;


-- =====================================================================
-- SECTION 4 — Settle Jerthi
--
-- Your two legacy apps disagree:
--    O&M CRM      3,496 kWp
--    Project CRM  3,361 kWp
--
-- Capacity is NOT stored on the readings, so this is safe to change at
-- any time — every CUF, PR and specific-yield figure recalculates. But
-- decide before anyone starts trusting the numbers.
--
-- <<< YOU: uncomment ONE of these.
-- =====================================================================

-- update public.solar_sites ss set capacity_dc_kwp = 3361
-- from public.sites s where s.id = ss.site_id and s.name = 'Jerthi';

-- update public.solar_sites ss set capacity_dc_kwp = 3496
-- from public.sites s where s.id = ss.site_id and s.name = 'Jerthi';


-- =====================================================================
-- SECTION 5 — Commercial details               (not urgent; do in a week)
--
-- None of this is needed for the daily cycle. It matters when you start
-- reconciling generation against DISCOM bills.
--
-- <<< YOU: fill in the real values, add the remaining sites.
-- =====================================================================

-- update public.solar_sites ss set
--   commissioning_date = v.comm::date,
--   discom             = v.discom,
--   consumer_no        = v.consumer,
--   tariff_per_kwh     = v.tariff,
--   grid_connection    = v.grid,
--   module_make        = v.module_make,
--   module_count       = v.module_count,
--   inverter_make      = v.inv_make
-- from (values
--   ('Sadas', '2024-03-15', 'AVVNL',  'XXXXXXXXXX', 3.14, '33 kV', 'Adani 550 Wp',  5278, 'Sungrow'),
--   ('Suaap', '2024-05-20', 'JdVVNL', 'XXXXXXXXXX', 3.02, '33 kV', 'Waaree 545 Wp', 6064, 'Sungrow')
--   -- ... the remaining 11
-- ) as v(name, comm, discom, consumer, tariff, grid, module_make, module_count, inv_make)
-- join public.sites s on s.name = v.name
-- where ss.site_id = s.id;


-- ===============  EVERYTHING BELOW RUNS AFTER THE IMPORT  =============


-- =====================================================================
-- SECTION 6 — Verify the import against the old app
--
-- Compare these month totals with the O&M CRM's "Overall" tab:
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
-- SECTION 7 — Replace the guessed yield with the real one
--
-- Now the history can tell you what each site actually produces.
-- Run the SELECT, then put those numbers into the UPDATE.
-- =====================================================================

select s.name,
       round(avg(g.generation_kwh / nullif(ss.capacity_dc_kwp, 0))::numeric, 2) as real_yield,
       count(*) as days_of_history
from public.generation_records g
join public.sites s        on s.id = g.site_id
join public.solar_sites ss on ss.site_id = g.site_id
where g.generation_kwh > 0 and g.deleted_at is null
group by s.name
order by s.name;

-- <<< YOU: copy the real_yield figures above into here.
-- update public.solar_sites ss set expected_yield = v.y
-- from (values
--   ('Sadas', 4.8), ('Suaap', 4.6), ('Bassi', 4.5)
--   -- ... the rest
-- ) as v(name, y)
-- join public.sites s on s.name = v.name
-- where ss.site_id = s.id;


-- =====================================================================
-- SECTION 8 — Backfill the historical baseline
--
-- Only needed if you imported before running Section 2, or after you
-- change expected_yield in Section 7.
-- =====================================================================

update public.generation_records g
set expected_kwh = round(ss.capacity_dc_kwp * ss.expected_yield, 3)
from public.solar_sites ss
where ss.site_id = g.site_id
  and g.expected_kwh is null
  and ss.expected_yield is not null;


-- =====================================================================
-- SECTION 9 — Link technician logins to the contact register
--
-- Run after you have created user accounts for the field team. It
-- matches on name, so anyone whose login name differs from their entry
-- in the roster stays unlinked — check the second query for those.
-- =====================================================================

update public.om_team_members m set user_id = p.id
from public.profiles p
where lower(trim(p.full_name)) = lower(trim(m.full_name))
  and m.user_id is null;

-- Who is still without a login?
select m.full_name, s.name as site, m.mobile
from public.om_team_members m
join public.sites s on s.id = m.site_id
where m.user_id is null and m.deleted_at is null
order by s.name, m.full_name;


-- =====================================================================
-- SECTION 10 — Health check, run any time
-- =====================================================================

select
  (select count(*) from public.sites)                                    as sites,
  (select count(*) from public.solar_sites where capacity_dc_kwp > 0)    as solar_sites,
  (select count(*) from public.om_team_members where deleted_at is null) as team_members,
  (select count(*) from public.om_checklist_items)                       as checklist_points,
  (select count(*) from public.profiles where status = 'active')         as active_users,
  (select count(*) from public.generation_records where deleted_at is null) as readings,
  (select count(*) from public.modules where is_enabled)                 as enabled_modules;
