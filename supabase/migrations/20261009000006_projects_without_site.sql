-- =====================================================================
-- A PROJECT DOES NOT NEED AN O&M SITE YET
--
-- The projects table used the standard site rule: a row's site must be one
-- of the caller's sites. A new project at a new location has no site yet
-- (its O&M site is added once it is built), and NULL never passes that
-- check -- so nobody could create a project without picking a site, and
-- nobody but those with all sites could see one. A project without a site
-- is now allowed; a project linked to a site still follows the site rule.
-- The permission and scope checks are unchanged.
-- =====================================================================

drop policy if exists std_select on public.projects;
create policy std_select on public.projects for select to authenticated
  using ((deleted_at is null)
     and (select app.has_perm('projects.projects', 'view'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('projects.projects', 'view')),
                      array[created_by, project_manager_id, site_engineer_id],
                      (select auth.uid()), (select app.my_team_ids())));

drop policy if exists std_insert on public.projects;
create policy std_insert on public.projects for insert to authenticated
  with check ((select app.has_perm('projects.projects', 'create'))
          and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));

drop policy if exists std_update on public.projects;
create policy std_update on public.projects for update to authenticated
  using ((deleted_at is null)
     and (select app.has_perm('projects.projects', 'edit'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('projects.projects', 'edit')),
                      array[created_by, project_manager_id, site_engineer_id],
                      (select auth.uid()), (select app.my_team_ids())))
  with check (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]));
