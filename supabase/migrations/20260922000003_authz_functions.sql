-- =====================================================================
-- Authorization core.
--
-- Every RLS policy in the system is expressed through these functions.
-- They are SECURITY DEFINER so they can read the RBAC tables regardless
-- of the caller's own RLS, and STABLE so that, when wrapped in
-- "(select app.fn(...))" inside a policy, Postgres evaluates them once
-- per statement instead of once per row.
--
-- Rules:
--   * Inactive / invited-but-never-activated users have NO permissions.
--   * Super Admin (the is_system role) has every permission and all sites.
--   * Effective permission = UNION of all active roles; widest scope wins.
--   * Role names are never checked here — only module keys and actions.
-- =====================================================================

create or replace function app.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function app.is_super_admin(p_user uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r    on r.id = ur.role_id and r.is_system and r.is_active
    join public.profiles p on p.id = ur.user_id and p.status = 'active'
    where ur.user_id = coalesce(p_user, auth.uid())
  );
$$;

create or replace function app.has_perm(p_module text, p_action public.perm_action)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when app.is_super_admin() then true
    else exists (
      select 1
      from public.user_roles ur
      join public.profiles p         on p.id = ur.user_id and p.status = 'active'
      join public.roles r            on r.id = ur.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = ur.role_id and rp.action = p_action
      join public.modules m          on m.id = rp.module_id and m.key = p_module and m.is_enabled
      where ur.user_id = auth.uid()
    )
  end;
$$;

-- Widest data scope the caller holds for module+action (NULL = no access).
create or replace function app.perm_scope(p_module text, p_action public.perm_action)
returns public.perm_scope
language sql stable security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then null
    when app.is_super_admin() then 'all'::public.perm_scope
    else (
      select max(rp.scope)
      from public.user_roles ur
      join public.profiles p          on p.id = ur.user_id and p.status = 'active'
      join public.roles r             on r.id = ur.role_id and r.is_active
      join public.role_permissions rp on rp.role_id = ur.role_id and rp.action = p_action
      join public.modules m           on m.id = rp.module_id and m.key = p_module and m.is_enabled
      where ur.user_id = auth.uid()
    )
  end;
$$;

-- True if the caller holds ANY permission on a module (used for "view any").
create or replace function app.has_any_perm(p_modules text[], p_action public.perm_action default 'view')
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from unnest(p_modules) k where app.has_perm(k, p_action));
$$;

-- Sites the caller may access. Super Admin / all_sites users get every site.
create or replace function app.my_site_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select case
    when not app.is_active_user() then '{}'::uuid[]
    when app.is_super_admin()
      or (select p.all_sites from public.profiles p where p.id = auth.uid())
      then coalesce((select array_agg(s.id) from public.sites s), '{}'::uuid[])
    else coalesce((select array_agg(us.site_id) from public.user_sites us
                   where us.user_id = auth.uid()), '{}'::uuid[])
  end;
$$;

create or replace function app.can_access_site(p_site uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_site = any (app.my_site_ids());
$$;

-- The caller plus every user whose employee record reports (directly or
-- indirectly) to the caller's employee record.
create or replace function app.my_team_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  with recursive me as (
    select p.employee_id from public.profiles p where p.id = auth.uid()
  ), tree as (
    select e.id from public.employees e join me on e.reporting_manager_id = me.employee_id
    union
    select e.id from public.employees e join tree t on e.reporting_manager_id = t.id
  )
  select array_append(
    coalesce((select array_agg(p.id) from public.profiles p where p.employee_id in (select id from tree)), '{}'::uuid[]),
    auth.uid());
$$;

-- Generic scope test used by standard policies:
--   all -> true; team -> an owner is in my team; own -> I am one of the owners.
create or replace function app.in_scope(p_scope public.perm_scope, p_owners uuid[], p_me uuid, p_team uuid[])
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_scope
    when 'all'  then true
    when 'team' then p_owners && p_team
    when 'own'  then p_me = any (p_owners)
    else false
  end;
$$;

grant execute on all functions in schema app to authenticated, service_role;
