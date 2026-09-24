-- =====================================================================
-- Core identity, organization, RBAC, sites, settings and audit tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text unique,
  color       text not null default '#E8740C' check (color ~* '^#[0-9a-f]{6}$'),
  head_employee_id uuid,
  status      public.record_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid
);

create table public.designations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  department_id uuid references public.departments(id) on delete set null,
  status        public.record_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid
);

create sequence public.employee_code_seq start 1001;

create table public.employees (
  id                   uuid primary key default gen_random_uuid(),
  employee_code        text not null unique
                       default ('DS-' || nextval('public.employee_code_seq')::text),
  full_name            text not null,
  email                citext,
  phone                text,
  department_id        uuid references public.departments(id) on delete set null,
  designation_id       uuid references public.designations(id) on delete set null,
  reporting_manager_id uuid references public.employees(id) on delete set null,
  joining_date         date,
  status               public.record_status not null default 'active',
  photo_path           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_by           uuid,
  deleted_at           timestamptz
);
create index employees_department_idx on public.employees(department_id);
create index employees_designation_idx on public.employees(designation_id);
create index employees_manager_idx on public.employees(reporting_manager_id);

alter table public.departments
  add constraint departments_head_fk foreign key (head_employee_id)
  references public.employees(id) on delete set null;

-- Sensitive HR data lives in its own table with its own permission (D4).
create table public.employee_private (
  employee_id       uuid primary key references public.employees(id) on delete cascade,
  date_of_birth     date,
  address           text,
  emergency_contact jsonb not null default '{}'::jsonb,
  pan               text,
  aadhaar_last4     text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  bank_account      jsonb not null default '{}'::jsonb,
  salary            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

-- ---------------------------------------------------------------------
-- Login identity (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext not null unique,
  full_name     text not null default '',
  phone         text,
  employee_id   uuid unique references public.employees(id) on delete set null,
  avatar_path   text,
  status        public.user_status not null default 'invited',
  all_sites     boolean not null default false,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create index profiles_status_idx on public.profiles(status);
create index profiles_name_trgm on public.profiles using gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Module catalogue
-- ---------------------------------------------------------------------
create table public.module_groups (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  icon       text,
  sort_order int not null default 0
);

create table public.modules (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.module_groups(id) on delete restrict,
  key               text not null unique check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  label             text not null,
  description       text,
  route             text,
  icon              text,
  sort_order        int not null default 0,
  supported_actions public.perm_action[] not null default '{view}',
  supports_scope    boolean not null default false,
  is_site_scoped    boolean not null default false,
  show_in_nav       boolean not null default true,
  is_enabled        boolean not null default true,
  phase             int not null default 1,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
create index modules_group_idx on public.modules(group_id);

-- ---------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name        text not null unique,
  description text,
  is_system   boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid
);

create table public.role_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  module_id  uuid not null references public.modules(id) on delete cascade,
  action     public.perm_action not null,
  scope      public.perm_scope not null default 'all',
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (role_id, module_id, action)
);
create index role_permissions_module_idx on public.role_permissions(module_id, action);

create table public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_roles_role_idx on public.user_roles(role_id);

-- ---------------------------------------------------------------------
-- Sites & site access
-- ---------------------------------------------------------------------
create table public.sites (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,
  name         text not null unique,
  location     text,
  district     text,
  state        text,
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  capacity_kwp numeric(12,3) not null default 0 check (capacity_kwp >= 0),
  status       public.record_status not null default 'active',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid
);
create index sites_status_idx on public.sites(status);

create table public.user_sites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  site_id     uuid not null references public.sites(id) on delete cascade,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  primary key (user_id, site_id)
);
create index user_sites_site_idx on public.user_sites(site_id);

-- ---------------------------------------------------------------------
-- System settings (key/value)
-- ---------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------
-- Audit log (append-only; written only by security-definer code)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_email  text,
  actor_name   text,
  action       text not null,
  module_key   text,
  entity_table text,
  entity_id    text,
  summary      text,
  changes      jsonb,
  user_agent   text
);
create index audit_logs_time_idx   on public.audit_logs(occurred_at desc);
create index audit_logs_actor_idx  on public.audit_logs(actor_id, occurred_at desc);
create index audit_logs_module_idx on public.audit_logs(module_key, occurred_at desc);
create index audit_logs_action_idx on public.audit_logs(action, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_table, entity_id);

-- ---------------------------------------------------------------------
-- Touch triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['departments','designations','employees','employee_private',
                           'profiles','roles','sites','modules','app_settings']
  loop
    execute format('create trigger touch_row before update on public.%I
                    for each row execute function app.touch_row()', t);
  end loop;
end $$;
