-- =====================================================================
-- Reference data: module catalogue (all phases), default roles and their
-- permission matrix, departments, known sites and system settings.
-- No business/production data is created here.
-- Modules of later phases are seeded DISABLED; each phase's migration
-- enables its modules once the feature ships.
-- =====================================================================

alter table public.departments  disable trigger audit_row;
alter table public.sites        disable trigger audit_row;
alter table public.roles        disable trigger audit_row;
alter table public.modules      disable trigger audit_row;
alter table public.app_settings disable trigger audit_row;

insert into public.module_groups (key, label, icon, sort_order) values
  ('dashboard',    'Dashboard',        'LayoutDashboard', 0),
  ('crm',          'CRM',              'Handshake',       10),
  ('operations',   'Operations',       'Sun',             20),
  ('hr',           'HR & Performance', 'Users',           30),
  ('daily_review', 'Daily Review',     'ClipboardList',   40),
  ('analytics',    'Analytics',        'BarChart3',       50),
  ('admin',        'Administration',   'Shield',          60);

insert into public.modules
  (group_id, key, label, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase, description)
select g.id, m.key, m.label, m.route, m.icon, m.sort_order, m.actions::public.perm_action[],
       m.supports_scope, m.site_scoped, m.nav, m.phase = 1, m.phase, m.description
from (values
  -- group        key                    label             route                         icon             ord actions                                              scope  site   nav    phase description
  ('dashboard',   'dashboard',           'Dashboard',      '/',                          'LayoutDashboard', 0, '{view}',                                            false, false, true,  1, 'Central management dashboard'),

  ('crm',         'crm.leads',           'Leads',          '/crm/leads',                 'Target',        10, '{view,create,edit,delete,export,assign}',           true,  false, true,  2, 'Sales leads and pipeline'),
  ('crm',         'crm.customers',       'Customers',      '/crm/customers',             'Building2',     20, '{view,create,edit,delete,export}',                  true,  false, true,  2, 'Customer master'),
  ('crm',         'crm.quotations',      'Quotations',     '/crm/quotations',            'FileText',      30, '{view,create,edit,delete,export,approve}',          true,  false, true,  2, 'Quotations with approval'),
  ('crm',         'crm.followups',       'Follow-ups',     '/crm/follow-ups',            'PhoneCall',     40, '{view,create,edit,delete,export,assign}',           true,  false, true,  2, 'Lead and customer follow-ups'),

  ('operations',  'projects.projects',   'Projects',       '/operations/projects',       'FolderKanban',  10, '{view,create,edit,delete,export,approve,assign}',   true,  false, true,  3, 'Project management'),
  ('operations',  'projects.milestones', 'Milestones',     null,                         'Flag',          11, '{view,create,edit,delete}',                         true,  false, false, 3, 'Project milestones'),
  ('operations',  'om.sites',            'Solar Sites',    '/operations/solar-sites',    'SunMedium',     20, '{view,create,edit,delete,export}',                  false, true,  true,  4, 'Solar plant technical details'),
  ('operations',  'om.monitor',          'Solar Monitor',  '/operations/monitor',        'Activity',      30, '{view,export}',                                     false, true,  true,  4, 'Generation & availability monitoring'),
  ('operations',  'om.generation',       'Generation',     '/operations/generation',     'Zap',           40, '{view,create,edit,delete,export,approve}',          false, true,  true,  4, 'Daily generation records'),
  ('operations',  'om.maintenance',      'Maintenance',    '/operations/maintenance',    'Wrench',        50, '{view,create,edit,delete,export,approve,assign}',   true,  true,  true,  4, 'Preventive and corrective maintenance'),
  ('operations',  'om.tickets',          'Tickets',        '/operations/tickets',        'Ticket',        60, '{view,create,edit,delete,export,approve,assign}',   true,  true,  true,  4, 'Breakdown tickets'),
  ('operations',  'om.equipment',        'Equipment',      null,                         'Cpu',           70, '{view,create,edit,delete,export}',                  false, true,  false, 4, 'Site equipment register'),

  ('hr',          'hr.employees',        'Employees',      '/hr/employees',              'Contact',       10, '{view,create,edit,delete,export}',                  true,  false, true,  5, 'Employee master'),
  ('hr',          'hr.employees_private','Employee Private Data', null,                  'LockKeyhole',   11, '{view,create,edit}',                                false, false, false, 5, 'Salary, bank, identity documents'),
  ('hr',          'hr.attendance',       'Attendance',     '/hr/attendance',             'CalendarCheck', 20, '{view,create,edit,delete,export,approve}',          true,  false, true,  5, 'Attendance'),
  ('hr',          'hr.performance',      'Performance',    '/hr/performance',            'TrendingUp',    30, '{view,create,edit,delete,export,approve}',          true,  false, true,  5, 'Performance reviews & goals'),
  ('hr',          'hr.leave',            'Leave',          '/hr/leave',                  'CalendarOff',   35, '{view,create,edit,delete,export,approve}',          true,  false, true,  5, 'Leave requests'),
  ('hr',          'tasks',               'Task Log',       '/hr/tasks',                  'ListChecks',    40, '{view,create,edit,delete,export,assign}',           true,  false, true,  3, 'Central task management'),
  ('hr',          'hr.org',              'Departments',    '/hr/departments',            'Network',       50, '{view,create,edit,delete}',                         false, false, true,  1, 'Departments and designations'),

  ('daily_review','daily.reports',       'Daily Reports',  '/daily-review/reports',      'ClipboardList', 10, '{view,create,edit,delete,export,approve}',          true,  false, true,  6, 'Daily reports'),
  ('daily_review','daily.summary',       'Review Summary', '/daily-review/summary',      'ClipboardCheck',20, '{view,export}',                                     false, false, true,  6, 'History comparison and monthly summary'),
  ('daily_review','daily.review',        'Management Review','/daily-review/management', 'MessageSquareText',30,'{view,create,edit,approve}',                     false, false, true,  6, 'CCM / Founder remarks and review'),

  ('analytics',   'reports.crm',         'CRM Reports',        null, 'BarChart3', 10, '{view,export}', false, false, false, 7, 'CRM reports'),
  ('analytics',   'reports.projects',    'Project Reports',    null, 'BarChart3', 20, '{view,export}', false, false, false, 7, 'Project reports'),
  ('analytics',   'reports.om',          'O&M Reports',        null, 'BarChart3', 30, '{view,export}', false, false, false, 7, 'O&M reports'),
  ('analytics',   'reports.generation',  'Generation Reports', null, 'BarChart3', 40, '{view,export}', false, false, false, 7, 'Generation reports'),
  ('analytics',   'reports.hr',          'HR Reports',         null, 'BarChart3', 50, '{view,export}', false, false, false, 7, 'HR reports'),
  ('analytics',   'reports.daily',       'Daily Review Reports', null, 'BarChart3', 60, '{view,export}', false, false, false, 7, 'Daily review reports'),

  ('admin',       'admin.users',         'User Management','/admin/users',               'UserCog',       10, '{view,create,edit,export,assign}',                  false, false, true,  1, 'Users, invitations, roles and sites'),
  ('admin',       'admin.roles',         'Role Management','/admin/roles',               'ShieldCheck',   20, '{view,create,edit,delete}',                         false, false, true,  1, 'Roles and permission matrix'),
  ('admin',       'admin.modules',       'Module Management','/admin/modules',           'Blocks',        30, '{view,edit}',                                       false, false, true,  1, 'Enable, rename and order modules'),
  ('admin',       'admin.sites',         'Site Management','/admin/sites',               'MapPin',        40, '{view,create,edit,delete,export,assign}',           false, false, true,  1, 'Sites and site assignments'),
  ('admin',       'admin.audit',         'Audit Log',      '/admin/audit-log',           'ScrollText',    50, '{view,export}',                                     false, false, true,  1, 'Security and activity log'),
  ('admin',       'admin.settings',      'System Settings','/admin/settings',            'Settings',      60, '{view,edit}',                                       false, false, true,  1, 'Company and system settings')
) as m(grp, key, label, route, icon, sort_order, actions, supports_scope, site_scoped, nav, phase, description)
join public.module_groups g on g.key = m.grp;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('super_admin',     'Super Admin',     'Full, irrevocable access to everything', true),
  ('admin',           'Admin',           'Administers users, sites and all business modules', false),
  ('management',      'Management',      'Views and approves across the organisation', false),
  ('sales_executive', 'Sales Executive', 'Works own leads, customers, quotations and follow-ups', false),
  ('project_manager', 'Project Manager', 'Manages own projects, milestones and tasks', false),
  ('hr_admin',        'HR Admin',        'Manages HR / PMS modules', false),
  ('om_manager',      'O&M Manager',     'Manages O&M for assigned sites', false),
  ('technician',      'Technician',      'Works assigned tickets, maintenance and tasks on assigned sites', false);

-- Seeding helper (dropped at the end of this migration).
create function app._grant(p_role text, p_modules text[], p_actions text[], p_scope public.perm_scope default 'all')
returns void language sql as $$
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a::public.perm_action, p_scope
  from public.roles r
  join public.modules m on m.key = any (p_modules)
  cross join unnest(p_actions) a
  where r.key = p_role and a::public.perm_action = any (m.supported_actions)
  on conflict (role_id, module_id, action) do update set scope = excluded.scope;
$$;

do $$
declare
  all_actions text[] := array['view','create','edit','delete','export','approve','assign'];
  business text[] := array['crm.leads','crm.customers','crm.quotations','crm.followups',
                           'projects.projects','projects.milestones',
                           'om.sites','om.monitor','om.generation','om.maintenance','om.tickets','om.equipment',
                           'hr.employees','hr.attendance','hr.performance','hr.leave','tasks',
                           'daily.reports','daily.summary','daily.review'];
  reports text[] := array['reports.crm','reports.projects','reports.om','reports.generation','reports.hr','reports.daily'];
  om text[] := array['om.sites','om.monitor','om.generation','om.maintenance','om.tickets','om.equipment'];
begin
  -- Admin: everything except sensitive HR data (super admin is implicit).
  perform app._grant('admin', array(select key from public.modules where key <> 'hr.employees_private'), all_actions);

  -- Management: organisation-wide view/export, approvals.
  perform app._grant('management', array['dashboard'] || business || reports, array['view','export']);
  perform app._grant('management', array['crm.quotations','projects.projects','daily.reports','daily.review',
                                         'hr.leave','hr.performance'], array['approve']);
  perform app._grant('management', array['daily.review'], array['create','edit']);
  perform app._grant('management', array['admin.users','admin.sites','admin.audit','hr.org'], array['view']);

  -- Sales Executive: own CRM records.
  perform app._grant('sales_executive', array['dashboard'], array['view']);
  perform app._grant('sales_executive', array['crm.leads','crm.customers','crm.quotations','crm.followups'],
                     array['view','create','edit'], 'own');
  perform app._grant('sales_executive', array['reports.crm'], array['view']);
  perform app._grant('sales_executive', array['tasks','daily.reports'], array['view','create','edit'], 'own');

  -- Project Manager: own projects (managed or member).
  perform app._grant('project_manager', array['dashboard'], array['view']);
  perform app._grant('project_manager', array['projects.projects'], array['view','create','edit','export','assign'], 'own');
  perform app._grant('project_manager', array['projects.milestones'], array['view','create','edit','delete'], 'own');
  perform app._grant('project_manager', array['tasks'], array['view','create','edit','export','assign'], 'team');
  perform app._grant('project_manager', array['crm.customers'], array['view']);
  perform app._grant('project_manager', array['reports.projects'], array['view','export']);
  perform app._grant('project_manager', array['daily.reports'], array['view','create','edit'], 'own');

  -- HR Admin: all HR incl. private data.
  perform app._grant('hr_admin', array['dashboard'], array['view']);
  perform app._grant('hr_admin', array['hr.employees','hr.employees_private','hr.attendance','hr.performance',
                                       'hr.leave','hr.org','tasks'], all_actions);
  perform app._grant('hr_admin', array['reports.hr'], array['view','export']);
  perform app._grant('hr_admin', array['admin.users','daily.reports'], array['view']);

  -- O&M Manager: all O&M for assigned sites.
  perform app._grant('om_manager', array['dashboard'], array['view']);
  perform app._grant('om_manager', om, all_actions);
  perform app._grant('om_manager', array['tasks'], array['view','create','edit','export','assign']);
  perform app._grant('om_manager', array['reports.om','reports.generation'], array['view','export']);
  perform app._grant('om_manager', array['projects.projects'], array['view']);
  perform app._grant('om_manager', array['daily.reports'], array['view','create','edit'], 'own');

  -- Technician: own work on assigned sites.
  perform app._grant('technician', array['dashboard','om.sites','om.equipment','om.monitor'], array['view']);
  perform app._grant('technician', array['om.tickets'], array['view','create','edit'], 'own');
  perform app._grant('technician', array['om.maintenance'], array['view','edit'], 'own');
  perform app._grant('technician', array['om.generation'], array['view','create']);
  perform app._grant('technician', array['tasks','daily.reports'], array['view','create','edit'], 'own');
end $$;

drop function app._grant(text, text[], text[], public.perm_scope);

-- ---------------------------------------------------------------------
-- Departments (from the existing Daily Review CRM)
-- ---------------------------------------------------------------------
insert into public.departments (name, code, color) values
  ('Design & Engineering',    'DESIGN',  '#0284C7'),
  ('Procurement & Stores',    'PROC',    '#0F766E'),
  ('Projects & Installation', 'PROJ',    '#4F46E5'),
  ('O&M / Service',           'OM',      '#F59E0B'),
  ('HR',                      'HR',      '#059669'),
  ('Admin',                   'ADMIN',   '#64748B'),
  ('Accounts & Finance',      'ACCTS',   '#DB2777');

-- ---------------------------------------------------------------------
-- Known sites. Capacity and location are intentionally left blank/0 —
-- Super Admin must complete them in Site Management.
-- ---------------------------------------------------------------------
insert into public.sites (code, name) values
  ('SADAS', 'Sadas'), ('THIKARIYA', 'Thikariya'), ('BASSI', 'Bassi'),
  ('SUAAP', 'Suaap'), ('PHALODI', 'Phalodi');

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('company_name',       '"Diwakar Renewable & Infra Pvt. Ltd."'),
  ('brand_name',         '"Diwakar Solar"'),
  ('suite_name',         '"Management Suite"'),
  ('timezone',           '"Asia/Kolkata"'),
  ('currency',           '"INR"'),
  ('fiscal_year_start_month', '4'),
  ('support_email',      '""');

alter table public.departments  enable trigger audit_row;
alter table public.sites        enable trigger audit_row;
alter table public.roles        enable trigger audit_row;
alter table public.modules      enable trigger audit_row;
alter table public.app_settings enable trigger audit_row;
