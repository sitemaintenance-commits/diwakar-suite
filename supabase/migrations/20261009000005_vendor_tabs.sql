-- Vendor Payment Approval and Client Payments are tabs of the Vendors page
-- now, not menu entries of their own. Their permissions are unchanged.
update public.modules set show_in_nav = false, route = '/projects/vendors'
 where key in ('projects.bills', 'projects.payments');
