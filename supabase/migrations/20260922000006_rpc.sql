-- =====================================================================
-- RPC functions (called from the app via supabase.rpc()).
-- Admin RPCs are SECURITY DEFINER but check permissions first and write
-- an audit entry; read RPCs that aggregate data are SECURITY INVOKER so
-- RLS (permissions + site access) applies to every number they return.
-- =====================================================================

-- Small helper: raise a 42501 unless the caller holds module:action.
create or replace function app.require_perm(p_module text, p_action public.perm_action)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.has_perm(p_module, p_action) then
    raise exception 'Access denied: % % permission required.', p_module, upper(p_action::text)
      using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- has_permission: lets the client / edge functions ask about THEMSELVES.
-- ---------------------------------------------------------------------
create or replace function public.has_permission(p_module text, p_action public.perm_action)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.has_perm(p_module, p_action); $$;

-- ---------------------------------------------------------------------
-- get_my_access: everything the frontend needs to build menus & guards.
-- ---------------------------------------------------------------------
create or replace function public.get_my_access()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_super boolean;
  v_profile jsonb;
  v_perms jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
           'id', p.id, 'email', p.email, 'full_name', p.full_name, 'phone', p.phone,
           'avatar_path', p.avatar_path, 'status', p.status, 'all_sites', p.all_sites,
           'last_login_at', p.last_login_at, 'employee_id', p.employee_id,
           'employee_code', e.employee_code, 'department', d.name, 'designation', g.name)
    into v_profile
  from public.profiles p
  left join public.employees e    on e.id = p.employee_id
  left join public.departments d  on d.id = e.department_id
  left join public.designations g on g.id = e.designation_id
  where p.id = v_uid;

  v_super := app.is_super_admin();

  if v_super then
    select coalesce(jsonb_object_agg(m.key, jsonb_build_object(
             'actions', to_jsonb(m.supported_actions),
             'scope', 'all')), '{}'::jsonb)
      into v_perms
    from public.modules m;
  elsif app.is_active_user() then
    select coalesce(jsonb_object_agg(x.key, jsonb_build_object('actions', x.actions, 'scope', x.scope)), '{}'::jsonb)
      into v_perms
    from (
      select m.key,
             jsonb_agg(distinct rp.action) as actions,
             max(rp.scope)                 as scope
      from public.user_roles ur
      join public.roles r             on r.id = ur.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.modules m           on m.id = rp.module_id and m.is_enabled
      where ur.user_id = v_uid
      group by m.key
    ) x;
  else
    v_perms := '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'profile', v_profile,
    'is_super_admin', v_super,
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name) order by r.name)
                       from public.user_roles ur join public.roles r on r.id = ur.role_id
                       where ur.user_id = v_uid and r.is_active), '[]'::jsonb),
    'permissions', v_perms,
    'site_ids', to_jsonb(app.my_site_ids()),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'label', g.label, 'icon', g.icon,
                                                           'sort_order', g.sort_order) order by g.sort_order)
                        from public.module_groups g), '[]'::jsonb),
    'modules', coalesce((select jsonb_agg(jsonb_build_object(
                           'key', m.key, 'label', m.label, 'route', m.route, 'icon', m.icon,
                           'group', g.key, 'sort_order', m.sort_order, 'is_enabled', m.is_enabled,
                           'show_in_nav', m.show_in_nav, 'phase', m.phase) order by g.sort_order, m.sort_order)
                         from public.modules m join public.module_groups g on g.id = m.group_id), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(s.key, s.value) from public.app_settings s), '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- People directory for "Assigned to" pickers (no sensitive fields).
-- ---------------------------------------------------------------------
create or replace function public.list_people(p_search text default null)
returns table (id uuid, full_name text, email text, avatar_path text,
               designation text, department text)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.email::text, p.avatar_path, g.name, d.name
  from public.profiles p
  left join public.employees e    on e.id = p.employee_id
  left join public.departments d  on d.id = e.department_id
  left join public.designations g on g.id = e.designation_id
  where app.is_active_user()
    and p.status = 'active'
    and (p_search is null or p.full_name ilike '%' || p_search || '%' or p.email ilike '%' || p_search || '%')
  order by p.full_name
  limit 200;
$$;

-- ---------------------------------------------------------------------
-- Role permission matrix save (replaces all grants of one role).
--   p_grants: [{ "module": "crm.leads", "action": "view", "scope": "all" }, ...]
-- ---------------------------------------------------------------------
create or replace function public.set_role_permissions(p_role_id uuid, p_grants jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.roles;
  v_before jsonb;
  v_after jsonb;
begin
  perform app.require_perm('admin.roles', 'edit');

  select * into v_role from public.roles where id = p_role_id;
  if not found then
    raise exception 'Role not found.' using errcode = 'P0002';
  end if;
  if v_role.is_system then
    raise exception 'Super Admin permissions are fixed and cannot be changed.' using errcode = '42501';
  end if;

  -- A non-super-admin cannot grant permissions they do not hold themselves.
  if not app.is_super_admin() and exists (
      select 1 from jsonb_to_recordset(p_grants) g(module text, action public.perm_action, scope public.perm_scope)
      join public.modules m on m.key = g.module and g.action = any (m.supported_actions)
      where not app.has_perm(g.module, g.action)) then
    raise exception 'You cannot grant permissions you do not have.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(m.key || ':' || rp.action || ':' || rp.scope order by m.key, rp.action), '[]'::jsonb)
    into v_before
  from public.role_permissions rp join public.modules m on m.id = rp.module_id
  where rp.role_id = p_role_id;

  delete from public.role_permissions where role_id = p_role_id;

  insert into public.role_permissions (role_id, module_id, action, scope, granted_by)
  select p_role_id, m.id, g.action, coalesce(g.scope, 'all'), auth.uid()
  from jsonb_to_recordset(p_grants) g(module text, action public.perm_action, scope public.perm_scope)
  join public.modules m on m.key = g.module and g.action = any (m.supported_actions)
  on conflict do nothing;

  select coalesce(jsonb_agg(m.key || ':' || rp.action || ':' || rp.scope order by m.key, rp.action), '[]'::jsonb)
    into v_after
  from public.role_permissions rp join public.modules m on m.id = rp.module_id
  where rp.role_id = p_role_id;

  perform app.write_audit('permission.change', 'admin.roles', 'roles', p_role_id::text,
    'Permissions updated for role ' || v_role.name,
    jsonb_build_object(
      'added',   (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements_text(v_after) a
                  where not v_before ? a),
      'removed', (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements_text(v_before) b
                  where not v_after ? b)));
end;
$$;

-- ---------------------------------------------------------------------
-- Assign roles to a user (replaces the user's role set).
-- ---------------------------------------------------------------------
create or replace function public.set_user_roles(p_user_id uuid, p_role_ids uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_system uuid := (select id from public.roles where is_system);
  v_before text[];
  v_after text[];
begin
  perform app.require_perm('admin.users', 'assign');
  p_role_ids := coalesce(p_role_ids, '{}');

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  -- Only a Super Admin may grant or revoke the Super Admin role, or change
  -- another Super Admin's roles.
  if not app.is_super_admin() and (
       v_system = any (p_role_ids)
       or exists (select 1 from public.user_roles where user_id = p_user_id and role_id = v_system)) then
    raise exception 'Only a Super Admin can change Super Admin assignments.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() and not app.is_super_admin() then
    raise exception 'You cannot change your own roles.' using errcode = '42501';
  end if;

  -- Never remove the last active Super Admin.
  if exists (select 1 from public.user_roles where user_id = p_user_id and role_id = v_system)
     and not (v_system = any (p_role_ids))
     and not exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                     where ur.role_id = v_system and ur.user_id <> p_user_id and p.status = 'active') then
    raise exception 'The last active Super Admin cannot lose that role.' using errcode = '42501';
  end if;

  select coalesce(array_agg(r.name order by r.name), '{}') into v_before
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id;

  delete from public.user_roles where user_id = p_user_id and not (role_id = any (p_role_ids));
  insert into public.user_roles (user_id, role_id, assigned_by)
  select p_user_id, r.id, auth.uid() from public.roles r where r.id = any (p_role_ids)
  on conflict do nothing;

  select coalesce(array_agg(r.name order by r.name), '{}') into v_after
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id;

  if v_before is distinct from v_after then
    perform app.write_audit('role.assign', 'admin.users', 'profiles', p_user_id::text,
      'Roles changed for ' || (select full_name from public.profiles where id = p_user_id),
      jsonb_build_object('from', v_before, 'to', v_after));
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Site assignment: by user, or by site.
-- ---------------------------------------------------------------------
create or replace function public.set_user_sites(p_user_id uuid, p_site_ids uuid[], p_all_sites boolean default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before text[];
  v_after text[];
begin
  if not (app.has_perm('admin.users', 'assign') or app.has_perm('admin.sites', 'assign')) then
    raise exception 'Access denied: ASSIGN permission required.' using errcode = '42501';
  end if;
  if app.is_super_admin(p_user_id) and not app.is_super_admin() then
    raise exception 'Only a Super Admin can modify another Super Admin.' using errcode = '42501';
  end if;
  p_site_ids := coalesce(p_site_ids, '{}');

  select coalesce(array_agg(s.name order by s.name), '{}') into v_before
  from public.user_sites us join public.sites s on s.id = us.site_id where us.user_id = p_user_id;

  delete from public.user_sites where user_id = p_user_id and not (site_id = any (p_site_ids));
  insert into public.user_sites (user_id, site_id, assigned_by)
  select p_user_id, s.id, auth.uid() from public.sites s where s.id = any (p_site_ids)
  on conflict do nothing;

  if p_all_sites is not null then
    update public.profiles set all_sites = p_all_sites where id = p_user_id and all_sites <> p_all_sites;
  end if;

  select coalesce(array_agg(s.name order by s.name), '{}') into v_after
  from public.user_sites us join public.sites s on s.id = us.site_id where us.user_id = p_user_id;

  if v_before is distinct from v_after then
    perform app.write_audit('site.assign', 'admin.sites', 'profiles', p_user_id::text,
      'Sites changed for ' || (select full_name from public.profiles where id = p_user_id),
      jsonb_build_object('from', v_before, 'to', v_after));
  end if;
end;
$$;

create or replace function public.set_site_users(p_site_id uuid, p_user_ids uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_site text;
  v_added text[];
  v_removed text[];
begin
  perform app.require_perm('admin.sites', 'assign');
  select name into v_site from public.sites where id = p_site_id;
  if v_site is null then
    raise exception 'Site not found.' using errcode = 'P0002';
  end if;
  p_user_ids := coalesce(p_user_ids, '{}');

  select coalesce(array_agg(p.full_name), '{}') into v_removed
  from public.user_sites us join public.profiles p on p.id = us.user_id
  where us.site_id = p_site_id and not (us.user_id = any (p_user_ids));

  select coalesce(array_agg(p.full_name), '{}') into v_added
  from public.profiles p
  where p.id = any (p_user_ids)
    and not exists (select 1 from public.user_sites us where us.site_id = p_site_id and us.user_id = p.id);

  delete from public.user_sites where site_id = p_site_id and not (user_id = any (p_user_ids));
  insert into public.user_sites (user_id, site_id, assigned_by)
  select p.id, p_site_id, auth.uid() from public.profiles p where p.id = any (p_user_ids)
  on conflict do nothing;

  if cardinality(v_added) + cardinality(v_removed) > 0 then
    perform app.write_audit('site.assign', 'admin.sites', 'sites', p_site_id::text,
      'User assignments changed for site ' || v_site,
      jsonb_build_object('added', v_added, 'removed', v_removed));
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- admin_save_user: profile + employee record (+ optional roles/sites)
-- in one transaction. Used by the Users page and by the admin-users edge
-- function right after it creates the auth account.
--
-- p_data keys (all optional): full_name, phone, employee_code, department_id,
--   designation_id, joining_date, reporting_manager_id, role_ids[], site_ids[],
--   all_sites
-- ---------------------------------------------------------------------
create or replace function public.admin_save_user(p_user_id uuid, p_data jsonb, p_is_new boolean default false)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_emp uuid;
  v_emp_fields jsonb;
begin
  perform app.require_perm('admin.users', case when p_is_new then 'create' else 'edit' end::public.perm_action);

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  if app.is_super_admin(p_user_id) and not app.is_super_admin() and p_user_id <> auth.uid() then
    raise exception 'Only a Super Admin can modify another Super Admin.' using errcode = '42501';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p_data->>'full_name'), ''), full_name),
         phone     = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else phone end
   where id = p_user_id;

  -- Employee record (HR master) — create or update the linked one.
  v_emp_fields := p_data - array['full_name','phone','role_ids','site_ids','all_sites'];
  if v_emp_fields <> '{}'::jsonb or v_profile.employee_id is not null or p_is_new then
    v_emp := v_profile.employee_id;
    if v_emp is null then
      insert into public.employees (employee_code, full_name, email, phone)
      values (coalesce(nullif(trim(p_data->>'employee_code'), ''),
                       'DS-' || nextval('public.employee_code_seq')::text),
              coalesce(nullif(trim(p_data->>'full_name'), ''), v_profile.full_name),
              v_profile.email, nullif(trim(p_data->>'phone'), ''))
      returning id into v_emp;
      update public.profiles set employee_id = v_emp where id = p_user_id;
    end if;

    update public.employees e
       set employee_code  = coalesce(nullif(trim(p_data->>'employee_code'), ''), e.employee_code),
           full_name      = coalesce(nullif(trim(p_data->>'full_name'), ''), e.full_name),
           email          = v_profile.email,
           phone          = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else e.phone end,
           department_id  = case when p_data ? 'department_id' then nullif(p_data->>'department_id', '')::uuid else e.department_id end,
           designation_id = case when p_data ? 'designation_id' then nullif(p_data->>'designation_id', '')::uuid else e.designation_id end,
           joining_date   = case when p_data ? 'joining_date' then nullif(p_data->>'joining_date', '')::date else e.joining_date end,
           reporting_manager_id = case when p_data ? 'reporting_manager_id'
                                       then nullif(p_data->>'reporting_manager_id', '')::uuid else e.reporting_manager_id end
     where e.id = v_emp;
  end if;

  if p_data ? 'role_ids' then
    perform public.set_user_roles(p_user_id,
      array(select jsonb_array_elements_text(p_data->'role_ids')::uuid));
  end if;
  if p_data ? 'site_ids' or p_data ? 'all_sites' then
    perform public.set_user_sites(p_user_id,
      case when p_data ? 'site_ids'
           then array(select jsonb_array_elements_text(p_data->'site_ids')::uuid)
           else array(select site_id from public.user_sites where user_id = p_user_id) end,
      case when p_data ? 'all_sites' then (p_data->>'all_sites')::boolean end);
  end if;

  if p_is_new then
    perform app.write_audit('user.create', 'admin.users', 'profiles', p_user_id::text,
      'User created: ' || coalesce(nullif(trim(p_data->>'full_name'), ''), v_profile.full_name)
      || ' <' || v_profile.email || '>');
  end if;
end;
$$;

-- Activate / deactivate (the edge function additionally bans the auth user).
create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.user_status)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('admin.users', 'edit');
  if p_status = 'invited' then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  update public.profiles set status = p_status where id = p_user_id;   -- guard_profiles enforces rules
  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  perform app.write_audit(case when p_status = 'active' then 'user.activate' else 'user.deactivate' end,
    'admin.users', 'profiles', p_user_id::text,
    'User ' || case when p_status = 'active' then 'activated' else 'deactivated' end || ': '
    || (select full_name from public.profiles where id = p_user_id));
end;
$$;

-- ---------------------------------------------------------------------
-- Client-originated audit events (strict allow-list).
-- ---------------------------------------------------------------------
create or replace function public.log_event(p_action text, p_module text default null,
                                            p_summary text default null, p_details jsonb default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if p_action not in ('logout', 'export', 'password.change', 'user.invite', 'user.password_reset', 'user.resend_invite') then
    raise exception 'Event type not allowed.' using errcode = '22023';
  end if;
  if p_action = 'export' and (p_module is null or not app.has_perm(p_module, 'export')) then
    raise exception 'Export not permitted.' using errcode = '42501';
  end if;
  if p_action in ('user.invite', 'user.password_reset', 'user.resend_invite')
     and not app.has_perm('admin.users', 'edit') and not app.has_perm('admin.users', 'create') then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  perform app.write_audit(p_action, p_module, null, null, left(p_summary, 500), p_details);
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard summary. SECURITY INVOKER: every count passes through RLS, so
-- a user with 5 sites gets totals for exactly those 5. Sections are only
-- present when the caller has VIEW on the underlying module. Numbers are
-- always non-null (coalesce to 0). Later phases add their sections here.
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard_summary()
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
begin
  if not public.has_permission('dashboard', 'view') then
    return v;
  end if;

  -- Sites visible to the caller (assigned sites, or all for site admins)
  v := v || jsonb_build_object('sites', jsonb_build_object(
    'total',        coalesce((select count(*) from public.sites), 0),
    'active',       coalesce((select count(*) from public.sites where status = 'active'), 0),
    'capacity_kwp', coalesce((select sum(capacity_kwp) from public.sites where status = 'active'), 0)));

  if public.has_permission('admin.users', 'view') then
    v := v || jsonb_build_object('users', jsonb_build_object(
      'total',    coalesce((select count(*) from public.profiles), 0),
      'active',   coalesce((select count(*) from public.profiles where status = 'active'), 0),
      'invited',  coalesce((select count(*) from public.profiles where status = 'invited'), 0),
      'inactive', coalesce((select count(*) from public.profiles where status = 'inactive'), 0)));
  end if;

  if public.has_permission('admin.roles', 'view') then
    v := v || jsonb_build_object('roles', jsonb_build_object(
      'total',  coalesce((select count(*) from public.roles), 0),
      'custom', coalesce((select count(*) from public.roles where not is_system), 0)));
  end if;

  if public.has_permission('admin.audit', 'view') then
    v := v || jsonb_build_object('audit', jsonb_build_object(
      'today', coalesce((select count(*) from public.audit_logs
                         where occurred_at >= (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata'), 0),
      'logins_today', coalesce((select count(*) from public.audit_logs
                         where action = 'login'
                           and occurred_at >= (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata'), 0)));
  end if;

  if public.has_permission('hr.employees', 'view') or public.has_permission('admin.users', 'view') then
    v := v || jsonb_build_object('employees', jsonb_build_object(
      'total',  coalesce((select count(*) from public.employees), 0),
      'active', coalesce((select count(*) from public.employees where status = 'active'), 0)));
  end if;

  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- One-time bootstrap: promote the first account to Super Admin.
-- Only callable from the SQL editor / service role (not from the app),
-- and only while no Super Admin exists.
-- ---------------------------------------------------------------------
create or replace function app.bootstrap_super_admin(p_email text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role uuid := (select id from public.roles where is_system);
begin
  if exists (select 1 from public.user_roles where role_id = v_role) then
    raise exception 'A Super Admin already exists. Use User Management instead.';
  end if;
  select id into v_uid from public.profiles where email = p_email::public.citext;
  if v_uid is null then
    raise exception 'No account with email %. Create the user in Supabase Auth first.', p_email;
  end if;
  update public.profiles set status = 'active', all_sites = true where id = v_uid;
  insert into public.user_roles (user_id, role_id) values (v_uid, v_role);
  perform app.write_audit('role.assign', 'admin.users', 'profiles', v_uid::text,
                          'Bootstrap: Super Admin granted to ' || p_email, null, v_uid);
  return 'Super Admin granted to ' || p_email;
end;
$$;
revoke execute on function app.bootstrap_super_admin(text) from public, authenticated;

-- Grants
grant execute on function
  public.has_permission(text, public.perm_action),
  public.get_my_access(),
  public.list_people(text),
  public.set_role_permissions(uuid, jsonb),
  public.set_user_roles(uuid, uuid[]),
  public.set_user_sites(uuid, uuid[], boolean),
  public.set_site_users(uuid, uuid[]),
  public.admin_save_user(uuid, jsonb, boolean),
  public.admin_set_user_status(uuid, public.user_status),
  public.log_event(text, text, text, jsonb),
  public.get_dashboard_summary()
to authenticated;

revoke execute on function
  public.get_my_access(), public.list_people(text), public.set_role_permissions(uuid, jsonb),
  public.set_user_roles(uuid, uuid[]), public.set_user_sites(uuid, uuid[], boolean),
  public.set_site_users(uuid, uuid[]), public.admin_save_user(uuid, jsonb, boolean),
  public.admin_set_user_status(uuid, public.user_status), public.log_event(text, text, text, jsonb),
  public.get_dashboard_summary(), public.has_permission(text, public.perm_action),
  public.soft_delete_record(text, uuid)
from anon, public;
