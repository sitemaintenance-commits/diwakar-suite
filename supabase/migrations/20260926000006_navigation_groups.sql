-- =====================================================================
-- NAVIGATION: THREE GROUPS THAT WERE SHARING TWO
--
-- Projects and Vendors sat under O&M because that is where the group
-- happened to exist when they were built. They are not O&M work -- a
-- project manager running an installation has nothing to do with plant
-- maintenance -- so they get their own group.
--
-- Daily Review goes back to standing on its own rather than living
-- inside HR. It is a company-wide round across six departments, only
-- one of which is HR.
--
-- Module keys and permissions are untouched, so every existing role
-- grant and every stored record carries over. Only where things appear
-- in the sidebar changes, plus the Daily Review routes, which move back
-- to the paths they had before.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Projects gets its own group, between O&M and HR.
-- ---------------------------------------------------------------------
insert into public.module_groups (key, label, icon, sort_order)
values ('projects', 'Projects', 'FolderKanban', 25)
on conflict (key) do update
  set label = excluded.label, icon = excluded.icon, sort_order = excluded.sort_order;

update public.modules
set group_id = (select id from public.module_groups where key = 'projects'),
    sort_order = case key
      when 'projects.projects'   then 10
      when 'projects.milestones' then 11
      when 'projects.approvals'  then 12
      when 'projects.materials'  then 13
      when 'projects.vendors'    then 14
      when 'projects.bills'      then 15
      when 'projects.payments'   then 16
      else sort_order end,
    updated_at = now()
where key like 'projects.%';

-- ---------------------------------------------------------------------
-- Daily Review stands on its own again, at the routes it used to have.
-- ---------------------------------------------------------------------
insert into public.module_groups (key, label, icon, sort_order)
values ('daily_review', 'Daily Review', 'ClipboardList', 40)
on conflict (key) do update
  set label = excluded.label, icon = excluded.icon, sort_order = excluded.sort_order;

update public.modules
set group_id = (select id from public.module_groups where key = 'daily_review'),
    route = case key
      when 'daily.reports' then '/daily-review/reports'
      when 'daily.summary' then '/daily-review/summary'
      when 'daily.review'  then '/daily-review/management'
    end,
    sort_order = case key
      when 'daily.reports' then 10
      when 'daily.summary' then 20
      when 'daily.review'  then 30
    end,
    updated_at = now()
where key in ('daily.reports', 'daily.summary', 'daily.review');

-- HR is HR again.
update public.module_groups
set label = 'HR & Performance'
where key = 'hr';

-- ---------------------------------------------------------------------
-- O&M should now hold only O&M.
-- ---------------------------------------------------------------------
do $$
declare
  v_strays text;
begin
  select string_agg(m.key, ', ' order by m.key) into v_strays
  from public.modules m
  join public.module_groups g on g.id = m.group_id
  where g.key = 'operations' and m.key not like 'om.%';

  if v_strays is not null then
    raise notice 'Still filed under O&M but not an om.* module: %', v_strays;
  end if;
end $$;
