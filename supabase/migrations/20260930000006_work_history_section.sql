-- Work history is its own item in the HR & Performance menu, after Daily
-- Work. Whoever may view the daily sheets may view their history, with the
-- same reach (their own, their team, or everyone) and the same export.
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select m.group_id, 'hr.history', 'Work History',
       'Daily sheets day by day: calendar per employee and all employees for any period',
       '/hr/work-history', 'CalendarDays', 27, '{view,export}', true, false, true, true, m.phase
from public.modules m where m.key = 'hr.worklog'
on conflict (key) do nothing;

insert into public.role_permissions (role_id, module_id, action, scope)
select rp.role_id, h.id, rp.action, rp.scope
from public.role_permissions rp
join public.modules w on w.id = rp.module_id and w.key = 'hr.worklog'
cross join public.modules h
where h.key = 'hr.history' and rp.action in ('view', 'export')
on conflict (role_id, module_id, action) do nothing;
