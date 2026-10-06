-- =====================================================================
-- PROJECT PORTFOLIO PAGES
--
-- The old Project CRM listed tasks, approvals, materials, vendor payment
-- approval and client payments as their own pages, across every site. In
-- the suite they were only tabs of each project. They now also get a page
-- each in the Projects menu, in the old CRM's order; the project page keeps
-- its tabs. Permissions are unchanged: the modules existed already.
-- =====================================================================
update public.modules m
   set route = v.route, show_in_nav = true, label = v.label, icon = v.icon, sort_order = v.ord, description = v.descr
  from (values
    ('projects.milestones', '/projects/tasks',           'Tasks & Templates',       'ListChecks',  11, 'Every project''s execution plan, and the plan templates that create it'),
    ('projects.approvals',  '/projects/approvals',       'Project Approvals',       'ShieldCheck', 12, 'DISCOM, CEIG, net metering, subsidy: reference numbers and expected dates'),
    ('projects.materials',  '/projects/materials',       'Materials',               'Blocks',      13, 'Modules, inverters and BOS: dispatched, received and shortages'),
    ('projects.vendors',    '/projects/vendors',         'Vendors',                 'Handshake',   14, 'Vendor master: GST, category, contact and payment terms'),
    ('projects.bills',      '/projects/vendor-bills',    'Vendor Payment Approval', 'FileText',    15, 'Vendor bills: verification, project-manager and accounts approval, payment'),
    ('projects.payments',   '/projects/client-payments', 'Client Payments',         'ScrollText',  16, 'Client milestones, invoices, receipts and outstanding')
  ) as v(key, route, label, icon, ord, descr)
 where m.key = v.key;
