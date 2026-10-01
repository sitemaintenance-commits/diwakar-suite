-- =====================================================================
-- DEPARTMENT REVIEW COORDINATOR
--
-- One person files every department's report of the day -- the Chief
-- Coordination Manager, Jitendra Sharma -- and writes the CCM remarks.
-- No existing role fits: Admin opens everything, Management cannot file,
-- and the managers' roles file only reports they created themselves.
--
-- The role files and edits any department's report, reads and exports the
-- Review Summary, and writes remarks in Management Review. Marking a
-- report reviewed (approve) stays with management. Jitendra keeps the
-- Employee role for his own Daily Work sheet.
-- =====================================================================
insert into public.roles (key, name, description, is_system)
values ('review_coordinator', 'Department Review Coordinator',
        'Files every department''s daily report and writes the CCM remarks.', false)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, g.action::public.perm_action, 'all'
from public.roles r
cross join (values
  ('dashboard', 'view'), ('documents', 'view'), ('documents', 'export'),
  ('daily.reports', 'view'), ('daily.reports', 'create'), ('daily.reports', 'edit'), ('daily.reports', 'export'),
  ('daily.summary', 'view'), ('daily.summary', 'export'),
  ('daily.review', 'view'), ('daily.review', 'create')
) as g(module, action)
join public.modules m on m.key = g.module and g.action::public.perm_action = any (m.supported_actions)
where r.key = 'review_coordinator'
on conflict (role_id, module_id, action) do nothing;

-- Jitendra Sharma (DRIPL_1108), if he has a login on this database.
insert into public.user_roles (user_id, role_id)
select p.id, r.id
from public.employees e
join public.profiles p on p.employee_id = e.id
cross join public.roles r
where e.employee_code = 'DRIPL_1108' and e.deleted_at is null and r.key = 'review_coordinator'
on conflict do nothing;
