-- =====================================================================
-- APPROVALS: MULTI-LEVEL WORKFLOW
--
-- A request now goes through a configurable chain of approval levels
-- (e.g. Purchase: Department Head -> Finance -> Director) instead of one
-- approver. Level 2 cannot act until Level 1 has approved; when a level
-- approves, the next one becomes Pending and its approver is notified.
--
--   approval_workflows / approval_workflow_levels
--       Templates per request type (category; NULL = the default for any
--       type). A level's approver is a fixed employee, the head of the
--       requester's department, or anyone holding a role (Finance,
--       Director...).
--   approval_steps
--       The levels of one request, copied from the template when it is
--       submitted. Changing a template later never changes a request in
--       flight. Each submission is a "round": returning a request for
--       changes and resubmitting it starts a new round from Level 1; the
--       earlier rounds are kept.
--   approval_actions
--       The timeline: every create, submit, approve, reject, return,
--       reassignment, edit, document and comment, with who, their role,
--       the exact time, the comment and the client (IP / device). It can
--       only be added to, never changed or deleted.
--   approval_documents / approval_document_versions
--       Attachments with versions. A new version never overwrites the old
--       one; deleting a document hides it (the file and its history stay).
--   approval_comments
--       Discussion on a request.
--   notifications
--       In-app notifications (submitted, waiting for you, approved,
--       rejected, returned, final approval...).
--
-- Every change goes through the security-definer functions below, which
-- check who may do what; the tables themselves are closed to the app.
-- Rows are audited into audit_logs with old and new values.
-- =====================================================================

-- ------------------------------------------------------------ module
update public.modules
   set supported_actions = '{view,create,edit,approve,export}',
       description = 'Multi-level approval of purchase, payment, travel, leave and other requests'
 where key = 'approvals';

-- Admin (and Management, which already approved everything) administer approvals.
insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, a.action::public.perm_action, 'all'
from public.roles r
cross join public.modules m
cross join (values ('view'), ('edit'), ('export')) as a(action)
where m.key = 'approvals' and r.key in ('admin', 'management')
on conflict (role_id, module_id, action) do update set scope = 'all';

-- Finance and Director: roles a workflow level can be given to.
insert into public.roles (key, name, description, is_system) values
  ('finance',  'Finance',  'Approves requests at the Finance level of an approval workflow.', false),
  ('director', 'Director', 'Approves requests at the Director level of an approval workflow.', false)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, a.action::public.perm_action, 'own'
from public.roles r
cross join public.modules m
cross join (values ('view'), ('create')) as a(action)
where m.key = 'approvals' and r.key in ('finance', 'director')
on conflict (role_id, module_id, action) do nothing;

-- -------------------------------------------------------- the request
alter table public.approval_requests drop constraint if exists approval_requests_status_check;
alter table public.approval_requests drop constraint if exists approval_requests_category_check;
alter table public.approval_requests drop constraint if exists approval_requests_priority_check;
update public.approval_requests set status = 'returned' where status = 'needs_info';

alter table public.approval_requests
  add column if not exists project_id    uuid references public.projects(id) on delete set null,
  add column if not exists workflow_id   uuid,
  add column if not exists workflow_name text,
  add column if not exists round         int not null default 0,
  add column if not exists current_level int,
  add column if not exists total_levels  int not null default 0,
  add column if not exists submitted_at  timestamptz,
  add column if not exists completed_at  timestamptz,
  add column if not exists cancelled_at  timestamptz;

alter table public.approval_requests
  alter column status set default 'draft',
  add constraint approval_requests_status_check check (status in
    ('draft','submitted','pending','in_review','approved','rejected','returned','cancelled','completed')),
  add constraint approval_requests_category_check check (category in
    ('purchase','payment','reimbursement','travel','leave','procurement','project','maintenance','other',
     'advance','equipment')),   -- the last two: requests raised before the upgrade
  add constraint approval_requests_priority_check check (priority in ('low','normal','high','urgent'));

create index if not exists approval_requests_updated_idx on public.approval_requests(updated_at desc);

-- ------------------------------------------------------------ templates
create table public.approval_workflows (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 120),
  category    text,                    -- null = default for every type without its own
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid
);
create unique index approval_workflows_one_active on public.approval_workflows (coalesce(category, '*')) where is_active;

alter table public.approval_requests
  add constraint approval_requests_workflow_fk foreign key (workflow_id) references public.approval_workflows(id) on delete set null;

create table public.approval_workflow_levels (
  id                   uuid primary key default gen_random_uuid(),
  workflow_id          uuid not null references public.approval_workflows(id) on delete cascade,
  level_no             int not null check (level_no between 1 and 20),
  name                 text not null check (length(btrim(name)) between 2 and 80),
  approver_type        text not null check (approver_type in ('employee','department_head','role')),
  approver_employee_id uuid references public.employees(id) on delete set null,
  approver_role_id     uuid references public.roles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workflow_id, level_no)
);

-- ------------------------------------------------------- per request
create table public.approval_steps (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null references public.approval_requests(id) on delete cascade,
  round                int not null,
  level_no             int not null,
  name                 text not null,
  approver_type        text not null check (approver_type in ('employee','department_head','role')),
  approver_employee_id uuid references public.employees(id) on delete set null,
  approver_role_id     uuid references public.roles(id) on delete set null,
  status               text not null default 'locked'
                       check (status in ('locked','pending','approved','rejected','returned','skipped','cancelled')),
  activated_at         timestamptz,
  acted_by             uuid references public.profiles(id) on delete set null,
  acted_by_name        text,
  acted_role           text,
  acted_at             timestamptz,
  comment              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (request_id, round, level_no)
);
create index approval_steps_open_idx on public.approval_steps(status, approver_employee_id) where status = 'pending';

create table public.approval_actions (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.approval_requests(id) on delete restrict,
  step_id     uuid references public.approval_steps(id) on delete restrict,
  round       int,
  level_no    int,
  action      text not null,
  from_status text,
  to_status   text,
  comment     text,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text,
  actor_role  text,
  document_id uuid,
  version_no  int,
  meta        jsonb,
  client      jsonb,
  created_at  timestamptz not null default clock_timestamp()
);
create index approval_actions_request_idx on public.approval_actions(request_id, id);

create table public.approval_documents (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.approval_requests(id) on delete restrict,
  file_name        text not null,
  category         text,
  current_version  int not null default 1,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles(id) on delete set null,
  delete_reason    text
);
create index approval_documents_request_idx on public.approval_documents(request_id);

create table public.approval_document_versions (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.approval_documents(id) on delete restrict,
  version_no       int not null,
  file_name        text not null,
  storage_path     text not null unique,
  mime_type        text,
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  note             text,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  uploaded_at      timestamptz not null default now(),
  unique (document_id, version_no)
);

create table public.approval_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.approval_requests(id) on delete restrict,
  body        text not null check (length(btrim(body)) between 1 and 4000),
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  created_at  timestamptz not null default now()
);
create index approval_comments_request_idx on public.approval_comments(request_id, created_at);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   uuid,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

-- Closed to the app: everything goes through the functions below.
alter table public.approval_workflows enable row level security;
alter table public.approval_workflow_levels enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_actions enable row level security;
alter table public.approval_documents enable row level security;
alter table public.approval_document_versions enable row level security;
alter table public.approval_comments enable row level security;
alter table public.notifications enable row level security;
revoke all on public.approval_workflows, public.approval_workflow_levels, public.approval_steps,
              public.approval_actions, public.approval_documents, public.approval_document_versions,
              public.approval_comments, public.notifications from anon, authenticated;

create trigger touch_row before update on public.approval_workflows for each row execute function app.touch_row();
create trigger touch_row before update on public.approval_workflow_levels for each row execute function app.touch_row();
create trigger touch_row before update on public.approval_steps for each row execute function app.touch_row();
create trigger touch_row before update on public.approval_documents for each row execute function app.touch_row();

create trigger audit_row after insert or update or delete on public.approval_workflows
  for each row execute function app.audit_row_change('approvals');
create trigger audit_row after insert or update or delete on public.approval_workflow_levels
  for each row execute function app.audit_row_change('approvals');
create trigger audit_row after insert or update or delete on public.approval_steps
  for each row execute function app.audit_row_change('approvals');
create trigger audit_row after insert or update or delete on public.approval_documents
  for each row execute function app.audit_row_change('approvals');
create trigger audit_row after insert on public.approval_document_versions
  for each row execute function app.audit_row_change('approvals');
create trigger audit_row after insert on public.approval_comments
  for each row execute function app.audit_row_change('approvals');

-- History is append-only.
create or replace function app.forbid_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Approval history cannot be changed or deleted.' using errcode = '42501';
end;
$$;
create trigger append_only before update or delete on public.approval_actions
  for each row execute function app.forbid_history_change();
create trigger append_only before update or delete on public.approval_document_versions
  for each row execute function app.forbid_history_change();
create trigger append_only before update or delete on public.approval_comments
  for each row execute function app.forbid_history_change();

-- A level that has been decided stays decided.
create or replace function app.guard_approval_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Approval levels cannot be deleted.' using errcode = '42501';
  end if;
  if old.status in ('approved','rejected','returned','skipped','cancelled')
     and (new.status, new.acted_by, new.acted_at, new.comment, new.approver_employee_id, new.approver_role_id)
         is distinct from (old.status, old.acted_by, old.acted_at, old.comment, old.approver_employee_id, old.approver_role_id) then
    raise exception 'Level % is already %; it cannot be changed.', old.level_no, old.status using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_step before update or delete on public.approval_steps
  for each row execute function app.guard_approval_step();

-- --------------------------------------------------------------- helpers
/** The caller's IP address and device, from the request headers. */
create or replace function app.request_client()
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  h json;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'ip', btrim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1)),
    'user_agent', left(h->>'user-agent', 300)));
end;
$$;

create or replace function app.user_name(p_user uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(nullif(p.full_name, ''), p.email::text) from public.profiles p where p.id = p_user;
$$;

/** Whether a user (not just the caller) holds an action on a module. */
create or replace function app.user_has_perm(p_user uuid, p_module text, p_action public.perm_action)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_super_admin(p_user) or exists (
    select 1
    from public.user_roles ur
    join public.profiles p         on p.id = ur.user_id and p.status = 'active'
    join public.roles r            on r.id = ur.role_id and r.is_active
    join public.role_permissions rp on rp.role_id = ur.role_id and rp.action = p_action
    join public.modules m          on m.id = rp.module_id and m.key = p_module and m.is_enabled
    where ur.user_id = p_user);
$$;

/** Approval admins: Super Admin, or EDIT / APPROVE on Approvals. */
create or replace function app.is_approval_admin(p_user uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = coalesce(p_user, auth.uid()) and p.status = 'active')
     and (app.user_has_perm(coalesce(p_user, auth.uid()), 'approvals', 'edit')
          or app.user_has_perm(coalesce(p_user, auth.uid()), 'approvals', 'approve'));
$$;

-- Kept for the documents policies: Super Admins and approval admins.
create or replace function app.can_approve_requests()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_approval_admin();
$$;

/** Whether a user is the approver of a level: the employee, or a holder of the role. */
create or replace function app.user_is_step_approver(p_user uuid, p_step uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.approval_steps s
    join public.profiles p on p.id = p_user and p.status = 'active'
    where s.id = p_step
      and ((s.approver_employee_id is not null and s.approver_type <> 'role' and p.employee_id = s.approver_employee_id)
           or (s.approver_type = 'role' and s.approver_role_id is not null
               and exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.is_active
                           where ur.user_id = p_user and ur.role_id = s.approver_role_id))));
$$;

/** The users who may act on a level (for notifications). */
create or replace function app.step_approver_users(p_step uuid)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.status = 'active' and app.user_is_step_approver(p.id, p_step)
    and p.id <> (select a.requested_by from public.approval_steps s join public.approval_requests a on a.id = s.request_id where s.id = p_step);
$$;

create or replace function app.approval_admin_users()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.status = 'active' and app.is_approval_admin(p.id);
$$;

/** Whether the caller may see a request: their own, an approver on it, or an admin. */
create or replace function app.can_see_approval(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user() and exists (
    select 1 from public.approval_requests a
    where a.id = p_request
      and (a.requested_by = auth.uid()
           or (a.status <> 'draft' and app.is_approval_admin())
           or exists (select 1 from public.approval_steps s
                      where s.request_id = a.id and app.user_is_step_approver(auth.uid(), s.id))));
$$;

create or replace function app.notify(p_user uuid, p_kind text, p_title text, p_body text, p_request uuid)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, entity_type, entity_id)
  select p_user, p_kind, p_title, p_body, '/approvals/' || p_request::text, 'approval', p_request
  where p_user is not null and p_user is distinct from auth.uid();
$$;

/** Tells whoever acts on a level that it is waiting for them; admins if nobody can. */
create or replace function app.notify_step(p_step uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s record;
  u uuid;
  n int := 0;
begin
  select st.*, a.request_no, a.title, a.priority into s
  from public.approval_steps st join public.approval_requests a on a.id = st.request_id where st.id = p_step;
  for u in select app.step_approver_users(p_step) loop
    perform app.notify(u, 'approval.waiting',
      s.request_no || ' is waiting for your approval' || case when s.priority = 'urgent' then ' (urgent)' else '' end,
      s.title || ' · Level ' || s.level_no || ': ' || s.name, s.request_id);
    n := n + 1;
  end loop;
  if n = 0 then
    for u in select app.approval_admin_users() loop
      perform app.notify(u, 'approval.unassigned', s.request_no || ' needs an approver',
        'Nobody can approve Level ' || s.level_no || ' (' || s.name || ') of “' || s.title || '”. Assign an approver.', s.request_id);
    end loop;
  end if;
end;
$$;

create or replace function app.approval_log(
  p_request uuid, p_action text, p_comment text default null, p_step uuid default null,
  p_from text default null, p_to text default null, p_role text default null, p_meta jsonb default null,
  p_document uuid default null, p_version int default null)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.approval_actions (request_id, step_id, round, level_no, action, from_status, to_status, comment,
                                       actor_id, actor_name, actor_role, document_id, version_no, meta, client)
  select p_request, p_step, coalesce(s.round, a.round), s.level_no, p_action, p_from, p_to, nullif(btrim(coalesce(p_comment, '')), ''),
         auth.uid(), app.user_name(auth.uid()), p_role, p_document, p_version, p_meta, app.request_client()
  from public.approval_requests a
  left join public.approval_steps s on s.id = p_step
  where a.id = p_request;
$$;

/** Whether nobody can act on a level yet (no approver set, or the role has no one in it). */
create or replace function app.step_unassigned(p_step uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from app.step_approver_users(p_step));
$$;

/**
 * Recomputes a request's status and current level from its levels in the
 * current round. Draft, cancelled and completed requests are left alone.
 */
create or replace function app.approval_refresh(p_request uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_status text;
  v_level int;
  v_step uuid;
  v_done int;
  v_total int;
begin
  select * into a from public.approval_requests where id = p_request;
  if a.status in ('draft', 'cancelled', 'completed') then
    return a.status;
  end if;
  select count(*) filter (where status in ('approved', 'skipped')), count(*)
    into v_done, v_total
  from public.approval_steps where request_id = p_request and round = a.round;
  select id, level_no into v_step, v_level
  from public.approval_steps where request_id = p_request and round = a.round and status = 'pending'
  order by level_no limit 1;

  if exists (select 1 from public.approval_steps where request_id = p_request and round = a.round and status = 'rejected') then
    v_status := 'rejected';
  elsif exists (select 1 from public.approval_steps where request_id = p_request and round = a.round and status = 'returned') then
    v_status := 'returned';
  elsif v_total > 0 and v_done = v_total then
    v_status := 'approved';
  elsif v_step is null then
    v_status := 'submitted';
  elsif exists (select 1 from public.approval_steps where request_id = p_request and round = a.round and status = 'approved') then
    v_status := 'in_review';            -- past Level 1
  elsif app.step_unassigned(v_step) then
    v_status := 'submitted';            -- nobody can approve Level 1 yet: an admin assigns someone
  else
    v_status := 'pending';
  end if;

  update public.approval_requests set
    status = v_status,
    current_level = case when v_status in ('approved') then v_total else coalesce(v_level, current_level) end,
    total_levels = v_total,
    decided_at = case when v_status in ('approved', 'rejected') then coalesce(decided_at, now()) else null end,
    decided_by = case when v_status in ('approved', 'rejected') then coalesce(decided_by, auth.uid()) else null end,
    updated_by = auth.uid()
  where id = p_request and (status, current_level, total_levels) is distinct from (v_status, case when v_status = 'approved' then v_total else coalesce(v_level, current_level) end, v_total);
  return v_status;
end;
$$;

/**
 * Starts a new round of approval: copies the levels from the request's
 * workflow (first submission) or from the previous round (resubmission,
 * reopening), so a template changed meanwhile does not change it. A level
 * whose approver is the requester themselves is skipped and recorded.
 * The first remaining level becomes Pending; the rest are Locked.
 */
create or replace function app.approval_start_round(p_request uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  w public.approval_workflows;
  v_round int;
  v_emp uuid;        -- the requester's employee record
  r record;
  v_first uuid;
  v_step uuid;
  v_approver uuid;
begin
  select * into a from public.approval_requests where id = p_request for update;
  v_round := a.round + 1;
  select employee_id into v_emp from public.profiles where id = a.requested_by;

  if a.round = 0 then
    select * into w from public.approval_workflows
    where is_active and (category = a.category or category is null)
    order by (category is null), created_at limit 1;
    if w.id is null or not exists (select 1 from public.approval_workflow_levels where workflow_id = w.id) then
      raise exception 'No approval workflow is set up for this type of request. Ask an admin to add one in Workflow settings.' using errcode = '22023';
    end if;
    for r in select * from public.approval_workflow_levels where workflow_id = w.id order by level_no loop
      v_approver := case r.approver_type
        when 'employee' then r.approver_employee_id
        when 'department_head' then (select d.head_employee_id from public.departments d where d.id = a.department_id)
        else null end;
      insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id, approver_role_id)
      values (p_request, v_round, r.level_no, r.name, r.approver_type, v_approver,
              case when r.approver_type = 'role' then r.approver_role_id end);
    end loop;
    update public.approval_requests set workflow_id = w.id, workflow_name = w.name where id = p_request;
  else
    insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id, approver_role_id)
    select request_id, v_round, level_no, name, approver_type, approver_employee_id, approver_role_id
    from public.approval_steps where request_id = p_request and round = a.round;
  end if;

  update public.approval_requests set status = 'submitted', round = v_round, submitted_at = now(), decided_at = null, decided_by = null,
                                      decision_note = null, cancelled_at = null
  where id = p_request;

  -- The requester never approves their own request: such a level is skipped.
  for r in select * from public.approval_steps where request_id = p_request and round = v_round order by level_no loop
    if v_emp is not null and r.approver_type <> 'role' and r.approver_employee_id = v_emp then
      update public.approval_steps set status = 'skipped', acted_at = now(),
             comment = 'Skipped: the requester is this level''s approver.'
      where id = r.id;
      perform app.approval_log(p_request, 'level_skipped', 'The requester is this level''s approver, so the level is skipped.', r.id, 'locked', 'skipped', 'System');
    elsif v_first is null then
      v_first := r.id;
    end if;
  end loop;

  if v_first is not null then
    update public.approval_steps set status = 'pending', activated_at = now() where id = v_first;
  end if;
  perform app.approval_refresh(p_request);
  if v_first is not null then
    perform app.notify_step(v_first);
  end if;
end;
$$;

-- -------------------------------------------------------- migrate data
update public.departments d
   set head_employee_id = e.id
from public.approval_approvers ap
join public.employees e on e.id = ap.employee_id and e.deleted_at is null
where d.head_employee_id is null
  and ap.title like 'Head · %'
  and lower(d.name) = lower(substr(ap.title, length('Head · ') + 1));

-- Requests raised before the upgrade: one level, the approver they were sent to.
insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id, status,
                                   activated_at, acted_by, acted_by_name, acted_role, acted_at, comment, created_at)
select a.id, 1, 1, 'Approver', 'employee', a.approver_id,
       case a.status when 'pending' then 'pending' when 'returned' then 'returned' when 'approved' then 'approved'
                     when 'rejected' then 'rejected' else 'cancelled' end,
       a.created_at,
       case when a.status in ('approved', 'rejected') then a.decided_by end,
       case when a.status in ('approved', 'rejected') then app.user_name(a.decided_by) end,
       case when a.status in ('approved', 'rejected') then 'Approver' end,
       case when a.status in ('approved', 'rejected') then a.decided_at end,
       case when a.status in ('approved', 'rejected', 'returned') then a.decision_note end,
       a.created_at
from public.approval_requests a;

update public.approval_requests
   set round = 1, total_levels = 1, current_level = 1, submitted_at = created_at,
       workflow_name = 'Single approver (raised before multi-level approvals)',
       cancelled_at = case when status = 'cancelled' then updated_at end;

insert into public.approval_actions (request_id, step_id, round, level_no, action, comment, actor_id, actor_name, actor_role, created_at)
select ev.request_id, s.id, 1, case when ev.action in ('approved', 'rejected', 'needs_info') then 1 end,
       case ev.action when 'needs_info' then 'returned' else ev.action end,
       ev.note, ev.actor_id, app.user_name(ev.actor_id),
       case when ev.action in ('approved', 'rejected', 'needs_info') then 'Approver' else 'Requester' end,
       ev.created_at
from public.approval_events ev
left join public.approval_steps s on s.request_id = ev.request_id and s.round = 1
order by ev.created_at;

-- Attachments move to versioned documents (same files in storage).
with moved as (
  insert into public.approval_documents (id, request_id, file_name, category, uploaded_by, uploaded_by_name, created_at, deleted_at)
  select d.id, d.entity_id, d.file_name, d.category, d.created_by, app.user_name(d.created_by), d.created_at, d.deleted_at
  from public.documents d
  where d.entity_type = 'approval' and exists (select 1 from public.approval_requests a where a.id = d.entity_id)
  returning id)
insert into public.approval_document_versions (document_id, version_no, file_name, storage_path, mime_type, size_bytes,
                                               uploaded_by, uploaded_by_name, uploaded_at)
select d.id, 1, d.file_name, d.storage_path, d.mime_type, d.size_bytes, d.created_by, app.user_name(d.created_by), d.created_at
from public.documents d join moved m on m.id = d.id;
update public.documents set deleted_at = coalesce(deleted_at, now()) where entity_type = 'approval';

drop function if exists public.list_approvals(text, text, text, int, uuid);
drop function if exists public.list_approvers();
drop function if exists public.save_approval_request(jsonb, uuid);
drop function if exists public.decide_approval(uuid, text, text);
drop function if exists public.cancel_approval(uuid);
drop function if exists app.can_decide_approval(uuid);
drop function if exists app.my_approver_employee();
drop table if exists public.approval_events;
drop table if exists public.approval_approvers;
alter table public.approval_requests drop column if exists approver_id;

-- --------------------------------------------------- starting workflows
do $$
declare
  v_finance uuid := (select id from public.roles where key = 'finance');
  v_director uuid := (select id from public.roles where key = 'director');
  v_hr_head uuid := (select d.head_employee_id from public.departments d where d.code = 'HR' or d.name = 'HR' order by (d.code = 'HR') desc limit 1);
  w uuid;
  t record;
begin
  -- Default for any type without its own: Department Head -> Director.
  insert into public.approval_workflows (name, category, description)
  values ('Standard approval', null, 'Used for any type of request that has no workflow of its own.') returning id into w;
  insert into public.approval_workflow_levels (workflow_id, level_no, name, approver_type, approver_role_id) values
    (w, 1, 'Department Head', 'department_head', null),
    (w, 2, 'Director', 'role', v_director);

  for t in select * from (values ('purchase', 'Purchase approval'), ('payment', 'Payment approval'),
                                 ('reimbursement', 'Reimbursement approval'), ('procurement', 'Procurement approval')) v(cat, name) loop
    insert into public.approval_workflows (name, category) values (t.name, t.cat) returning id into w;
    insert into public.approval_workflow_levels (workflow_id, level_no, name, approver_type, approver_role_id) values
      (w, 1, 'Department Head', 'department_head', null),
      (w, 2, 'Finance Head', 'role', v_finance),
      (w, 3, 'Director', 'role', v_director);
  end loop;

  insert into public.approval_workflows (name, category) values ('Leave approval', 'leave') returning id into w;
  insert into public.approval_workflow_levels (workflow_id, level_no, name, approver_type, approver_employee_id, approver_role_id) values
    (w, 1, 'Department Head', 'department_head', null, null),
    (w, 2, 'HR', case when v_hr_head is null then 'role' else 'employee' end, v_hr_head,
     case when v_hr_head is null then (select id from public.roles where key = 'hr_admin') end);
end $$;

-- ------------------------------------------------------- storage reads
-- An approval file can be opened by whoever may see its request (a
-- deleted one by admins only).
create or replace function app.can_read_approval_file(p_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.approval_document_versions v
                 join public.approval_documents d on d.id = v.document_id
                 where v.storage_path = p_path
                   and app.can_see_approval(d.request_id)
                   and (d.deleted_at is null or app.is_approval_admin()));
$$;

drop policy if exists approval_files_read on storage.objects;
create policy approval_files_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and app.can_read_approval_file(name));

-- ===================================================== public functions
create or replace function app.approval_assert_user()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.is_active_user() or not (app.has_perm('approvals', 'view') or app.has_perm('approvals', 'create') or app.is_approval_admin()) then
    raise exception 'Access denied: approvals permission required.' using errcode = '42501';
  end if;
end;
$$;

/** Whether the requester (or an admin) may still edit a request's details. */
create or replace function app.approval_can_edit(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.approval_requests a
    where a.id = p_request
      and ((a.requested_by = auth.uid()
            and (a.status in ('draft', 'returned')
                 or (a.status in ('submitted', 'pending')
                     and not exists (select 1 from public.approval_steps s
                                     where s.request_id = a.id and s.round = a.round and s.status = 'approved'))))
           or (app.is_approval_admin() and a.status in ('submitted', 'pending', 'in_review', 'returned'))));
$$;

/**
 * Creates or edits a request; p_submit sends it for approval (a draft, or
 * a request returned for changes). Returns its id.
 */
create or replace function public.approval_save(p_request jsonb, p_id uuid default null, p_submit boolean default false)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_emp uuid := app.my_employee_id();
  a public.approval_requests;
  v_id uuid;
  v_title text := btrim(coalesce(p_request->>'title', ''));
  v_cat text := coalesce(nullif(p_request->>'category', ''), 'other');
  v_pri text := coalesce(nullif(p_request->>'priority', ''), 'normal');
  v_amount numeric;
  v_needed date;
  v_dept uuid;
  v_site uuid := nullif(p_request->>'site_id', '')::uuid;
  v_project uuid := nullif(p_request->>'project_id', '')::uuid;
  v_details text := nullif(btrim(coalesce(p_request->>'details', '')), '');
  v_changes jsonb := '{}'::jsonb;
  v_was text;
begin
  if not app.is_active_user() or not app.has_perm('approvals', 'create') then
    raise exception 'Access denied: you cannot raise requests.' using errcode = '42501';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'Give the request a title (3 to 200 characters).' using errcode = '22023';
  end if;
  if v_cat not in ('purchase','payment','reimbursement','travel','leave','procurement','project','maintenance','other') then
    raise exception 'Unknown request type %.', v_cat using errcode = '22023';
  end if;
  if v_pri not in ('low','normal','high','urgent') then
    raise exception 'Unknown priority %.', v_pri using errcode = '22023';
  end if;
  begin
    v_amount := nullif(regexp_replace(coalesce(p_request->>'amount', ''), '[,\s₹]', '', 'g'), '')::numeric;
    v_needed := nullif(p_request->>'needed_by', '')::date;
  exception when others then
    raise exception 'Check the amount and the date.' using errcode = '22023';
  end;
  if v_amount is not null and v_amount < 0 then
    raise exception 'The amount cannot be negative.' using errcode = '22023';
  end if;
  v_dept := coalesce(nullif(p_request->>'department_id', '')::uuid, (select department_id from public.employees where id = v_emp));

  if p_id is null then
    insert into public.approval_requests
      (requested_by, employee_id, department_id, category, title, details, amount, needed_by, priority, site_id, project_id, status, created_by, updated_by)
    values (v_me, v_emp, v_dept, v_cat, v_title, v_details, v_amount, v_needed, v_pri, v_site, v_project, 'draft', v_me, v_me)
    returning id into v_id;
    perform app.approval_log(v_id, 'created', null, null, null, 'draft', 'Requester');
  else
    select * into a from public.approval_requests where id = p_id for update;
    if a.id is null or not app.can_see_approval(p_id) then
      raise exception 'Request not found.' using errcode = 'P0002';
    end if;
    if not app.approval_can_edit(p_id) then
      raise exception 'This request is % and can no longer be edited.', replace(a.status, '_', ' ') using errcode = '42501';
    end if;
    v_id := p_id;
    -- What changed, for the timeline.
    select coalesce(jsonb_object_agg(k, jsonb_build_object('from', o, 'to', n)), '{}'::jsonb) into v_changes
    from (values
      ('title', to_jsonb(a.title), to_jsonb(v_title)),
      ('type', to_jsonb(a.category), to_jsonb(v_cat)),
      ('priority', to_jsonb(a.priority), to_jsonb(v_pri)),
      ('details', to_jsonb(a.details), to_jsonb(v_details)),
      ('amount', to_jsonb(a.amount), to_jsonb(v_amount)),
      ('needed_by', to_jsonb(a.needed_by), to_jsonb(v_needed)),
      ('department', to_jsonb((select name from public.departments where id = a.department_id)), to_jsonb((select name from public.departments where id = v_dept))),
      ('site', to_jsonb((select name from public.sites where id = a.site_id)), to_jsonb((select name from public.sites where id = v_site))),
      ('project', to_jsonb((select name from public.projects where id = a.project_id)), to_jsonb((select name from public.projects where id = v_project)))
    ) as c(k, o, n)
    where o is distinct from n;
    -- The type picks the workflow: it can change only before the first submission.
    if a.round > 0 and v_cat <> a.category then
      raise exception 'The type cannot change once the request has been submitted.' using errcode = '22023';
    end if;
    update public.approval_requests set
      category = v_cat, title = v_title, details = v_details, amount = v_amount, needed_by = v_needed,
      priority = v_pri, department_id = v_dept, site_id = v_site, project_id = v_project, updated_by = v_me
    where id = p_id;
    if v_changes <> '{}'::jsonb then
      perform app.approval_log(p_id, 'edited', nullif(p_request->>'edit_note', ''), null, a.status, a.status,
                               case when a.requested_by = v_me then 'Requester' else 'Admin' end,
                               jsonb_build_object('changes', v_changes));
    end if;
  end if;

  if p_submit then
    select * into a from public.approval_requests where id = v_id for update;
    if a.requested_by <> v_me then
      raise exception 'Only the requester submits a request.' using errcode = '42501';
    end if;
    if a.status not in ('draft', 'returned') then
      raise exception 'This request has already been submitted.' using errcode = '42501';
    end if;
    v_was := a.status;
    perform app.approval_start_round(v_id);
    perform app.approval_log(v_id, case when v_was = 'returned' then 'resubmitted' else 'submitted' end,
                             nullif(p_request->>'note', ''), null, v_was,
                             (select status from public.approval_requests where id = v_id), 'Requester');
  end if;
  return v_id;
end;
$$;

/**
 * An approver approves, rejects (reason required) or returns for changes
 * (reason required) the level they are assigned to -- only while it is
 * the active level.
 */
create or replace function public.approval_act(p_step uuid, p_action text, p_comment text default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.approval_steps;
  a public.approval_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_status text;
  v_next public.approval_steps;
  v_new text;
  v_req uuid;
begin
  perform app.approval_assert_user();
  if p_action not in ('approve', 'reject', 'return') then
    raise exception 'Unknown action %.', p_action using errcode = '22023';
  end if;
  if p_action in ('reject', 'return') and v_comment is null then
    raise exception 'Give a reason: the requester needs to know why.' using errcode = '22023';
  end if;
  select request_id into v_req from public.approval_steps where id = p_step;
  if v_req is null then
    raise exception 'Approval level not found.' using errcode = 'P0002';
  end if;
  -- Lock the request first: two approvers clicking at once are serialised here.
  select * into a from public.approval_requests where id = v_req for update;
  select * into s from public.approval_steps where id = p_step for update;

  if not app.user_is_step_approver(auth.uid(), s.id) then
    raise exception 'You are not the approver for Level % of this request.', s.level_no using errcode = '42501';
  end if;
  if a.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request.' using errcode = '42501';
  end if;
  if s.round <> a.round or a.status not in ('submitted', 'pending', 'in_review') then
    raise exception 'This request is % — there is nothing to approve.', replace(a.status, '_', ' ') using errcode = '42501';
  end if;
  if s.status = 'locked' then
    raise exception 'Level % is locked until the levels before it have approved.', s.level_no using errcode = '42501';
  end if;
  if s.status <> 'pending' then
    raise exception 'Level % has already been %.', s.level_no, s.status using errcode = '42501';
  end if;

  v_new := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'returned' end;
  update public.approval_steps set status = v_new, acted_by = auth.uid(), acted_by_name = app.user_name(auth.uid()),
         acted_role = s.name, acted_at = now(), comment = v_comment
  where id = s.id;

  if p_action = 'approve' then
    select * into v_next from public.approval_steps
    where request_id = a.id and round = a.round and level_no > s.level_no and status = 'locked'
    order by level_no limit 1;
    if v_next.id is not null then
      update public.approval_steps set status = 'pending', activated_at = now() where id = v_next.id;
    end if;
  else
    update public.approval_requests set decision_note = v_comment where id = a.id;
  end if;

  v_status := app.approval_refresh(a.id);
  perform app.approval_log(a.id, v_new, v_comment, s.id, a.status, v_status, s.name);

  -- Notifications
  if p_action = 'approve' and v_next.id is not null then
    perform app.notify(a.requested_by, 'approval.level_approved',
      a.request_no || ': Level ' || s.level_no || ' approved',
      app.user_name(auth.uid()) || ' (' || s.name || ') approved “' || a.title || '”. Now with Level ' || v_next.level_no || ': ' || v_next.name || '.', a.id);
    perform app.notify_step(v_next.id);
  elsif v_status = 'approved' then
    perform app.notify(a.requested_by, 'approval.approved', a.request_no || ' is approved',
      '“' || a.title || '” has been approved at every level.', a.id);
  elsif v_status = 'rejected' then
    perform app.notify(a.requested_by, 'approval.rejected', a.request_no || ' was rejected',
      app.user_name(auth.uid()) || ' (' || s.name || '): ' || v_comment, a.id);
  elsif v_status = 'returned' then
    perform app.notify(a.requested_by, 'approval.returned', a.request_no || ' was returned for changes',
      app.user_name(auth.uid()) || ' (' || s.name || '): ' || v_comment, a.id);
  end if;
  return v_status;
end;
$$;

/** The requester (or an admin) cancels a request that is not finished. */
create or replace function public.approval_cancel(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_admin boolean := app.is_approval_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  u uuid;
  s record;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_id for update;
  if a.id is null or not app.can_see_approval(p_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if a.requested_by <> auth.uid() and not v_admin then
    raise exception 'Only the requester or an admin can cancel a request.' using errcode = '42501';
  end if;
  if a.status in ('cancelled', 'completed', 'rejected') or (a.status = 'approved' and not v_admin) then
    raise exception 'This request is % and cannot be cancelled.', a.status using errcode = '42501';
  end if;
  if a.requested_by <> auth.uid() and v_reason is null then
    raise exception 'Give a reason for cancelling someone else''s request.' using errcode = '22023';
  end if;
  for s in select id from public.approval_steps where request_id = p_id and round = a.round and status = 'pending' loop
    for u in select app.step_approver_users(s.id) loop
      perform app.notify(u, 'approval.cancelled', a.request_no || ' was cancelled', '“' || a.title || '” no longer needs your approval.', p_id);
    end loop;
  end loop;
  update public.approval_steps set status = 'cancelled' where request_id = p_id and round = a.round and status in ('pending', 'locked');
  update public.approval_requests set status = 'cancelled', cancelled_at = now(), updated_by = auth.uid() where id = p_id;
  perform app.approval_log(p_id, 'cancelled', v_reason, null, a.status, 'cancelled',
                           case when a.requested_by = auth.uid() then 'Requester' else 'Admin' end);
  perform app.notify(a.requested_by, 'approval.cancelled', a.request_no || ' was cancelled by an admin', v_reason, p_id);
end;
$$;

/** An admin reopens a rejected, cancelled or returned request: approval starts again from Level 1. */
create or replace function public.approval_reopen(p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_approval_admin() then
    raise exception 'Access denied: only an admin can reopen a request.' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for reopening it.' using errcode = '22023';
  end if;
  select * into a from public.approval_requests where id = p_id for update;
  if a.id is null or a.status = 'draft' then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if a.status not in ('rejected', 'cancelled', 'returned') then
    raise exception 'Only a rejected, cancelled or returned request can be reopened.' using errcode = '42501';
  end if;
  if a.round = 0 then
    raise exception 'This request was never submitted; the requester can submit it.' using errcode = '42501';
  end if;
  perform app.approval_start_round(p_id);
  perform app.approval_log(p_id, 'reopened', v_reason, null, a.status,
                           (select status from public.approval_requests where id = p_id), 'Admin');
  perform app.notify(a.requested_by, 'approval.reopened', a.request_no || ' was reopened', v_reason, p_id);
end;
$$;

/** The requester or an admin marks an approved request as done (bought, paid, travelled). */
create or replace function public.approval_complete(p_id uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_id for update;
  if a.id is null or not app.can_see_approval(p_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if a.requested_by <> auth.uid() and not app.is_approval_admin() then
    raise exception 'Only the requester or an admin can mark it completed.' using errcode = '42501';
  end if;
  if a.status <> 'approved' then
    raise exception 'Only an approved request can be completed.' using errcode = '42501';
  end if;
  update public.approval_requests set status = 'completed', completed_at = now(), updated_by = auth.uid() where id = p_id;
  perform app.approval_log(p_id, 'completed', p_note, null, 'approved', 'completed',
                           case when a.requested_by = auth.uid() then 'Requester' else 'Admin' end);
  perform app.notify(a.requested_by, 'approval.completed', a.request_no || ' was marked completed', p_note, p_id);
end;
$$;

/** An admin changes who approves a level that has not been decided (unavailable approver). */
create or replace function public.approval_reassign(p_step uuid, p_employee uuid default null, p_role uuid default null, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.approval_steps;
  a public.approval_requests;
  v_from text;
  v_to text;
  v_req_emp uuid;
  v_req uuid;
begin
  if not app.is_approval_admin() then
    raise exception 'Access denied: only an admin can change approvers.' using errcode = '42501';
  end if;
  if (p_employee is null) = (p_role is null) then
    raise exception 'Choose one person or one role to approve this level.' using errcode = '22023';
  end if;
  select request_id into v_req from public.approval_steps where id = p_step;
  select * into a from public.approval_requests where id = v_req for update;
  select * into s from public.approval_steps where id = p_step for update;
  if s.id is null then
    raise exception 'Approval level not found.' using errcode = 'P0002';
  end if;
  if s.round <> a.round or a.status not in ('submitted', 'pending', 'in_review') or s.status not in ('pending', 'locked') then
    raise exception 'Level % is already %; its approver cannot change.', s.level_no, s.status using errcode = '42501';
  end if;
  select employee_id into v_req_emp from public.profiles where id = a.requested_by;
  if p_employee is not null and p_employee = v_req_emp then
    raise exception 'The requester cannot approve their own request.' using errcode = '22023';
  end if;
  if p_employee is not null and not exists (select 1 from public.employees where id = p_employee and deleted_at is null) then
    raise exception 'Employee not found.' using errcode = '22023';
  end if;
  v_from := coalesce((select full_name from public.employees where id = s.approver_employee_id),
                     (select name from public.roles where id = s.approver_role_id), 'nobody');
  v_to := coalesce((select full_name from public.employees where id = p_employee), (select name from public.roles where id = p_role));
  update public.approval_steps set
    approver_type = case when p_employee is not null then 'employee' else 'role' end,
    approver_employee_id = p_employee, approver_role_id = p_role
  where id = p_step;
  perform app.approval_refresh(a.id);
  perform app.approval_log(a.id, 'reassigned', p_reason, s.id, s.status, s.status, 'Admin',
                           jsonb_build_object('from', v_from, 'to', v_to));
  if s.status = 'pending' then
    perform app.notify_step(p_step);
  end if;
end;
$$;

/** Whether the caller may add files to a request. */
create or replace function app.approval_can_upload(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.approval_requests a
    where a.id = p_request
      and (app.is_approval_admin() and a.status <> 'draft'
           or (a.requested_by = auth.uid() and a.status not in ('cancelled', 'completed'))
           or (a.status in ('submitted', 'pending', 'in_review')
               and exists (select 1 from public.approval_steps s where s.request_id = a.id and s.round = a.round
                           and s.status <> 'locked' and app.user_is_step_approver(auth.uid(), s.id)))));
$$;

/**
 * Records a file uploaded to storage (documents bucket, approvals/<request>/...)
 * as a new document, or as a new version of p_document. Returns the document id.
 */
create or replace function public.approval_add_document(p_request uuid, p_file jsonb, p_document uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_file->>'file_name', ''));
  v_path text := coalesce(p_file->>'storage_path', '');
  v_size bigint := nullif(p_file->>'size_bytes', '')::bigint;
  v_doc public.approval_documents;
  v_version int;
  v_role text;
begin
  perform app.approval_assert_user();
  if not app.can_see_approval(p_request) or not app.approval_can_upload(p_request) then
    raise exception 'You cannot add documents to this request.' using errcode = '42501';
  end if;
  if lower(v_name) !~ '\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png)$' then
    raise exception 'Only PDF, Word, Excel, JPG and PNG files can be attached.' using errcode = '22023';
  end if;
  if v_size is not null and v_size > 26214400 then
    raise exception 'Files can be up to 25 MB.' using errcode = '22023';
  end if;
  if v_path not like 'approvals/' || p_request::text || '/%' then
    raise exception 'The file was not uploaded to this request.' using errcode = '22023';
  end if;
  v_role := case when (select requested_by from public.approval_requests where id = p_request) = auth.uid() then 'Requester'
                 when app.is_approval_admin() then 'Admin' else 'Approver' end;

  if p_document is null then
    insert into public.approval_documents (request_id, file_name, category, uploaded_by, uploaded_by_name)
    values (p_request, v_name, nullif(p_file->>'category', ''), auth.uid(), app.user_name(auth.uid()))
    returning * into v_doc;
    v_version := 1;
  else
    select * into v_doc from public.approval_documents where id = p_document and request_id = p_request for update;
    if v_doc.id is null or v_doc.deleted_at is not null then
      raise exception 'Document not found.' using errcode = 'P0002';
    end if;
    v_version := v_doc.current_version + 1;
    update public.approval_documents set current_version = v_version, file_name = v_name where id = v_doc.id;
  end if;
  insert into public.approval_document_versions (document_id, version_no, file_name, storage_path, mime_type, size_bytes, note,
                                                 uploaded_by, uploaded_by_name)
  values (v_doc.id, v_version, v_name, v_path, nullif(p_file->>'mime_type', ''), v_size, nullif(btrim(coalesce(p_file->>'note', '')), ''),
          auth.uid(), app.user_name(auth.uid()));
  perform app.approval_log(p_request, case when v_version = 1 then 'document_added' else 'document_version' end,
                           nullif(btrim(coalesce(p_file->>'note', '')), ''), null, null, null, v_role,
                           jsonb_build_object('file_name', v_name, 'size_bytes', v_size), v_doc.id, v_version);
  return v_doc.id;
end;
$$;

/** Hides a document (its versions stay, for the record). The uploader while the request is open, or an admin. */
create or replace function public.approval_delete_document(p_document uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.approval_documents;
  a public.approval_requests;
  v_admin boolean := app.is_approval_admin();
begin
  perform app.approval_assert_user();
  select * into d from public.approval_documents where id = p_document for update;
  if d.id is null or d.deleted_at is not null or not app.can_see_approval(d.request_id) then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  select * into a from public.approval_requests where id = d.request_id;
  if not (v_admin or (d.uploaded_by = auth.uid() and a.status in ('draft', 'submitted', 'pending', 'in_review', 'returned'))) then
    raise exception 'You cannot delete this document.' using errcode = '42501';
  end if;
  update public.approval_documents set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_document;
  perform app.approval_log(d.request_id, 'document_deleted', p_reason, null, null, null,
                           case when a.requested_by = auth.uid() then 'Requester' when v_admin then 'Admin' else 'Approver' end,
                           jsonb_build_object('file_name', d.file_name), d.id, d.current_version);
end;
$$;

create or replace function public.approval_add_comment(p_request uuid, p_body text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_body text := btrim(coalesce(p_body, ''));
  v_role text;
  u uuid;
  s record;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_request;
  if a.id is null or not app.can_see_approval(p_request) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_body = '' then
    raise exception 'Write a comment.' using errcode = '22023';
  end if;
  v_role := case when a.requested_by = auth.uid() then 'Requester' when app.is_approval_admin() then 'Admin' else 'Approver' end;
  insert into public.approval_comments (request_id, body, author_id, author_name) values (p_request, v_body, auth.uid(), app.user_name(auth.uid()));
  perform app.approval_log(p_request, 'commented', v_body, null, null, null, v_role);
  -- The requester and whoever is approving now hear about it.
  perform app.notify(a.requested_by, 'approval.comment', a.request_no || ': new comment', app.user_name(auth.uid()) || ': ' || left(v_body, 200), p_request);
  for s in select id from public.approval_steps where request_id = p_request and round = a.round and status = 'pending' loop
    for u in select app.step_approver_users(s.id) loop
      perform app.notify(u, 'approval.comment', a.request_no || ': new comment', app.user_name(auth.uid()) || ': ' || left(v_body, 200), p_request);
    end loop;
  end loop;
end;
$$;

/** The approver shown for a level: the person, or the role. */
create or replace function app.step_approver_label(p_step uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when s.approver_type = 'role' then (select r.name from public.roles r where r.id = s.approver_role_id)
    else (select e.full_name from public.employees e where e.id = s.approver_employee_id) end
  from public.approval_steps s where s.id = p_step;
$$;

/** Everything about one request the caller may see, with what they may do. */
create or replace function public.approval_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_admin boolean := app.is_approval_admin();
  v_me uuid := auth.uid();
  v_act uuid;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_id;
  if a.id is null or not app.can_see_approval(p_id) then
    raise exception 'Request not found, or you cannot see it.' using errcode = 'P0002';
  end if;
  select s.id into v_act from public.approval_steps s
  where s.request_id = a.id and s.round = a.round and s.status = 'pending'
    and a.status in ('submitted', 'pending', 'in_review') and a.requested_by <> v_me
    and app.user_is_step_approver(v_me, s.id)
  order by s.level_no limit 1;

  return jsonb_build_object(
    'request', (select to_jsonb(a) - 'created_by' - 'updated_by' || jsonb_build_object(
        'requester', app.user_name(a.requested_by),
        'employee_code', (select employee_code from public.employees where id = a.employee_id),
        'department', (select name from public.departments where id = a.department_id),
        'site', (select name from public.sites where id = a.site_id),
        'project', (select name from public.projects where id = a.project_id),
        'completed_levels', (select count(*) from public.approval_steps where request_id = a.id and round = a.round and status in ('approved', 'skipped')),
        'current_approver', (select app.step_approver_label(s.id) from public.approval_steps s
                             where s.request_id = a.id and s.round = a.round and s.status = 'pending' order by level_no limit 1))),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'round', s.round, 'level_no', s.level_no, 'name', s.name, 'approver_type', s.approver_type,
               'approver_employee_id', s.approver_employee_id, 'approver_role_id', s.approver_role_id,
               'approver', app.step_approver_label(s.id),
               'unassigned', s.status in ('pending', 'locked') and app.step_unassigned(s.id),
               'status', s.status, 'activated_at', s.activated_at, 'acted_by_name', s.acted_by_name, 'acted_role', s.acted_role,
               'acted_at', s.acted_at, 'comment', s.comment)
             order by s.round, s.level_no)
      from public.approval_steps s where s.request_id = a.id), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'action', t.action, 'from_status', t.from_status, 'to_status', t.to_status, 'comment', t.comment,
               'actor_name', t.actor_name, 'actor_role', t.actor_role, 'round', t.round, 'level_no', t.level_no,
               'document_id', t.document_id, 'version_no', t.version_no, 'meta', t.meta, 'created_at', t.created_at)
             order by t.id)
      from public.approval_actions t where t.request_id = a.id), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'file_name', d.file_name, 'category', d.category, 'current_version', d.current_version,
               'uploaded_by_name', d.uploaded_by_name, 'created_at', d.created_at, 'updated_at', d.updated_at,
               'deleted_at', d.deleted_at, 'deleted_by_name', app.user_name(d.deleted_by), 'delete_reason', d.delete_reason,
               'can_delete', d.deleted_at is null and (v_admin or (d.uploaded_by = v_me and a.status in ('draft', 'submitted', 'pending', 'in_review', 'returned'))),
               'versions', (select jsonb_agg(jsonb_build_object(
                                     'id', v.id, 'version_no', v.version_no, 'file_name', v.file_name, 'storage_path', v.storage_path,
                                     'mime_type', v.mime_type, 'size_bytes', v.size_bytes, 'note', v.note,
                                     'uploaded_by_name', v.uploaded_by_name, 'uploaded_at', v.uploaded_at)
                                   order by v.version_no desc)
                            from public.approval_document_versions v where v.document_id = d.id))
             order by d.created_at)
      from public.approval_documents d where d.request_id = a.id and (d.deleted_at is null or v_admin)), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'is_admin', v_admin,
      'is_requester', a.requested_by = v_me,
      'can_edit', app.approval_can_edit(a.id),
      'can_submit', a.requested_by = v_me and a.status in ('draft', 'returned'),
      'can_cancel', (a.requested_by = v_me and a.status in ('draft', 'submitted', 'pending', 'in_review', 'returned'))
                    or (v_admin and a.status in ('submitted', 'pending', 'in_review', 'returned', 'approved')),
      'can_reopen', v_admin and a.round > 0 and a.status in ('rejected', 'cancelled', 'returned'),
      'can_complete', a.status = 'approved' and (a.requested_by = v_me or v_admin),
      'can_reassign', v_admin and a.status in ('submitted', 'pending', 'in_review'),
      'can_upload', app.approval_can_upload(a.id),
      'act_step_id', v_act));
end;
$$;

/**
 * The approvals list. p: { tab: all | my_approvals | my_requests, search,
 * status, category, priority, department_id, requester_id, approver_id,
 * from, to, sort, dir, page, page_size }. Returns the page of rows, the
 * total, the dashboard counts and the options for the filters.
 */
create or replace function public.list_approvals(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_admin boolean := app.is_approval_admin();
  v_tab text := coalesce(nullif(p->>'tab', ''), 'all');
  v_search text := nullif(btrim(coalesce(p->>'search', '')), '');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'updated_at');
  v_asc boolean := coalesce(p->>'dir', 'desc') = 'asc';
  v_size int := least(greatest(coalesce(nullif(p->>'page_size', '')::int, 20), 5), 200);
  v_page int := greatest(coalesce(nullif(p->>'page', '')::int, 1), 1);
  v_from date := nullif(p->>'from', '')::date;
  v_to date := nullif(p->>'to', '')::date;
  v_result jsonb;
begin
  perform app.approval_assert_user();

  v_result := (with base as (
    select a.*,
           (a.requested_by = v_me) as mine,
           (select s.id from public.approval_steps s
             where s.request_id = a.id and s.round = a.round and s.status = 'pending' order by s.level_no limit 1) as cur_step
    from public.approval_requests a
    where a.requested_by = v_me
       or (a.status <> 'draft' and (v_admin or exists (select 1 from public.approval_steps s
                                                         where s.request_id = a.id and app.user_is_step_approver(v_me, s.id))))
  ),
  enriched as (
    select b.*,
           coalesce(nullif(pr.full_name, ''), pr.email::text) as requester,
           d.name as department,
           coalesce(cs.level_no, case when b.status in ('rejected', 'returned', 'cancelled') then b.current_level end) as cur_level_no,
           coalesce(cs.name, (select st.name from public.approval_steps st
                              where st.request_id = b.id and st.round = b.round and st.level_no = b.current_level
                                and b.status in ('rejected', 'returned', 'cancelled'))) as cur_level_name,
           case when cs.id is null then null else app.step_approver_label(cs.id) end as cur_approver,
           cs.approver_employee_id as cur_approver_employee,
           (cs.id is not null and not b.mine and b.status in ('submitted', 'pending', 'in_review')
             and app.user_is_step_approver(v_me, cs.id)) as my_turn,
           (select count(*) from public.approval_documents doc where doc.request_id = b.id and doc.deleted_at is null) as attachments
    from base b
    left join public.profiles pr on pr.id = b.requested_by
    left join public.departments d on d.id = b.department_id
    left join public.approval_steps cs on cs.id = b.cur_step
  ),
  filtered as (
    select * from enriched e
    where (case v_tab when 'my_approvals' then e.my_turn when 'my_requests' then e.mine else true end)
      and (nullif(p->>'status', '') is null
           or e.status = p->>'status'
           or (p->>'status' = 'open' and e.status in ('submitted', 'pending', 'in_review')))
      and (nullif(p->>'category', '') is null or e.category = p->>'category')
      and (nullif(p->>'priority', '') is null or e.priority = p->>'priority')
      and (nullif(p->>'department_id', '') is null or e.department_id = (p->>'department_id')::uuid)
      and (nullif(p->>'requester_id', '') is null or e.requested_by = (p->>'requester_id')::uuid)
      and (nullif(p->>'approver_id', '') is null or e.cur_approver_employee = (p->>'approver_id')::uuid)
      and (v_from is null or e.created_at >= v_from::timestamptz)
      and (v_to is null or e.created_at < (v_to + 1)::timestamptz)
      and (v_search is null or e.title ilike '%' || v_search || '%' or e.request_no ilike '%' || v_search || '%'
           or coalesce(e.details, '') ilike '%' || v_search || '%' or coalesce(e.requester, '') ilike '%' || v_search || '%')
  ),
  sorted as (
    select f.*, row_number() over (order by
        case when v_asc then case v_sort
          when 'amount' then coalesce(f.amount, -1)
          when 'priority' then array_position(array['low','normal','high','urgent'], f.priority)
          when 'current_level' then coalesce(f.cur_level_no, 0)
          when 'created_at' then extract(epoch from f.created_at)
          when 'updated_at' then extract(epoch from f.updated_at) end end asc nulls last,
        case when not v_asc then case v_sort
          when 'amount' then coalesce(f.amount, -1)
          when 'priority' then array_position(array['low','normal','high','urgent'], f.priority)
          when 'current_level' then coalesce(f.cur_level_no, 0)
          when 'created_at' then extract(epoch from f.created_at)
          when 'updated_at' then extract(epoch from f.updated_at) end end desc nulls last,
        case when v_asc then case v_sort
          when 'request_no' then f.request_no when 'title' then lower(f.title) when 'category' then f.category
          when 'requester' then lower(f.requester) when 'department' then lower(f.department)
          when 'approver' then lower(f.cur_approver) when 'status' then f.status end end asc nulls last,
        case when not v_asc then case v_sort
          when 'request_no' then f.request_no when 'title' then lower(f.title) when 'category' then f.category
          when 'requester' then lower(f.requester) when 'department' then lower(f.department)
          when 'approver' then lower(f.cur_approver) when 'status' then f.status end end desc nulls last,
        f.updated_at desc) as rn,
      count(*) over () as total
    from filtered f
  )
  select jsonb_build_object(
    'is_admin', v_admin,
    'total', coalesce((select max(total) from sorted), 0),
    'page', v_page,
    'page_size', v_size,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'request_no', s.request_no, 'title', s.title, 'category', s.category,
               'requester', s.requester, 'requester_id', s.requested_by, 'department', s.department,
               'amount', s.amount, 'priority', s.priority, 'status', s.status, 'needed_by', s.needed_by,
               'current_level', s.cur_level_no, 'current_level_name', s.cur_level_name, 'total_levels', s.total_levels,
               'current_approver', s.cur_approver, 'my_turn', s.my_turn, 'mine', s.mine,
               'attachments', s.attachments, 'created_at', s.created_at, 'updated_at', s.updated_at)
             order by s.rn)
      from sorted s where s.rn > (v_page - 1) * v_size and s.rn <= v_page * v_size), '[]'::jsonb),
    'counts', (select jsonb_build_object(
        'total', count(*) filter (where status <> 'draft' or mine),
        'pending', count(*) filter (where status in ('submitted', 'pending', 'in_review')),
        'my_approvals', count(*) filter (where my_turn),
        'my_requests', count(*) filter (where mine),
        'approved', count(*) filter (where status in ('approved', 'completed')),
        'rejected', count(*) filter (where status = 'rejected'),
        'returned', count(*) filter (where status = 'returned'),
        'urgent', count(*) filter (where priority = 'urgent' and status in ('submitted', 'pending', 'in_review', 'returned')))
      from enriched),
    'options', jsonb_build_object(
      'requesters', coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.requested_by, 'name', e.requester)) from enriched e), '[]'::jsonb),
      'approvers', coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.cur_approver_employee, 'name', e.cur_approver))
                             from enriched e where e.cur_approver_employee is not null), '[]'::jsonb),
      'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
                               from public.departments d where d.status = 'active'), '[]'::jsonb))));
  return v_result;
end;
$$;

/** Lists for the request form: departments, sites, projects, the caller's department. */
create or replace function public.approval_form_options()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.approval_assert_user();
  return jsonb_build_object(
    'my_department_id', (select department_id from public.employees where id = app.my_employee_id()),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
                             from public.departments d where d.status = 'active'), '[]'::jsonb),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
                       from public.sites s), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pj.id, 'name', pj.project_code || ' · ' || pj.name) order by pj.name)
                          from public.projects pj where pj.deleted_at is null), '[]'::jsonb),
    'workflows', coalesce((select jsonb_agg(jsonb_build_object('category', w.category, 'name', w.name,
                                   'levels', (select jsonb_agg(l.name order by l.level_no) from public.approval_workflow_levels l where l.workflow_id = w.id)))
                           from public.approval_workflows w where w.is_active), '[]'::jsonb));
end;
$$;

-- ----------------------------------------------------- workflow settings
create or replace function public.approval_settings()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.is_approval_admin() then
    raise exception 'Access denied: only an admin can change approval workflows.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'workflows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'category', w.category, 'description', w.description, 'is_active', w.is_active,
               'updated_at', w.updated_at,
               'levels', coalesce((select jsonb_agg(jsonb_build_object(
                                          'id', l.id, 'level_no', l.level_no, 'name', l.name, 'approver_type', l.approver_type,
                                          'approver_employee_id', l.approver_employee_id, 'approver_role_id', l.approver_role_id,
                                          'approver', case l.approver_type
                                            when 'employee' then (select full_name from public.employees where id = l.approver_employee_id)
                                            when 'role' then (select name from public.roles where id = l.approver_role_id)
                                            else 'Head of the requester''s department' end)
                                        order by l.level_no)
                                  from public.approval_workflow_levels l where l.workflow_id = w.id), '[]'::jsonb))
             order by w.is_active desc, w.category nulls first, w.name)
      from public.approval_workflows w), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name, 'code', e.employee_code, 'department', d.name,
                                          'has_login', exists (select 1 from public.profiles p where p.employee_id = e.id and p.status = 'active'))
             order by e.full_name)
      from public.employees e left join public.departments d on d.id = e.department_id
      where e.deleted_at is null and e.status = 'active'), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'key', r.key,
                                          'members', (select count(*) from public.user_roles ur join public.profiles p on p.id = ur.user_id and p.status = 'active' where ur.role_id = r.id))
                                        order by r.name)
                       from public.roles r where r.is_active and not r.is_system), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'head_employee_id', d.head_employee_id,
                                               'head', (select full_name from public.employees where id = d.head_employee_id))
                                             order by d.name)
                             from public.departments d where d.status = 'active'), '[]'::jsonb));
end;
$$;

/** Creates or updates a workflow template and its levels. Requests already submitted keep their own copy. */
create or replace function public.approval_save_workflow(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_cat text := nullif(p->>'category', '');
  v_name text := btrim(coalesce(p->>'name', ''));
  l jsonb;
  i int := 0;
  v_type text;
begin
  if not app.is_approval_admin() then
    raise exception 'Access denied: only an admin can change approval workflows.' using errcode = '42501';
  end if;
  if v_cat is not null and v_cat not in ('purchase','payment','reimbursement','travel','leave','procurement','project','maintenance','other') then
    raise exception 'Unknown request type %.', v_cat using errcode = '22023';
  end if;
  if length(v_name) < 2 then
    raise exception 'Give the workflow a name.' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'levels') <> 'array' or jsonb_array_length(p->'levels') = 0 then
    raise exception 'A workflow needs at least one approval level.' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'levels') > 20 then
    raise exception 'A workflow can have up to 20 levels.' using errcode = '22023';
  end if;
  if coalesce((p->>'is_active')::boolean, true) and exists (
       select 1 from public.approval_workflows w
       where w.is_active and coalesce(w.category, '*') = coalesce(v_cat, '*') and w.id is distinct from v_id) then
    raise exception 'There is already an active workflow for this type. Edit that one, or switch it off first.' using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.approval_workflows (name, category, description, is_active)
    values (v_name, v_cat, nullif(btrim(coalesce(p->>'description', '')), ''), coalesce((p->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.approval_workflows set name = v_name, category = v_cat,
           description = nullif(btrim(coalesce(p->>'description', '')), ''),
           is_active = coalesce((p->>'is_active')::boolean, true), updated_by = auth.uid()
    where id = v_id;
    if not found then
      raise exception 'Workflow not found.' using errcode = 'P0002';
    end if;
    delete from public.approval_workflow_levels where workflow_id = v_id;
  end if;

  for l in select * from jsonb_array_elements(p->'levels') loop
    i := i + 1;
    v_type := coalesce(l->>'approver_type', '');
    if v_type not in ('employee', 'department_head', 'role') then
      raise exception 'Level %: choose who approves it.', i using errcode = '22023';
    end if;
    if v_type = 'employee' and nullif(l->>'approver_employee_id', '') is null then
      raise exception 'Level %: choose the person who approves it.', i using errcode = '22023';
    end if;
    if v_type = 'role' and nullif(l->>'approver_role_id', '') is null then
      raise exception 'Level %: choose the role that approves it.', i using errcode = '22023';
    end if;
    insert into public.approval_workflow_levels (workflow_id, level_no, name, approver_type, approver_employee_id, approver_role_id)
    values (v_id, i, coalesce(nullif(btrim(l->>'name'), ''), 'Level ' || i), v_type,
            case when v_type = 'employee' then (l->>'approver_employee_id')::uuid end,
            case when v_type = 'role' then (l->>'approver_role_id')::uuid end);
  end loop;
  return v_id;
end;
$$;

create or replace function public.approval_set_department_head(p_department uuid, p_employee uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app.is_approval_admin() then
    raise exception 'Access denied: only an admin can set department heads.' using errcode = '42501';
  end if;
  update public.departments set head_employee_id = p_employee, updated_by = auth.uid() where id = p_department;
end;
$$;

-- ---------------------------------------------------------- notifications
create or replace function public.my_notifications(p_limit int default 30)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'rows', coalesce((select jsonb_agg(to_jsonb(n) - 'user_id' order by n.created_at desc)
                      from (select * from public.notifications where user_id = auth.uid()
                            order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) n), '[]'::jsonb));
$$;

/** Marks the caller's notifications read: the given ones, or all of them. */
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.approval_save(jsonb, uuid, boolean)', 'public.approval_act(uuid, text, text)',
    'public.approval_cancel(uuid, text)', 'public.approval_reopen(uuid, text)', 'public.approval_complete(uuid, text)',
    'public.approval_reassign(uuid, uuid, uuid, text)', 'public.approval_add_document(uuid, jsonb, uuid)',
    'public.approval_delete_document(uuid, text)', 'public.approval_add_comment(uuid, text)',
    'public.approval_detail(uuid)', 'public.list_approvals(jsonb)', 'public.approval_form_options()',
    'public.approval_settings()', 'public.approval_save_workflow(jsonb)', 'public.approval_set_department_head(uuid, uuid)',
    'public.my_notifications(int)', 'public.mark_notifications_read(uuid[])']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Internal helpers are not callable from the app.
do $$
declare f text;
begin
  foreach f in array array[
    'app.notify(uuid, text, text, text, uuid)', 'app.notify_step(uuid)',
    'app.approval_log(uuid, text, text, uuid, text, text, text, jsonb, uuid, int)',
    'app.approval_refresh(uuid)', 'app.approval_start_round(uuid)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------- Today in the company
-- The dashboard's Approvals line counts the open statuses of the
-- multi-level workflow (the same function as 20261007000001, otherwise
-- unchanged).
create or replace function public.get_company_today()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := v_now::date;
  -- The day filings are judged on: yesterday until 6 pm.
  v_day date := case when extract(hour from v_now) >= 18 then v_now::date else v_now::date - 1 end;
  v_day_label text := case when extract(hour from v_now) >= 18 then 'today' else 'yesterday' end;
  v_out jsonb := '[]'::jsonb;
  a int; b int; c int; d int; d2 int; e numeric; f numeric;
  v_light text;
  v_chips jsonb;
begin
  if not app.is_active_user() then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------- O&M
  if app.sees_all('om.daily_entry') or app.sees_all('om.generation') then
    select count(*) into a from public.sites where status = 'active';
    -- plants that filed readings on the judged day, and today so far
    select count(distinct g.site_id) filter (where g.gen_date = v_day),
           count(distinct g.site_id) filter (where g.gen_date = v_today)
      into b, c
      from public.generation_records g join public.sites s on s.id = g.site_id and s.status = 'active'
      where g.gen_date in (v_day, v_today) and g.deleted_at is null;
    select coalesce(sum(generation_kwh), 0), coalesce(sum(expected_kwh), 0) into e, f
      from public.generation_records where gen_date = v_today - 1 and deleted_at is null;
    -- open tickets; d2 holds the critical ones
    select count(*) filter (where status in ('open','assigned','in_progress')),
           count(*) filter (where status in ('open','assigned','in_progress') and priority = 'critical')
      into d, d2
      from public.maintenance_tickets where deleted_at is null;
    v_light := case when d2 > 0 then 'bad' else app.light(b, a) end;
    v_out := v_out || jsonb_build_object(
      'key', 'om', 'title', 'O&M', 'route', '/operations/daily-entry', 'status', v_light,
      'headline', format('%s of %s plants filed readings %s', b, a, v_day_label),
      'facts', jsonb_build_array(
        format('Today so far: %s of %s plants', c, a),
        case when f > 0 then format('Yesterday''s generation: %s kWh (%s%% of expected)', to_char(e, 'FM99,99,99,990'), round(100 * e / f))
             else format('Yesterday''s generation: %s kWh', to_char(e, 'FM99,99,99,990')) end,
        format('%s open ticket(s)%s', d, case when d2 > 0 then format(', %s critical', d2) else '' end)));
  end if;

  -- -------------------------------------------------------- Projects
  if app.sees_all('projects.projects') or app.sees_all('projects.updates') then
    select count(*) into a from public.projects
      where deleted_at is null and stage not in ('commissioning','handover','closed');
    select count(distinct u.project_id) into b from public.project_updates u
      join public.projects p on p.id = u.project_id and p.deleted_at is null and p.stage not in ('commissioning','handover','closed')
      where u.update_date = v_day and u.deleted_at is null;
    select count(*) into c from public.project_updates u
      where u.update_date between v_today - 1 and v_today and u.deleted_at is null and u.safety_followed = false;
    select count(*) into d from public.project_tasks t join public.projects p on p.id = t.project_id and p.deleted_at is null
      where t.deleted_at is null and t.status not in ('done','cancelled') and t.due_date < v_today;
    v_light := case when a = 0 then 'good' when c > 0 and app.light(b, a) = 'good' then 'ok' else app.light(b, a) end;
    v_out := v_out || jsonb_build_object(
      'key', 'projects', 'title', 'Projects', 'route', '/projects/updates', 'status', v_light,
      'headline', case when a = 0 then 'No sites under construction'
                       else format('%s of %s sites under construction filed a DPR %s', b, a, v_day_label) end,
      'facts', jsonb_build_array(
        format('%s overdue task(s)', d),
        case when c > 0 then format('Safety not followed at %s site(s) — see the DPR', c) else 'Safety followed at every site that reported' end));
  end if;

  -- --------------------------------------------------------- Tenders
  if app.sees_all('crm.tenders') then
    select count(*) into a from public.tenders where deleted_at is null
      and status in ('identified','evaluating','preparing') and submission_due_at < now();
    select count(*) into b from public.tenders where deleted_at is null
      and status in ('identified','evaluating','preparing') and submission_due_at between now() and now() + interval '3 days';
    select count(*) into c from public.tenders where deleted_at is null
      and status in ('identified','evaluating','preparing') and submission_due_at between now() and now() + interval '7 days';
    select count(*) into d from public.tenders where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date = v_today;
    v_light := case when a > 0 then 'bad' when b > 0 then 'ok' else 'good' end;
    v_out := v_out || jsonb_build_object(
      'key', 'tenders', 'title', 'Tenders', 'route', '/crm/tenders', 'status', v_light,
      'headline', case when a > 0 then format('%s tender(s) past the due date and not submitted', a)
                       when b > 0 then format('%s tender(s) due in the next 3 days', b)
                       else format('%s tender(s) due this week — all on time', c) end,
      'facts', jsonb_build_array(
        format('%s due in the next 7 days', c),
        format('%s new tender(s) added today', d),
        format('%s submitted, %s won this month',
               (select count(*) from public.tenders where deleted_at is null and submitted_at >= date_trunc('month', v_now)),
               (select count(*) from public.tenders where deleted_at is null and status = 'won' and coalesce(result_declared_on, updated_at::date) >= date_trunc('month', v_now)::date))));
  end if;

  -- --------------------------------------------- Department Review
  if app.sees_all('daily.reports') then
    select count(*) into a from public.departments where status = 'active' and in_daily_review;
    select count(distinct r.department_id) into b from public.daily_reports r
      join public.departments d2 on d2.id = r.department_id and d2.status = 'active' and d2.in_daily_review
      where r.report_date = v_day and r.deleted_at is null and r.status <> 'draft';
    select count(*) into c from public.daily_reports r
      where r.report_date = v_day and r.deleted_at is null and r.status <> 'draft' and r.health = 'critical';
    -- One chip per department: its health that day, or not filed.
    select coalesce(jsonb_agg(jsonb_build_object('label', d2.name,
             'status', case r.health when 'on_track' then 'good' when 'needs_attention' then 'ok' when 'critical' then 'bad' else 'none' end,
             'note', case when r.id is null then 'not filed' else replace(r.health::text, '_', ' ') end)
             order by case r.health when 'critical' then 0 when 'needs_attention' then 1 when 'on_track' then 3 else 2 end, d2.name), '[]'::jsonb)
      into v_chips
      from public.departments d2
      left join lateral (select * from public.daily_reports x where x.department_id = d2.id and x.report_date = v_day
                         and x.deleted_at is null and x.status <> 'draft' order by x.updated_at desc limit 1) r on true
      where d2.status = 'active' and d2.in_daily_review;
    v_light := case when c > 0 then 'bad' else app.light(b, a) end;
    v_out := v_out || jsonb_build_object(
      'key', 'departments', 'title', 'Departments', 'route', '/daily-review/reports', 'status', v_light,
      'headline', format('%s of %s departments reported %s', b, a, v_day_label),
      'facts', jsonb_build_array(case when c > 0 then format('%s department(s) critical', c) else 'No department critical' end),
      'chips', v_chips);
  end if;

  -- ------------------------------------------------- HR daily work
  if app.sees_all('hr.worklog') then
    select cardinality(coalesce(public.daily_sheet_filers(), '{}'::uuid[])) into a;
    select count(*) into b from public.work_logs w
      where w.log_date = v_day and w.deleted_at is null and w.status = 'submitted'
        and w.employee_id = any (coalesce(public.daily_sheet_filers(), '{}'::uuid[]));
    select count(*) into c from public.work_logs w
      where w.log_date = v_today and w.deleted_at is null and w.status = 'submitted'
        and w.employee_id = any (coalesce(public.daily_sheet_filers(), '{}'::uuid[]));
    -- Best and lowest filing department that day.
    select coalesce(jsonb_agg(jsonb_build_object('label', name, 'status', app.light(done, total),
             'note', format('%s/%s', done, total)) order by done::numeric / total desc, name), '[]'::jsonb)
      into v_chips
      from (select d2.name, count(*) total,
                   count(*) filter (where exists (select 1 from public.work_logs w where w.employee_id = e2.id and w.log_date = v_day
                                                  and w.deleted_at is null and w.status = 'submitted')) done
            from public.employees e2 join public.departments d2 on d2.id = e2.department_id
            where e2.id = any (coalesce(public.daily_sheet_filers(), '{}'::uuid[]))
            group by d2.name) x;
    v_out := v_out || jsonb_build_object(
      'key', 'hr', 'title', 'Daily Work (HR)', 'route', '/hr/work-history', 'status', app.light(b, a),
      'headline', format('%s of %s employees submitted their sheet %s', b, a, v_day_label),
      'facts', jsonb_build_array(format('Today so far: %s of %s', c, a)),
      'chips', v_chips);
  end if;

  -- ------------------------------------------------------- Approvals
  if app.is_approval_admin() then
    select count(*) filter (where status in ('submitted','pending','in_review')),
           count(*) filter (where status in ('submitted','pending','in_review') and submitted_at < now() - interval '3 days'),
           count(*) filter (where (created_at at time zone 'Asia/Kolkata')::date = v_today)
      into a, b, c
      from public.approval_requests;
    v_out := v_out || jsonb_build_object(
      'key', 'approvals', 'title', 'Approvals', 'route', '/approvals', 'status',
      case when b > 0 then 'bad' when a > 0 then 'ok' else 'good' end,
      'headline', case when a = 0 then 'Nothing waiting for a decision' else format('%s request(s) waiting for a decision', a) end,
      'facts', jsonb_build_array(
        case when b > 0 then format('%s waiting more than 3 days', b) else 'None waiting more than 3 days' end,
        format('%s new request(s) today', c)));
  end if;

  return jsonb_build_object('judged_on', v_day, 'judged_label', v_day_label, 'sections', v_out);
end;
$$;
