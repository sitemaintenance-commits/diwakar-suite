-- =====================================================================
-- MOVE DAILY REVIEW INTO HR
--
-- The legacy Daily Review CRM is now replaced inside the HR section of
-- the suite. Module keys and permissions stay unchanged; only navigation
-- ownership and routes move, so existing role grants and stored records
-- continue to work without a data migration.
-- =====================================================================

update public.module_groups
set label = 'HR, PMS & Daily Review'
where key = 'hr';

update public.modules
set group_id = (select id from public.module_groups where key = 'hr'),
    route = case key
      when 'daily.reports' then '/hr/daily-reports'
      when 'daily.summary' then '/hr/review-summary'
      when 'daily.review'  then '/hr/management-review'
    end,
    sort_order = case key
      when 'daily.reports' then 60
      when 'daily.summary' then 70
      when 'daily.review'  then 80
    end,
    updated_at = now()
where key in ('daily.reports', 'daily.summary', 'daily.review');
