-- =====================================================================
-- ADD A FORGOTTEN APPROVER AFTER SUBMISSION
--
-- The requester (or an approvals admin) can add an approver to a request
-- that is already in approval -- even when an earlier level has approved,
-- or the whole request has been approved but not yet marked completed.
--
--   * The new level goes before the final approver (Accounts / Marketing)
--     when that level has not decided yet; otherwise at the end.
--   * Levels already decided never move or change.
--   * If the new level is now the next one to decide, it becomes Pending
--     (the level it displaces waits again) and the approver is told; an
--     approved request goes back to In Review.
--   * The timeline records who added whom.
-- =====================================================================

create or replace function public.approval_add_level(p_request uuid, p_employee uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_pos int;
  v_final uuid;
  v_step uuid;
  v_first uuid;
  v_name text;
  v_title text;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_request for update;
  if a.id is null or not app.can_see_approval(p_request) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if a.requested_by is distinct from auth.uid() and not app.is_approval_admin() then
    raise exception 'Only the requester or an admin can add an approver.' using errcode = '42501';
  end if;
  if a.status not in ('submitted', 'pending', 'in_review', 'approved') then
    raise exception 'Approvers can be added while the request is in approval (it is %).', replace(a.status, '_', ' ') using errcode = '22023';
  end if;
  select full_name into v_name from public.employees where id = p_employee and deleted_at is null and status = 'active';
  if v_name is null then
    raise exception 'Choose an active employee.' using errcode = '22023';
  end if;
  if p_employee = (select employee_id from public.profiles where id = a.requested_by) then
    raise exception 'The requester cannot approve their own request.' using errcode = '22023';
  end if;
  if exists (select 1 from public.approval_steps where request_id = p_request and round = a.round
             and approver_type <> 'role' and approver_employee_id = p_employee and status in ('pending', 'locked')) then
    raise exception '% is already waiting to approve this request.', v_name using errcode = '22023';
  end if;

  -- Before the final approver if that level has not decided; else at the end.
  v_final := case when a.category = 'marketing' then app.approval_marketing_employee()
                  when a.include_final then app.approval_final_employee() end;
  select level_no into v_pos from public.approval_steps
   where request_id = p_request and round = a.round and status in ('pending', 'locked')
     and approver_type = 'employee' and approver_employee_id = v_final
   order by level_no desc limit 1;
  if v_pos is null then
    select coalesce(max(level_no), 0) + 1 into v_pos from public.approval_steps where request_id = p_request and round = a.round;
  end if;

  -- Make room (only undecided levels sit at or after v_pos).
  update public.approval_steps set level_no = level_no + 1000
   where request_id = p_request and round = a.round and level_no >= v_pos;
  update public.approval_steps set level_no = level_no - 999
   where request_id = p_request and round = a.round and level_no >= v_pos + 1000;

  v_title := coalesce((select ap.title from public.approval_approvers ap where ap.employee_id = p_employee), 'Approver');
  insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id, status)
  values (p_request, a.round, v_pos, v_title, 'employee', p_employee, 'locked')
  returning id into v_step;

  -- Whichever undecided level comes first is the one pending now.
  select id into v_first from public.approval_steps
   where request_id = p_request and round = a.round and status in ('pending', 'locked')
   order by level_no limit 1;
  update public.approval_steps set status = 'locked', activated_at = null
   where request_id = p_request and round = a.round and status = 'pending' and id <> v_first;
  update public.approval_steps set status = 'pending', activated_at = coalesce(activated_at, now())
   where id = v_first and status = 'locked';

  update public.approval_requests
     set chosen_approvers = case when chosen_approvers is null then null else array_append(chosen_approvers, p_employee) end
   where id = p_request;
  perform app.approval_refresh(p_request);
  perform app.approval_log(p_request, 'level_added', null, v_step, a.status,
                           (select status from public.approval_requests where id = p_request),
                           case when a.requested_by = auth.uid() then 'Requester' else 'Admin' end,
                           jsonb_build_object('approver', v_name, 'level', v_pos));
  if v_first = v_step then
    perform app.notify_step(v_step);
  end if;
  return v_step;
end;
$$;
revoke all on function public.approval_add_level(uuid, uuid) from public, anon;
grant execute on function public.approval_add_level(uuid, uuid) to authenticated;
