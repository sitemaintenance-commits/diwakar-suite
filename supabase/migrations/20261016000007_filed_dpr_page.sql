-- =====================================================================
-- FILED DPRs: THEIR OWN PAGE IN PROJECTS
--
-- Site Updates (DPR) is now only the form; the reports already filed get
-- a page of their own, "Filed DPRs". Whoever can see Site Updates can see
-- it (same view / export rights), and nothing else changes: the reports
-- are read through list_site_updates as before.
-- =====================================================================

insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select m.group_id, 'projects.dpr_filed', 'Filed DPRs', 'Every Daily Progress Report filed, by site and date',
       '/projects/filed-dpr', 'FileText', m.sort_order, '{view,export}'::public.perm_action[], true, false, true, true, 4
from public.modules m where m.key = 'projects.updates'
on conflict (key) do update
  set label = excluded.label, route = excluded.route, show_in_nav = true, is_enabled = true, updated_at = now();

insert into public.role_permissions (role_id, module_id, action, scope)
select rp.role_id, (select id from public.modules where key = 'projects.dpr_filed'), rp.action, rp.scope
from public.role_permissions rp
join public.modules m on m.id = rp.module_id and m.key = 'projects.updates'
where rp.action in ('view', 'export')
on conflict do nothing;
