-- =====================================================================
-- Row Level Security for the Phase 1 tables, plus the reusable
-- "standard policy" generator that every business module (CRM, Projects,
-- O&M, HR, Daily Review) will use in later phases.
-- =====================================================================

-- Helpers for HR-style ownership
create or replace function app.my_employee_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.employee_id from public.profiles p where p.id = auth.uid() and p.status = 'active';
$$;

create or replace function app.my_team_employee_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  with recursive tree as (
    select e.id from public.employees e where e.reporting_manager_id = app.my_employee_id()
    union
    select e.id from public.employees e join tree t on e.reporting_manager_id = t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from tree;
$$;

grant execute on function app.my_employee_id(), app.my_team_employee_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere (no table is readable without a policy)
-- ---------------------------------------------------------------------
alter table public.departments      enable row level security;
alter table public.designations     enable row level security;
alter table public.employees        enable row level security;
alter table public.employee_private enable row level security;
alter table public.profiles         enable row level security;
alter table public.module_groups    enable row level security;
alter table public.modules          enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.sites            enable row level security;
alter table public.user_sites       enable row level security;
alter table public.app_settings     enable row level security;
alter table public.audit_logs       enable row level security;

-- The anon role gets nothing from any table.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- Organization (non-sensitive lookups: readable by any active user)
-- ---------------------------------------------------------------------
create policy departments_select on public.departments for select to authenticated
  using ((select app.is_active_user()));
create policy departments_insert on public.departments for insert to authenticated
  with check ((select app.has_perm('hr.org', 'create')));
create policy departments_update on public.departments for update to authenticated
  using ((select app.has_perm('hr.org', 'edit'))) with check (true);
create policy departments_delete on public.departments for delete to authenticated
  using ((select app.has_perm('hr.org', 'delete')));

create policy designations_select on public.designations for select to authenticated
  using ((select app.is_active_user()));
create policy designations_insert on public.designations for insert to authenticated
  with check ((select app.has_perm('hr.org', 'create')));
create policy designations_update on public.designations for update to authenticated
  using ((select app.has_perm('hr.org', 'edit'))) with check (true);
create policy designations_delete on public.designations for delete to authenticated
  using ((select app.has_perm('hr.org', 'delete')));

-- ---------------------------------------------------------------------
-- Employees (HR master). Visible to: HR view (by scope), user admins,
-- and each employee for their own record. Soft-deleted rows are hidden.
-- ---------------------------------------------------------------------
create policy employees_select on public.employees for select to authenticated
  using (
    deleted_at is null and (
      (select app.perm_scope('hr.employees', 'view')) = 'all'
      or (select app.has_perm('admin.users', 'view'))
      or id = (select app.my_employee_id())
      or ((select app.perm_scope('hr.employees', 'view')) = 'team'
          and id = any ((select app.my_team_employee_ids())::uuid[]))
    ));
create policy employees_insert on public.employees for insert to authenticated
  with check ((select app.has_perm('hr.employees', 'create')));
create policy employees_update on public.employees for update to authenticated
  using (
    deleted_at is null and (
      (select app.perm_scope('hr.employees', 'edit')) = 'all'
      or ((select app.perm_scope('hr.employees', 'edit')) = 'team'
          and id = any ((select app.my_team_employee_ids())::uuid[]))
    ))
  with check (true);

-- Sensitive HR data: dedicated permission, or the employee themself.
create policy employee_private_select on public.employee_private for select to authenticated
  using ((select app.has_perm('hr.employees_private', 'view'))
         or employee_id = (select app.my_employee_id()));
create policy employee_private_insert on public.employee_private for insert to authenticated
  with check ((select app.has_perm('hr.employees_private', 'create')));
create policy employee_private_update on public.employee_private for update to authenticated
  using ((select app.has_perm('hr.employees_private', 'edit'))) with check (true);

-- ---------------------------------------------------------------------
-- Profiles: self, or user administrators. Writes are further restricted
-- by the guard_profiles trigger. Inserts come only from auth.users hook.
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.has_perm('admin.users', 'view')));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.has_perm('admin.users', 'edit')))
  with check (true);

-- ---------------------------------------------------------------------
-- Module catalogue: readable by active users (needed to build the menu).
-- ---------------------------------------------------------------------
create policy module_groups_select on public.module_groups for select to authenticated
  using ((select app.is_active_user()));
create policy modules_select on public.modules for select to authenticated
  using ((select app.is_active_user()));
create policy modules_update on public.modules for update to authenticated
  using ((select app.has_perm('admin.modules', 'edit'))) with check (true);

-- ---------------------------------------------------------------------
-- Roles & permissions. Writes to role_permissions / user_roles / user_sites
-- happen ONLY through audited security-definer RPCs (no write policies).
-- ---------------------------------------------------------------------
create policy roles_select on public.roles for select to authenticated
  using ((select app.has_any_perm(array['admin.roles','admin.users'], 'view'))
         or id in (select ur.role_id from public.user_roles ur where ur.user_id = (select auth.uid())));
create policy roles_insert on public.roles for insert to authenticated
  with check ((select app.has_perm('admin.roles', 'create')));
create policy roles_update on public.roles for update to authenticated
  using ((select app.has_perm('admin.roles', 'edit'))) with check (true);
create policy roles_delete on public.roles for delete to authenticated
  using ((select app.has_perm('admin.roles', 'delete')));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select app.has_perm('admin.roles', 'view'))
         or role_id in (select ur.role_id from public.user_roles ur where ur.user_id = (select auth.uid())));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid())
         or (select app.has_any_perm(array['admin.users','admin.roles'], 'view')));

-- ---------------------------------------------------------------------
-- Sites: site admins see all; everyone else sees only assigned sites.
-- ---------------------------------------------------------------------
create policy sites_select on public.sites for select to authenticated
  using ((select app.has_perm('admin.sites', 'view'))
         or id = any ((select app.my_site_ids())::uuid[]));
create policy sites_insert on public.sites for insert to authenticated
  with check ((select app.has_perm('admin.sites', 'create')));
create policy sites_update on public.sites for update to authenticated
  using ((select app.has_perm('admin.sites', 'edit'))) with check (true);
create policy sites_delete on public.sites for delete to authenticated
  using ((select app.has_perm('admin.sites', 'delete')));

create policy user_sites_select on public.user_sites for select to authenticated
  using (user_id = (select auth.uid())
         or (select app.has_any_perm(array['admin.users','admin.sites'], 'view')));

-- ---------------------------------------------------------------------
-- Settings & audit
-- ---------------------------------------------------------------------
create policy app_settings_select on public.app_settings for select to authenticated
  using ((select app.is_active_user()));
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select app.has_perm('admin.settings', 'edit')));
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select app.has_perm('admin.settings', 'edit'))) with check (true);

-- Append-only: readable with admin.audit VIEW; no insert/update/delete
-- policies, so only security-definer code can write.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using ((select app.has_perm('admin.audit', 'view')));

-- Table privileges for the authenticated role (RLS still applies).
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_logs, public.role_permissions,
                                 public.user_roles, public.user_sites, public.module_groups
  from authenticated;
revoke insert, delete on public.modules, public.profiles from authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- =====================================================================
-- STANDARD POLICY GENERATOR (used by every future business module)
--
--   select app.apply_standard_policies(
--     'maintenance_tickets',            -- table in public
--     'om.tickets',                     -- module key
--     'site_id',                        -- site column (or null)
--     array['created_by','assigned_to','reported_by'],   -- owner columns
--     array['assigned_to']);            -- columns that need ASSIGN to change
--
-- Produces:
--   SELECT  : VIEW  + site access + data scope, hides soft-deleted rows
--   INSERT  : CREATE + site access
--   UPDATE  : EDIT  + site access + data scope (new row must stay in my sites)
--   DELETE  : none (hard delete blocked) — soft delete needs DELETE
--   ASSIGN  : changing an assign column needs ASSIGN (self-assign allowed)
--   AUDIT   : create / update / delete recorded in audit_logs
-- =====================================================================
create table app.managed_tables (
  table_name   text primary key,
  module_key   text not null,
  site_column  text,
  owner_columns text[] not null,
  assign_columns text[] not null default '{}'
);

create or replace function app.guard_managed_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  cfg app.managed_tables;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  c text;
begin
  if auth.uid() is null then
    return new;                          -- trusted server-side context
  end if;
  select * into cfg from app.managed_tables where table_name = tg_table_name;

  -- Soft delete / restore requires DELETE.
  if tg_op = 'UPDATE' and n ? 'deleted_at'
     and (n->>'deleted_at') is distinct from (o->>'deleted_at')
     and not app.has_perm(cfg.module_key, 'delete') then
    raise exception 'You do not have permission to delete this record.' using errcode = '42501';
  end if;

  -- Assignment requires ASSIGN (assigning a new record to yourself is allowed).
  foreach c in array cfg.assign_columns loop
    if (n->>c) is distinct from (o->>c)
       and not (tg_op = 'INSERT' and (n->>c) = auth.uid()::text)
       and (n->>c) is not null
       and not app.has_perm(cfg.module_key, 'assign') then
      raise exception 'You do not have permission to assign this record.' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function app.apply_standard_policies(
  p_table          text,
  p_module         text,
  p_site_col       text default null,
  p_owner_cols     text[] default array['created_by'],
  p_assign_cols    text[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  owners text := 'array[' || array_to_string(array(select format('%I', c) from unnest(p_owner_cols) c), ',') || ']::uuid[]';
  site_pred text := case when p_site_col is null then 'true'
                    else format('%I = any ((select app.my_site_ids())::uuid[])', p_site_col) end;
  has_deleted boolean;
  scope_pred text;
begin
  select exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = p_table and column_name = 'deleted_at')
    into has_deleted;

  insert into app.managed_tables values (p_table, p_module, p_site_col, p_owner_cols, p_assign_cols)
  on conflict (table_name) do update
    set module_key = excluded.module_key, site_column = excluded.site_column,
        owner_columns = excluded.owner_columns, assign_columns = excluded.assign_columns;

  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists std_select on public.%I', p_table);
  execute format('drop policy if exists std_insert on public.%I', p_table);
  execute format('drop policy if exists std_update on public.%I', p_table);

  scope_pred := 'app.in_scope((select app.perm_scope(%1$L, %2$L)), ' || owners
                || ', (select auth.uid()), (select app.my_team_ids()))';

  execute format(
    'create policy std_select on public.%I for select to authenticated using (%s (select app.has_perm(%L, ''view'')) and %s and %s)',
    p_table, case when has_deleted then 'deleted_at is null and' else '' end,
    p_module, site_pred, format(scope_pred, p_module, 'view'));

  execute format(
    'create policy std_insert on public.%I for insert to authenticated with check ((select app.has_perm(%L, ''create'')) and %s)',
    p_table, p_module, site_pred);

  execute format(
    'create policy std_update on public.%I for update to authenticated using (%s (select app.has_perm(%L, ''edit'')) and %s and %s) with check (%s)',
    p_table, case when has_deleted then 'deleted_at is null and' else '' end,
    p_module, site_pred, format(scope_pred, p_module, 'edit'), site_pred);

  execute format('drop trigger if exists guard_managed_row on public.%I', p_table);
  execute format('create trigger guard_managed_row before insert or update on public.%I
                  for each row execute function app.guard_managed_row()', p_table);

  execute format('drop trigger if exists audit_row on public.%I', p_table);
  execute format('create trigger audit_row after insert or update or delete on public.%I
                  for each row execute function app.audit_row_change(%L)', p_table, p_module);

  execute format('drop trigger if exists touch_row on public.%I', p_table);
  execute format('create trigger touch_row before update on public.%I
                  for each row execute function app.touch_row()', p_table);

  execute format('grant select, insert, update on public.%I to authenticated', p_table);
  execute format('revoke delete on public.%I from authenticated', p_table);
end;
$$;

-- Generic soft delete for any managed table.
--
-- Step 1 (public.soft_delete_record, SECURITY INVOKER): the row must be
--   visible to the caller through the table's own SELECT policy.
-- Step 2 (app.mark_deleted, SECURITY DEFINER): the caller must hold DELETE
--   with a scope covering this row and must have access to its site.
-- (A plain UPDATE cannot be used because the new, deleted row would no
--  longer satisfy the SELECT policy that hides deleted rows.)
create or replace function app.mark_deleted(p_table text, p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cfg app.managed_tables;
  v_row jsonb;
  v_owners uuid[];
begin
  select * into cfg from app.managed_tables where table_name = p_table;
  if not found then
    raise exception 'Unknown table.' using errcode = '22023';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and deleted_at is null', p_table)
    into v_row using p_id;
  if v_row is null then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg((v_row->>c)::uuid) filter (where v_row->>c is not null), '{}')
    into v_owners from unnest(cfg.owner_columns) c;

  if not app.has_perm(cfg.module_key, 'delete')
     or not app.in_scope(app.perm_scope(cfg.module_key, 'delete'), v_owners, auth.uid(), app.my_team_ids())
     or (cfg.site_column is not null and not app.can_access_site((v_row->>cfg.site_column)::uuid)) then
    raise exception 'You do not have permission to delete this record.' using errcode = '42501';
  end if;

  execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
end;
$$;

create or replace function public.soft_delete_record(p_table text, p_id uuid)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_visible boolean;
begin
  if not exists (select 1 from app.managed_tables where table_name = p_table) then
    raise exception 'Unknown table.' using errcode = '22023';
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', p_table) into v_visible using p_id;
  if not v_visible then
    raise exception 'Record not found or not permitted.' using errcode = '42501';
  end if;
  perform app.mark_deleted(p_table, p_id);
end;
$$;

grant execute on function app.mark_deleted(text, uuid) to authenticated;
grant select on app.managed_tables to authenticated;
grant execute on function public.soft_delete_record(text, uuid) to authenticated;
