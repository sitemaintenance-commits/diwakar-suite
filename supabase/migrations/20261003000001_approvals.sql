-- =====================================================================
-- APPROVALS
--
-- Any employee asks the company for something -- a purchase, a payment or
-- reimbursement, an advance, travel, time off, equipment -- and the
-- approvers (the Super Admins, and any role given APPROVE on Approvals)
-- approve it, reject it, or send it back for more information. The
-- employee follows their request to the decision.
--
--   * Employees see only their own requests (and their attachments);
--     approvers see everyone's.
--   * A request is pending, needs_info (sent back), approved, rejected or
--     cancelled. The requester may edit and resubmit what was sent back,
--     and cancel what is still open. Every step is kept in the request's
--     history and the audit log.
--   * Attachments are documents attached to the request (entity_type
--     'approval'), visible only to the requester and the approvers.
-- =====================================================================

create sequence if not exists public.approval_no_seq start 1;

create table public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text not null unique default ('APR-' || lpad(nextval('public.approval_no_seq')::text, 4, '0')),
  requested_by  uuid not null references public.profiles(id) on delete restrict,
  employee_id   uuid references public.employees(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  category      text not null check (category in ('purchase','payment','advance','travel','leave','equipment','other')),
  title         text not null check (length(btrim(title)) between 3 and 200),
  details       text,
  amount        numeric(14,2) check (amount is null or amount >= 0),
  needed_by     date,
  priority      text not null default 'normal' check (priority in ('normal','urgent')),
  site_id       uuid references public.sites(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','needs_info','approved','rejected','cancelled')),
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid
);
create index approval_requests_status_idx on public.approval_requests(status, created_at desc);
create index approval_requests_requester_idx on public.approval_requests(requested_by, created_at desc);

create table public.approval_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.approval_requests(id) on delete cascade,
  action      text not null check (action in ('submitted','resubmitted','approved','rejected','needs_info','cancelled')),
  note        text,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index approval_events_request_idx on public.approval_events(request_id, created_at);

comment on table public.approval_requests is 'Requests employees make to the company (purchase, payment, advance, travel, leave, equipment), and the approver''s decision.';

-- All changes go through the functions below; reading is through them too.
alter table public.approval_requests enable row level security;
alter table public.approval_events enable row level security;
revoke all on public.approval_requests, public.approval_events from anon, authenticated;

create trigger touch_row before update on public.approval_requests for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.approval_requests
  for each row execute function app.audit_row_change('approvals');

-- ------------------------------------------------------------ the module
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'approvals', 'Approvals',
       'Purchase, payment, advance, travel and other requests to the company, and their approval',
       '/approvals', 'BadgeCheck', 6, '{view,create,approve,export}', true, false, true, true, 1
from public.module_groups g where g.key = 'dashboard'
on conflict (key) do nothing;

-- Everyone raises and follows their own requests; Management decides with
-- the Super Admins (who hold every permission). Give APPROVE to any other
-- role in Role Management.
insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, a.action::public.perm_action, a.scope::public.perm_scope
from public.roles r
cross join public.modules m
cross join (values ('view', 'own'), ('create', 'own')) as a(action, scope)
where m.key = 'approvals'
on conflict (role_id, module_id, action) do nothing;
insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, a.action::public.perm_action, 'all'
from public.roles r
cross join public.modules m
cross join (values ('view'), ('approve'), ('export')) as a(action)
where m.key = 'approvals' and r.key = 'management'
on conflict (role_id, module_id, action) do update set scope = 'all';

/** Whether the caller decides requests: Super Admin, or APPROVE on Approvals. */
create or replace function app.can_approve_requests()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user() and (app.is_super_admin() or app.has_perm('approvals', 'approve'));
$$;

/** Whether the caller may see this request: their own, or they decide requests. */
create or replace function app.can_see_approval(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user() and (
    app.can_approve_requests()
    or exists (select 1 from public.approval_requests a where a.id = p_request and a.requested_by = auth.uid()));
$$;

-- Attachments: a document on a request is seen only by its requester and the approvers.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (deleted_at is null
     and (select app.is_active_user())
     and app.has_perm(module_key, 'view')
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and (entity_type <> 'approval' or app.can_see_approval(entity_id)));

-- ------------------------------------------------------------- functions
/** Raise a request, or edit and resubmit one that was sent back. Returns its id. */
create or replace function public.save_approval_request(p_request jsonb, p_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_emp uuid := app.my_employee_id();
  v_row public.approval_requests;
  v_id uuid;
begin
  if not app.is_active_user() or not app.has_perm('approvals', 'create') then
    raise exception 'Access denied: you cannot raise requests.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_request->>'title', '')), '') is null then
    raise exception 'Give the request a title.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.approval_requests
      (requested_by, employee_id, department_id, category, title, details, amount, needed_by, priority, site_id)
    values (v_me, v_emp, (select department_id from public.employees where id = v_emp),
            coalesce(nullif(p_request->>'category', ''), 'other'),
            btrim(p_request->>'title'),
            nullif(btrim(coalesce(p_request->>'details', '')), ''),
            nullif(p_request->>'amount', '')::numeric,
            nullif(p_request->>'needed_by', '')::date,
            coalesce(nullif(p_request->>'priority', ''), 'normal'),
            nullif(p_request->>'site_id', '')::uuid)
    returning id into v_id;
    insert into public.approval_events (request_id, action, actor_id) values (v_id, 'submitted', v_me);
    return v_id;
  end if;

  select * into v_row from public.approval_requests where id = p_id;
  if v_row.id is null or v_row.requested_by <> v_me then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('pending', 'needs_info') then
    raise exception 'This request is already %; it can no longer be changed.', v_row.status using errcode = '42501';
  end if;
  update public.approval_requests set
    category = coalesce(nullif(p_request->>'category', ''), category),
    title = btrim(p_request->>'title'),
    details = nullif(btrim(coalesce(p_request->>'details', '')), ''),
    amount = nullif(p_request->>'amount', '')::numeric,
    needed_by = nullif(p_request->>'needed_by', '')::date,
    priority = coalesce(nullif(p_request->>'priority', ''), priority),
    site_id = nullif(p_request->>'site_id', '')::uuid,
    status = 'pending',
    updated_by = v_me
  where id = p_id;
  if v_row.status = 'needs_info' then
    insert into public.approval_events (request_id, action, note, actor_id)
    values (p_id, 'resubmitted', nullif(btrim(coalesce(p_request->>'note', '')), ''), v_me);
  end if;
  return p_id;
end;
$$;

/** An approver approves, rejects or sends back a request, with a note. */
create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.approval_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.can_approve_requests() then
    raise exception 'Access denied: only approvers decide requests.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected', 'needs_info') then
    raise exception 'Unknown decision %.', p_decision using errcode = '22023';
  end if;
  if p_decision in ('rejected', 'needs_info') and v_note is null then
    raise exception 'Say why, so the employee knows what to do.' using errcode = '22023';
  end if;
  select * into v_row from public.approval_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('pending', 'needs_info') then
    raise exception 'This request is already %.', v_row.status using errcode = '42501';
  end if;
  update public.approval_requests set
    status = p_decision,
    decided_by = case when p_decision = 'needs_info' then null else auth.uid() end,
    decided_at = case when p_decision = 'needs_info' then null else now() end,
    decision_note = v_note,
    updated_by = auth.uid()
  where id = p_id;
  insert into public.approval_events (request_id, action, note, actor_id) values (p_id, p_decision, v_note, auth.uid());
end;
$$;

/** The requester withdraws a request that is still open. */
create or replace function public.cancel_approval(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.approval_requests;
begin
  select * into v_row from public.approval_requests where id = p_id for update;
  if v_row.id is null or v_row.requested_by <> auth.uid() then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('pending', 'needs_info') then
    raise exception 'This request is already %.', v_row.status using errcode = '42501';
  end if;
  update public.approval_requests set status = 'cancelled', updated_by = auth.uid() where id = p_id;
  insert into public.approval_events (request_id, action, actor_id) values (p_id, 'cancelled', auth.uid());
end;
$$;

/**
 * Requests the caller may see, newest first: p_view 'mine' (their own),
 * 'to_approve' (open ones, for approvers) or 'all' (approvers). With
 * p_status to narrow it. Each row says what the caller may do with it.
 */
create or replace function public.list_approvals(p_view text default 'mine', p_status text default null,
                                                 p_search text default null, p_limit int default 100)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_approver boolean := app.can_approve_requests();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not app.is_active_user() or not app.has_perm('approvals', 'view') and not v_approver then
    raise exception 'Access denied: approvals VIEW permission required.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'approver', v_approver,
    'waiting', case when v_approver then (select count(*) from public.approval_requests where status = 'pending') else 0 end,
    'rows', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc)
      from (
        select jsonb_build_object(
                 'id', a.id, 'request_no', a.request_no, 'category', a.category, 'title', a.title,
                 'details', a.details, 'amount', a.amount, 'needed_by', a.needed_by, 'priority', a.priority,
                 'status', a.status, 'decision_note', a.decision_note, 'decided_at', a.decided_at,
                 'decided_by', (select p.full_name from public.profiles p where p.id = a.decided_by),
                 'requested_by', coalesce(p.full_name, p.email), 'requester_id', a.requested_by,
                 'employee_code', e.employee_code, 'department', d.name, 'site', s.name, 'site_id', a.site_id,
                 'created_at', a.created_at, 'updated_at', a.updated_at,
                 'mine', a.requested_by = v_me,
                 'can_decide', v_approver and a.status in ('pending', 'needs_info'),
                 'can_edit', a.requested_by = v_me and a.status in ('pending', 'needs_info'),
                 'attachments', (select count(*) from public.documents doc
                                 where doc.entity_type = 'approval' and doc.entity_id = a.id and doc.deleted_at is null),
                 'events', coalesce((select jsonb_agg(jsonb_build_object('action', ev.action, 'note', ev.note, 'at', ev.created_at,
                                                                        'by', (select pp.full_name from public.profiles pp where pp.id = ev.actor_id))
                                                      order by ev.created_at)
                                     from public.approval_events ev where ev.request_id = a.id), '[]'::jsonb)) as x
        from public.approval_requests a
        left join public.profiles p on p.id = a.requested_by
        left join public.employees e on e.id = a.employee_id
        left join public.departments d on d.id = a.department_id
        left join public.sites s on s.id = a.site_id
        where (case coalesce(p_view, 'mine')
                 when 'mine' then a.requested_by = v_me
                 when 'to_approve' then v_approver and a.status = 'pending'
                 else v_approver or a.requested_by = v_me end)
          and (p_status is null or a.status = p_status)
          and (v_search is null or a.title ilike '%' || v_search || '%' or a.request_no ilike '%' || v_search || '%'
               or coalesce(a.details, '') ilike '%' || v_search || '%' or coalesce(p.full_name, '') ilike '%' || v_search || '%')
        order by a.created_at desc
        limit greatest(coalesce(p_limit, 100), 1)) q), '[]'::jsonb));
end;
$$;

grant execute on function public.save_approval_request(jsonb, uuid), public.decide_approval(uuid, text, text),
                          public.cancel_approval(uuid), public.list_approvals(text, text, text, int) to authenticated;
revoke execute on function public.save_approval_request(jsonb, uuid), public.decide_approval(uuid, text, text),
                           public.cancel_approval(uuid), public.list_approvals(text, text, text, int) from anon, public;

-- Attaching to a request: only to one you may see (your own, or as approver).
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (created_by = (select auth.uid())
     and (select app.is_active_user())
     and not app.is_blocked_file(file_name)
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and (app.has_perm(module_key, 'create') or app.has_perm(module_key, 'edit')
          or (entity_type = 'section' and app.has_perm(module_key, 'view')))
     and (entity_type <> 'approval' or app.can_see_approval(entity_id)));
