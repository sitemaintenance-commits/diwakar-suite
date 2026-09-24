-- =====================================================================
-- Audit logging, auth.users hooks and integrity guards.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Central audit writer (the ONLY way rows reach audit_logs).
-- ---------------------------------------------------------------------
create or replace function app.write_audit(
  p_action      text,
  p_module      text default null,
  p_table       text default null,
  p_entity_id   text default null,
  p_summary     text default null,
  p_changes     jsonb default null,
  p_actor       uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_email text;
  v_name  text;
  v_ua    text;
begin
  select p.email::text, p.full_name into v_email, v_name
  from public.profiles p where p.id = v_actor;

  begin
    v_ua := left(current_setting('request.headers', true)::json->>'user-agent', 300);
  exception when others then
    v_ua := null;
  end;

  insert into public.audit_logs(actor_id, actor_email, actor_name, action, module_key,
                                entity_table, entity_id, summary, changes, user_agent)
  values (v_actor, v_email, v_name, p_action, p_module, p_table, p_entity_id,
          p_summary, p_changes, v_ua);
end;
$$;

-- ---------------------------------------------------------------------
-- Generic row-change audit trigger.
--   TG_ARGV[0] = module key
--   TG_ARGV[1] = 'redact' to record changed column names only (HR data)
-- ---------------------------------------------------------------------
create or replace function app.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_module text := tg_argv[0];
  v_redact boolean := coalesce(tg_argv[1], '') = 'redact';
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_id  text  := coalesce(v_row->>'id', v_row->>'employee_id', v_row->>'key');
  v_label text := coalesce(v_row->>'name', v_row->>'full_name', v_row->>'label', v_row->>'key', v_id);
  v_diff jsonb := '{}'::jsonb;
  v_action text;
  k text;
  noisy text[] := array['updated_at','updated_by','created_at','created_by','last_login_at'];
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any(noisy)) and (v_new->k) is distinct from (v_old->k) then
        v_diff := v_diff || jsonb_build_object(k,
          case when v_redact then jsonb_build_object('changed', true)
               else jsonb_build_object('from', v_old->k, 'to', v_new->k) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return new;                       -- nothing meaningful changed
    end if;
    v_action := case
      when v_diff ? 'deleted_at' and (v_new->>'deleted_at') is not null then 'delete'
      else 'update' end;
  elsif tg_op = 'INSERT' then
    v_action := 'create';
    v_diff := case when v_redact then null else v_new - noisy end;
  else
    v_action := 'delete';
    v_diff := case when v_redact then null else v_old - noisy end;
  end if;

  perform app.write_audit(v_action, v_module, tg_table_name, v_id,
                          initcap(replace(tg_table_name, '_', ' ')) || ' ' || v_action || 'd: ' || coalesce(v_label, ''),
                          v_diff);
  return coalesce(new, old);
end;
$$;

do $$
declare r record;
begin
  for r in select * from (values
      ('departments',      'hr.org',      ''),
      ('designations',     'hr.org',      ''),
      ('employees',        'hr.employees',''),
      ('employee_private', 'hr.employees_private','redact'),
      ('profiles',         'admin.users', ''),
      ('roles',            'admin.roles', ''),
      ('sites',            'admin.sites', ''),
      ('modules',          'admin.modules',''),
      ('app_settings',     'admin.settings','')) as v(tbl, module, flag)
  loop
    execute format('create trigger audit_row after insert or update or delete on public.%I
                    for each row execute function app.audit_row_change(%L, %L)',
                   r.tbl, r.module, r.flag);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- auth.users hooks
-- ---------------------------------------------------------------------
-- New auth user -> profile (status 'invited' until first successful login,
-- or 'active' when an admin creates the user with a password).
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'phone', ''),
    case when new.raw_user_meta_data->>'initial_status' = 'active'
         then 'active'::public.user_status else 'invited'::public.user_status end)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- Successful sign-in -> last_login_at, activate invited users, audit 'login'.
-- Runs server-side inside Supabase Auth, so it cannot be skipped by a client.
create or replace function app.handle_auth_sign_in()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
    update public.profiles
       set last_login_at = new.last_sign_in_at,
           status = case when status = 'invited' then 'active'::public.user_status else status end
     where id = new.id;
    perform app.write_audit('login', 'auth', 'profiles', new.id::text, 'Signed in', null, new.id);
  end if;
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_signed_in
  after update on auth.users
  for each row execute function app.handle_auth_sign_in();

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------

-- System (Super Admin) role cannot be deleted, deactivated or re-keyed.
-- Custom roles in use cannot be deleted until users are unassigned.
create or replace function app.guard_roles()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_count int;
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'The Super Admin role cannot be deleted.' using errcode = '42501';
    end if;
    select count(*) into v_count from public.user_roles where role_id = old.id;
    if v_count > 0 then
      raise exception 'Role "%" is assigned to % user(s). Remove it from those users first.', old.name, v_count
        using errcode = '23503';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.is_system and auth.uid() is not null then
    raise exception 'System roles cannot be created.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.is_system and (new.key <> old.key or not new.is_active or not new.is_system) then
      raise exception 'The Super Admin role cannot be renamed, deactivated or demoted.' using errcode = '42501';
    end if;
    if not old.is_system and new.is_system then
      raise exception 'A role cannot be promoted to system role.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_roles
  before insert or update or delete on public.roles
  for each row execute function app.guard_roles();

-- Administration and dashboard modules can never be disabled (lock-out guard);
-- structural fields of modules are immutable from the API.
create or replace function app.guard_modules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if not new.is_enabled and (new.key like 'admin.%' or new.key = 'dashboard') then
      raise exception 'Module "%" cannot be disabled.', new.key using errcode = '42501';
    end if;
    if auth.uid() is not null and (new.key <> old.key or new.supported_actions <> old.supported_actions
       or new.group_id <> old.group_id or new.phase <> old.phase) then
      raise exception 'Module structure is managed by migrations.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_modules
  before update on public.modules
  for each row execute function app.guard_modules();

-- Profile integrity:
--   * users editing their own profile may only change personal fields;
--   * only a Super Admin may modify another Super Admin;
--   * site-wide access (all_sites) requires admin.users ASSIGN;
--   * nobody can deactivate themselves;
--   * the last active Super Admin can never be deactivated.
create or replace function app.guard_profiles()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null then
    if new.id = v_uid then
      if new.status is distinct from old.status then
        raise exception 'You cannot change your own account status.' using errcode = '42501';
      end if;
      if (new.email is distinct from old.email
          or new.all_sites is distinct from old.all_sites
          or new.employee_id is distinct from old.employee_id
          or new.last_login_at is distinct from old.last_login_at)
         and not app.is_super_admin() then
        raise exception 'You can only change your name, phone and photo.' using errcode = '42501';
      end if;
    else
      if not (app.has_perm('admin.users', 'edit') or app.has_perm('admin.users', 'create')) then
        raise exception 'Not allowed to modify other users.' using errcode = '42501';
      end if;
      if app.is_super_admin(old.id) and not app.is_super_admin() then
        raise exception 'Only a Super Admin can modify another Super Admin.' using errcode = '42501';
      end if;
      if new.all_sites is distinct from old.all_sites and not app.has_perm('admin.users', 'assign') then
        raise exception 'Assigning all-site access requires the ASSIGN permission.' using errcode = '42501';
      end if;
      if new.email is distinct from old.email then
        raise exception 'Email changes are handled by the account service.' using errcode = '42501';
      end if;
    end if;
  end if;

  if old.status = 'active' and new.status <> 'active' and app.is_super_admin(old.id)
     and not exists (
       select 1 from public.user_roles ur
       join public.roles r on r.id = ur.role_id and r.is_system
       join public.profiles p on p.id = ur.user_id and p.status = 'active'
       where ur.user_id <> old.id) then
    raise exception 'The last active Super Admin cannot be deactivated.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_profiles
  before update on public.profiles
  for each row execute function app.guard_profiles();
