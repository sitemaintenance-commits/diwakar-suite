-- =====================================================================
-- TRANSFER AN APPROVAL, OR ASK A SENIOR OFFICER FOR A SUGGESTION
--
-- Whoever's turn it is to approve can:
--   * approval_transfer: hand their level to someone on the approver
--     list, with a reason. That person now decides; the one who
--     transferred it can still read the request.
--   * approval_ask_suggestion: ask someone on the approver list a question.
--     The request stays with the approver, who need not wait for the
--     reply; the person asked can read the request and answers with
--     approval_reply_suggestion.
-- Everything goes on the timeline.
-- =====================================================================

-- People who can read a request without being one of its approvers.
create table public.approval_viewers (
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (request_id, user_id)
);
alter table public.approval_viewers enable row level security;

create table public.approval_consults (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.approval_requests(id) on delete cascade,
  step_id       uuid references public.approval_steps(id) on delete set null,
  asked_by      uuid references public.profiles(id) on delete set null,
  asked_by_name text,
  asked_user    uuid not null references public.profiles(id) on delete cascade,
  asked_name    text not null,
  question      text not null,
  reply         text,
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index approval_consults_request_idx on public.approval_consults(request_id);
create index approval_consults_open_idx on public.approval_consults(asked_user) where replied_at is null;
alter table public.approval_consults enable row level security;

create or replace function app.can_see_approval(p_request uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user() and exists (
    select 1 from public.approval_requests a
    where a.id = p_request
      and (a.requested_by = auth.uid()
           or (a.status <> 'draft' and app.approval_sees_all())
           or exists (select 1 from public.approval_steps s
                      where s.request_id = a.id and app.user_is_step_approver(auth.uid(), s.id))
           or exists (select 1 from public.approval_viewers v
                      where v.request_id = a.id and v.user_id = auth.uid())));
$$;

/** Locks the request of a level, and refuses unless it is the caller's turn on it. */
create or replace function app.approval_lock_my_turn(p_step uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  s public.approval_steps;
  v_req uuid;
begin
  perform app.approval_assert_user();
  select request_id into v_req from public.approval_steps where id = p_step;
  if v_req is null then
    raise exception 'Approval level not found.' using errcode = 'P0002';
  end if;
  select * into a from public.approval_requests where id = v_req for update;
  select * into s from public.approval_steps where id = p_step for update;
  if not app.user_is_step_approver(auth.uid(), s.id) then
    raise exception 'You are not the approver for Level % of this request.', s.level_no using errcode = '42501';
  end if;
  if a.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request.' using errcode = '42501';
  end if;
  if s.round <> a.round or a.status not in ('submitted', 'pending', 'in_review') or s.status <> 'pending' then
    raise exception 'It is not your turn on this request.' using errcode = '42501';
  end if;
  return v_req;
end;
$$;

/** The login of someone a request can be sent to: on the approver list, active, not the requester or the caller. */
create or replace function app.approval_senior_user(p_request uuid, p_employee uuid)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not exists (select 1 from public.employees e where e.id = p_employee and e.deleted_at is null and e.status = 'active')
     or not (exists (select 1 from public.approval_approvers ap where ap.employee_id = p_employee)
             or p_employee is not distinct from app.approval_final_employee()
             or p_employee is not distinct from app.approval_marketing_employee()) then
    raise exception 'Choose someone from the approver list.' using errcode = '22023';
  end if;
  if p_employee = app.my_employee_id() then
    raise exception 'Choose someone other than yourself.' using errcode = '22023';
  end if;
  if p_employee = (select pr.employee_id from public.approval_requests a join public.profiles pr on pr.id = a.requested_by where a.id = p_request) then
    raise exception 'The requester cannot approve their own request.' using errcode = '22023';
  end if;
  select p.id into v_user from public.profiles p where p.employee_id = p_employee and p.status = 'active' limit 1;
  if v_user is null then
    raise exception 'That person has no active login.' using errcode = '22023';
  end if;
  return v_user;
end;
$$;

create or replace function public.approval_transfer(p_step uuid, p_employee uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_req uuid := app.approval_lock_my_turn(p_step);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  a public.approval_requests;
  s public.approval_steps;
  v_to text;
  v_from text := app.user_name(auth.uid());
begin
  if v_reason is null then
    raise exception 'Give a reason for the transfer.' using errcode = '22023';
  end if;
  select * into a from public.approval_requests where id = v_req;
  select * into s from public.approval_steps where id = p_step;
  perform app.approval_senior_user(v_req, p_employee);
  select full_name into v_to from public.employees where id = p_employee;
  if exists (select 1 from public.approval_steps st where st.request_id = v_req and st.round = a.round
             and st.approver_type <> 'role' and st.approver_employee_id = p_employee and st.status in ('pending', 'locked', 'approved')) then
    raise exception '% is already an approver on this request.', v_to using errcode = '22023';
  end if;

  -- Whoever hands it on can still read it.
  insert into public.approval_viewers (request_id, user_id) values (v_req, auth.uid()) on conflict do nothing;
  update public.approval_steps set
    approver_type = 'employee', approver_employee_id = p_employee, approver_role_id = null,
    name = coalesce((select ap.title from public.approval_approvers ap where ap.employee_id = p_employee), 'Approver'),
    activated_at = now()
  where id = p_step;
  update public.approval_requests set chosen_approvers = array_replace(chosen_approvers, s.approver_employee_id, p_employee)
   where id = v_req and chosen_approvers is not null;
  perform app.approval_refresh(v_req);
  perform app.approval_log(v_req, 'transferred', v_reason, p_step, a.status, a.status, s.name,
                           jsonb_build_object('from', v_from, 'to', v_to));
  perform app.notify(a.requested_by, 'approval.transferred', a.request_no || ' was transferred',
    v_from || ' transferred “' || a.title || '” to ' || v_to || ': ' || v_reason, v_req);
  perform app.notify_step(p_step);
end;
$$;

create or replace function public.approval_ask_suggestion(p_step uuid, p_employee uuid, p_question text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_req uuid := app.approval_lock_my_turn(p_step);
  v_question text := nullif(btrim(coalesce(p_question, '')), '');
  a public.approval_requests;
  v_user uuid;
  v_to text;
  v_me text := app.user_name(auth.uid());
  v_id uuid;
begin
  if v_question is null then
    raise exception 'Write what you want to ask.' using errcode = '22023';
  end if;
  select * into a from public.approval_requests where id = v_req;
  v_user := app.approval_senior_user(v_req, p_employee);
  select full_name into v_to from public.employees where id = p_employee;
  if exists (select 1 from public.approval_consults c where c.request_id = v_req and c.asked_user = v_user and c.replied_at is null) then
    raise exception '% has not replied yet.', v_to using errcode = '22023';
  end if;
  insert into public.approval_viewers (request_id, user_id) values (v_req, v_user) on conflict do nothing;
  insert into public.approval_consults (request_id, step_id, asked_by, asked_by_name, asked_user, asked_name, question)
  values (v_req, p_step, auth.uid(), v_me, v_user, v_to, v_question)
  returning id into v_id;
  perform app.approval_log(v_req, 'suggestion_asked', v_question, p_step, null, null, null, jsonb_build_object('to', v_to));
  perform app.notify(v_user, 'approval.suggestion', v_me || ' asks for your suggestion on ' || a.request_no,
    '“' || a.title || '”: ' || left(v_question, 200), v_req);
  return v_id;
end;
$$;

create or replace function public.approval_reply_suggestion(p_consult uuid, p_reply text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  c public.approval_consults;
  a public.approval_requests;
  v_me text := app.user_name(auth.uid());
  u uuid;
  s record;
begin
  perform app.approval_assert_user();
  select * into c from public.approval_consults where id = p_consult for update;
  if c.id is null or c.asked_user <> auth.uid() then
    raise exception 'Suggestion request not found.' using errcode = 'P0002';
  end if;
  if c.replied_at is not null then
    raise exception 'You have already replied.' using errcode = '22023';
  end if;
  if v_reply is null then
    raise exception 'Write your suggestion.' using errcode = '22023';
  end if;
  select * into a from public.approval_requests where id = c.request_id;
  if a.status not in ('submitted', 'pending', 'in_review') then
    raise exception 'This request is already %.', replace(a.status, '_', ' ') using errcode = '22023';
  end if;
  update public.approval_consults set reply = v_reply, replied_at = now() where id = c.id;
  perform app.approval_log(c.request_id, 'suggestion_given', v_reply, c.step_id, null, null, null, jsonb_build_object('to', c.asked_by_name));
  -- The person who asked, and whoever is approving now if it has moved on.
  perform app.notify(c.asked_by, 'approval.suggestion_reply', v_me || ' replied on ' || a.request_no, left(v_reply, 200), c.request_id);
  for s in select id from public.approval_steps where request_id = c.request_id and round = a.round and status = 'pending' loop
    for u in select app.step_approver_users(s.id) loop
      continue when u is not distinct from c.asked_by;
      perform app.notify(u, 'approval.suggestion_reply', v_me || ' replied on ' || a.request_no, left(v_reply, 200), c.request_id);
    end loop;
  end loop;
end;
$$;

revoke all on function app.approval_lock_my_turn(uuid) from public, anon, authenticated;
revoke all on function app.approval_senior_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.approval_transfer(uuid, uuid, text) from public, anon;
revoke all on function public.approval_ask_suggestion(uuid, uuid, text) from public, anon;
revoke all on function public.approval_reply_suggestion(uuid, text) from public, anon;
grant execute on function public.approval_transfer(uuid, uuid, text) to authenticated;
grant execute on function public.approval_ask_suggestion(uuid, uuid, text) to authenticated;
grant execute on function public.approval_reply_suggestion(uuid, text) to authenticated;

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
               'acted_at', s.acted_at, 'comment', s.comment,
               'can_edit_comment', s.acted_by = v_me and s.status in ('approved', 'rejected', 'returned'))
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
      'act_step_id', v_act),
    'consults', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'asked_by_name', c.asked_by_name, 'asked_name', c.asked_name, 'question', c.question,
               'reply', c.reply, 'replied_at', c.replied_at, 'created_at', c.created_at,
               'can_reply', c.asked_user = v_me and c.replied_at is null and a.status in ('submitted', 'pending', 'in_review'))
             order by c.created_at)
      from public.approval_consults c where c.request_id = a.id), '[]'::jsonb));
end;
$$;

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
       or (a.status <> 'draft' and (v_admin or app.approval_sees_all() or exists (select 1 from public.approval_steps s
                                                         where s.request_id = a.id and app.user_is_step_approver(v_me, s.id))
                                                         or exists (select 1 from public.approval_viewers v where v.request_id = a.id and v.user_id = v_me)))
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
           (b.status in ('submitted', 'pending', 'in_review') and exists (
             select 1 from public.approval_consults c where c.request_id = b.id and c.asked_user = v_me and c.replied_at is null)) as asked_me,
           (select count(*) from public.approval_documents doc where doc.request_id = b.id and doc.deleted_at is null) as attachments
    from base b
    left join public.profiles pr on pr.id = b.requested_by
    left join public.departments d on d.id = b.department_id
    left join public.approval_steps cs on cs.id = b.cur_step
  ),
  filtered as (
    select * from enriched e
    where (case v_tab when 'my_approvals' then e.my_turn or e.asked_me when 'my_requests' then e.mine else true end)
      and (case when v_tab = 'trash' then e.deleted_at is not null else e.deleted_at is null end)
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
               'current_approver', s.cur_approver, 'my_turn', s.my_turn, 'asked_me', s.asked_me, 'mine', s.mine,
               'attachments', s.attachments, 'created_at', s.created_at, 'updated_at', s.updated_at,
               'deleted_at', s.deleted_at, 'deleted_by', app.user_name(s.deleted_by), 'delete_reason', s.delete_reason)
             order by s.rn)
      from sorted s where s.rn > (v_page - 1) * v_size and s.rn <= v_page * v_size), '[]'::jsonb),
    'counts', (select jsonb_build_object(
        'total', count(*) filter (where status <> 'draft' or mine),
        'pending', count(*) filter (where status in ('submitted', 'pending', 'in_review')),
        'my_approvals', count(*) filter (where my_turn or asked_me),
        'my_requests', count(*) filter (where mine),
        'approved', count(*) filter (where status in ('approved', 'completed')),
        'rejected', count(*) filter (where status = 'rejected'),
        'returned', count(*) filter (where status = 'returned'),
        'urgent', count(*) filter (where priority = 'urgent' and status in ('submitted', 'pending', 'in_review', 'returned')))
      from enriched where deleted_at is null)
      || jsonb_build_object('trash', (select count(*) from enriched where deleted_at is not null)),
    'options', jsonb_build_object(
      'requesters', coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.requested_by, 'name', e.requester)) from enriched e), '[]'::jsonb),
      'approvers', coalesce((select jsonb_agg(distinct jsonb_build_object('id', e.cur_approver_employee, 'name', e.cur_approver))
                             from enriched e where e.cur_approver_employee is not null), '[]'::jsonb),
      'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
                               from public.departments d where d.status = 'active'), '[]'::jsonb))));
  return v_result;
end;
$$;
