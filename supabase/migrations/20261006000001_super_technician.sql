-- =====================================================================
-- SUPER TECHNICIAN
--
-- A technician who can fill the site forms of every plant -- for testing
-- the forms, or standing in when a plant's technician cannot. Same work as
-- the Technician role (daily entry, non-tech activities, tickets), but the
-- role itself opens every site: no plants to tick, and a new plant is
-- covered the day it is added.
--
-- The forms keep one entry per site per day, so a Super Technician and the
-- plant's technician filling the same site and date edit the same entry.
-- =====================================================================
insert into public.roles (key, name, description, is_system)
values ('super_technician', 'Super Technician',
        'Fills the site forms of every plant: daily entry, non-tech activities and tickets.', false)
on conflict (key) do nothing;

-- Everything the Technician role can do.
insert into public.role_permissions (role_id, module_id, action, scope)
select st.id, rp.module_id, rp.action, rp.scope
from public.roles st
join public.roles t on t.key = 'technician'
join public.role_permissions rp on rp.role_id = t.id
where st.key = 'super_technician'
on conflict (role_id, module_id, action) do nothing;

-- The role opens every site, like the "All sites" switch on a user.
create or replace function app.my_site_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case
    when not app.is_active_user() then '{}'::uuid[]
    when app.is_super_admin()
      or (select p.all_sites from public.profiles p where p.id = auth.uid())
      or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                 where ur.user_id = auth.uid() and r.key = 'super_technician')
      then coalesce((select array_agg(s.id) from public.sites s), '{}'::uuid[])
    else coalesce((select array_agg(us.site_id) from public.user_sites us
                   where us.user_id = auth.uid()), '{}'::uuid[])
  end;
$$;
