-- =====================================================================
-- APPROVALS: TRASH
--
-- A request can be moved to Trash by its requester or an approvals admin,
-- once it is not in approval (draft, returned, cancelled, rejected,
-- approved or completed; a request in approval is cancelled first). It
-- disappears from every list except the new Trash tab, and can be restored
-- from there. Nothing is ever erased: the request keeps its history.
-- =====================================================================

alter table public.approval_requests
  add column if not exists deleted_at    timestamptz,
  add column if not exists deleted_by    uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;
create index if not exists approval_requests_trash_idx on public.approval_requests(deleted_at) where deleted_at is not null;

create or replace function public.approval_trash(p_request uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_request for update;
  if a.id is null or not app.can_see_approval(p_request) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if a.requested_by is distinct from auth.uid() and not app.is_approval_admin() then
    raise exception 'Only the requester or an admin can move a request to Trash.' using errcode = '42501';
  end if;
  if a.deleted_at is not null then
    return;
  end if;
  if a.status in ('submitted', 'pending', 'in_review') then
    raise exception 'This request is still in approval. Cancel it first, then move it to Trash.' using errcode = '22023';
  end if;
  update public.approval_requests
     set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_by = auth.uid()
   where id = p_request;
  perform app.approval_log(p_request, 'trashed', nullif(btrim(coalesce(p_reason, '')), ''), null, a.status, a.status,
                           case when a.requested_by = auth.uid() then 'Requester' else 'Admin' end);
end;
$$;

create or replace function public.approval_restore(p_request uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_request for update;
  if a.id is null or not app.can_see_approval(p_request) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if a.requested_by is distinct from auth.uid() and a.deleted_by is distinct from auth.uid() and not app.is_approval_admin() then
    raise exception 'Only the requester or an admin can restore this request.' using errcode = '42501';
  end if;
  if a.deleted_at is null then
    return;
  end if;
  update public.approval_requests set deleted_at = null, deleted_by = null, delete_reason = null, updated_by = auth.uid()
   where id = p_request;
  perform app.approval_log(p_request, 'restored', null, null, a.status, a.status,
                           case when a.requested_by = auth.uid() then 'Requester' else 'Admin' end);
end;
$$;
revoke all on function public.approval_trash(uuid, text), public.approval_restore(uuid) from public, anon;
grant execute on function public.approval_trash(uuid, text), public.approval_restore(uuid) to authenticated;

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
               'current_approver', s.cur_approver, 'my_turn', s.my_turn, 'mine', s.mine,
               'attachments', s.attachments, 'created_at', s.created_at, 'updated_at', s.updated_at,
               'deleted_at', s.deleted_at, 'deleted_by', app.user_name(s.deleted_by), 'delete_reason', s.delete_reason)
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
