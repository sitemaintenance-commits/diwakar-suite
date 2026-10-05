-- =====================================================================
-- APPROVALS GO TO A CHOSEN APPROVER
--
-- An employee sends each request to one approver: a department head, or
-- the senior HR. That approver sees the requests sent to them, decides
-- them, and the employee sees who approved. The Super Admins (and any role
-- with APPROVE on Approvals) still see and decide everything.
--
--   * approval_approvers lists who may be chosen. Seeded with the six
--     department heads and the senior HR.
--   * approval_requests.approver_id is the chosen approver (an employee).
--   * An approver who logs in sees only their own name in the approver
--     filter; a Super Admin sees everyone's.
-- =====================================================================

create table public.approval_approvers (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  title       text,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now()
);
comment on table public.approval_approvers is 'Who employees may send approval requests to.';
alter table public.approval_approvers enable row level security;
revoke all on public.approval_approvers from anon, authenticated;

insert into public.approval_approvers (employee_id, title, sort_order)
select e.id, v.title, v.ord
from (values
  ('DRIPL_1099', 'Head · Admin', 1),
  ('DRIPL_1090', 'Head · Design & Engineering', 2),
  ('DRIPL_1101', 'Head · HR', 3),
  ('DRIPL_1093', 'Head · O&M / Service', 4),
  ('DRIPL_1063', 'Head · Procurement & Stores', 5),
  ('DRIPL_1002', 'Head · Projects & Installation', 6),
  ('DRIPL_1071', 'Senior HR', 7)
) as v(code, title, ord)
join public.employees e on e.employee_code = v.code and e.deleted_at is null
on conflict (employee_id) do nothing;

alter table public.approval_requests
  add column if not exists approver_id uuid references public.employees(id) on delete set null;
create index if not exists approval_requests_approver_idx on public.approval_requests(approver_id, status);

/** The caller's employee record if they are on the approver list, else null. */
create or replace function app.my_approver_employee()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select a.employee_id from public.approval_approvers a
  where a.employee_id = app.my_employee_id() and app.is_active_user();
$$;

/** Whether the caller decides every request: Super Admin, or APPROVE on Approvals. */
create or replace function app.can_approve_requests()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user() and (app.is_super_admin() or app.has_perm('approvals', 'approve'));
$$;

/** Whether the caller decides this request: it was sent to them, or they decide every request. */
create or replace function app.can_decide_approval(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.can_approve_requests()
      or exists (select 1 from public.approval_requests a
                 where a.id = p_request and a.approver_id is not null and a.approver_id = app.my_approver_employee());
$$;

/** Whether the caller may see this request: their own, sent to them, or they decide every request. */
create or replace function app.can_see_approval(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user() and (
    app.can_decide_approval(p_request)
    or exists (select 1 from public.approval_requests a where a.id = p_request and a.requested_by = auth.uid()));
$$;

/** Who a request can be sent to; and which names the caller may filter by. */
create or replace function public.list_approvers()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := app.my_employee_id();
begin
  if not app.is_active_user() then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'all', app.can_approve_requests(),
    'me', app.my_approver_employee(),
    'approvers', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'title', a.title,
                                          'department', d.name, 'me', e.id = v_me,
                                          'has_login', exists (select 1 from public.profiles p where p.employee_id = e.id and p.status = 'active'))
                       order by a.sort_order, e.full_name)
      from public.approval_approvers a
      join public.employees e on e.id = a.employee_id and e.deleted_at is null and e.status = 'active'
      left join public.departments d on d.id = e.department_id), '[]'::jsonb));
end;
$$;

-- ------------------------------------------------------- raise / resubmit
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
  v_approver uuid := nullif(p_request->>'approver_id', '')::uuid;
begin
  if not app.is_active_user() or not app.has_perm('approvals', 'create') then
    raise exception 'Access denied: you cannot raise requests.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_request->>'title', '')), '') is null then
    raise exception 'Give the request a title.' using errcode = '22023';
  end if;
  if v_approver is null and exists (select 1 from public.approval_approvers) then
    raise exception 'Choose who the request goes to.' using errcode = '22023';
  end if;
  if v_approver is not null and not exists (select 1 from public.approval_approvers where employee_id = v_approver) then
    raise exception 'That person does not approve requests.' using errcode = '22023';
  end if;
  if v_approver is not null and v_approver = v_emp then
    raise exception 'Send your request to someone else: you cannot approve your own.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.approval_requests
      (requested_by, employee_id, department_id, category, title, details, amount, needed_by, priority, site_id, approver_id)
    values (v_me, v_emp, (select department_id from public.employees where id = v_emp),
            coalesce(nullif(p_request->>'category', ''), 'other'),
            btrim(p_request->>'title'),
            nullif(btrim(coalesce(p_request->>'details', '')), ''),
            nullif(p_request->>'amount', '')::numeric,
            nullif(p_request->>'needed_by', '')::date,
            coalesce(nullif(p_request->>'priority', ''), 'normal'),
            nullif(p_request->>'site_id', '')::uuid,
            v_approver)
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
    approver_id = coalesce(v_approver, approver_id),
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

-- ------------------------------------------------------------- decide
create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.approval_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.can_decide_approval(p_id) then
    raise exception 'Access denied: only the approver it was sent to (or a Super Admin) decides this request.' using errcode = '42501';
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
  if v_row.requested_by = auth.uid() and not app.is_super_admin() then
    raise exception 'You cannot decide your own request.' using errcode = '42501';
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

-- --------------------------------------------------------------- list
drop function if exists public.list_approvals(text, text, text, int);

/**
 * Requests the caller may see, newest first. p_view: 'mine' (their own),
 * 'to_approve' (open ones they decide) or 'all' (everything they decide,
 * any status). p_approver narrows to one approver -- for a Super Admin any
 * approver, for an approver only themselves.
 */
create or replace function public.list_approvals(p_view text default 'mine', p_status text default null,
                                                 p_search text default null, p_limit int default 100,
                                                 p_approver uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_all boolean := app.can_approve_requests();
  v_mine_emp uuid := app.my_approver_employee();
  v_approver boolean := v_all or v_mine_emp is not null;
  v_filter uuid := case when v_all then p_approver else v_mine_emp end;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not app.is_active_user() or (not app.has_perm('approvals', 'view') and not v_approver) then
    raise exception 'Access denied: approvals VIEW permission required.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'approver', v_approver,
    'all', v_all,
    'waiting', case when v_approver then (
                 select count(*) from public.approval_requests a
                 where a.status = 'pending' and (v_all or a.approver_id = v_mine_emp)
                   and (not v_all or p_approver is null or a.approver_id = p_approver)) else 0 end,
    'rows', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc)
      from (
        select jsonb_build_object(
                 'id', a.id, 'request_no', a.request_no, 'category', a.category, 'title', a.title,
                 'details', a.details, 'amount', a.amount, 'needed_by', a.needed_by, 'priority', a.priority,
                 'status', a.status, 'decision_note', a.decision_note, 'decided_at', a.decided_at,
                 'decided_by', (select p2.full_name from public.profiles p2 where p2.id = a.decided_by),
                 'approver_id', a.approver_id,
                 'approver', (select ap.full_name from public.employees ap where ap.id = a.approver_id),
                 'requested_by', coalesce(p.full_name, p.email), 'requester_id', a.requested_by,
                 'employee_code', e.employee_code, 'department', d.name, 'site', s.name, 'site_id', a.site_id,
                 'created_at', a.created_at, 'updated_at', a.updated_at,
                 'mine', a.requested_by = v_me,
                 'can_decide', a.status in ('pending', 'needs_info')
                               and (v_all or (v_mine_emp is not null and a.approver_id = v_mine_emp))
                               and (a.requested_by is distinct from v_me or app.is_super_admin()),
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
                 when 'to_approve' then v_approver and a.status = 'pending' and (v_all or a.approver_id = v_mine_emp)
                 else (v_all or (v_mine_emp is not null and a.approver_id = v_mine_emp)) end)
          and (coalesce(p_view, 'mine') = 'mine' or v_filter is null or a.approver_id = v_filter)
          and (p_status is null or a.status = p_status)
          and (v_search is null or a.title ilike '%' || v_search || '%' or a.request_no ilike '%' || v_search || '%'
               or coalesce(a.details, '') ilike '%' || v_search || '%' or coalesce(p.full_name, '') ilike '%' || v_search || '%')
        order by a.created_at desc
        limit greatest(coalesce(p_limit, 100), 1)) q), '[]'::jsonb));
end;
$$;

grant execute on function public.list_approvals(text, text, text, int, uuid), public.list_approvers() to authenticated;
revoke execute on function public.list_approvals(text, text, text, int, uuid), public.list_approvers() from anon, public;
