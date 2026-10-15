-- =====================================================================
-- AN APPROVER CAN FIX THE COMMENT ON THEIR OWN DECISION
--
-- Someone who approved (or rejected / returned) and forgot to write a
-- comment, or wrote the wrong one, can edit it afterwards. Only the comment
-- changes: the decision, who made it and when stay as they were. The edit
-- is a new timeline entry (the timeline itself stays append-only), it keeps
-- the previous wording, and the requester is told.
-- =====================================================================

-- A decided level stays decided; only its comment may change, and only
-- through approval_edit_step_comment (which sets app.step_comment_edit).
create or replace function app.guard_approval_step()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_comment_ok boolean := coalesce(current_setting('app.step_comment_edit', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'Approval levels cannot be deleted.' using errcode = '42501';
  end if;
  if old.status in ('approved','rejected','returned','skipped','cancelled')
     and ((new.status, new.acted_by, new.acted_at, new.approver_employee_id, new.approver_role_id)
          is distinct from (old.status, old.acted_by, old.acted_at, old.approver_employee_id, old.approver_role_id)
          or (new.comment is distinct from old.comment and not v_comment_ok)) then
    raise exception 'Level % is already %; it cannot be changed.', old.level_no, old.status using errcode = '42501';
  end if;
  return new;
end;
$$;

/** Changes the comment on a level the caller decided. Empty clears it. */
create or replace function public.approval_edit_step_comment(p_step uuid, p_comment text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.approval_steps;
  a public.approval_requests;
  v_new text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform app.approval_assert_user();
  select * into s from public.approval_steps where id = p_step;
  if s.id is null or not app.can_see_approval(s.request_id) then
    raise exception 'Level not found.' using errcode = 'P0002';
  end if;
  if s.acted_by is distinct from auth.uid() or s.status not in ('approved', 'rejected', 'returned') then
    raise exception 'Only the person who decided this level can edit its comment.' using errcode = '42501';
  end if;
  if s.status in ('rejected', 'returned') and v_new is null then
    raise exception 'A rejection or return needs a reason.' using errcode = '22023';
  end if;
  if length(coalesce(v_new, '')) > 4000 then
    raise exception 'Keep the comment under 4000 characters.' using errcode = '22023';
  end if;
  if v_new is not distinct from s.comment then
    return;
  end if;
  select * into a from public.approval_requests where id = s.request_id;

  perform set_config('app.step_comment_edit', 'on', true);
  update public.approval_steps set comment = v_new where id = s.id;
  perform set_config('app.step_comment_edit', 'off', true);

  perform app.approval_log(s.request_id, 'comment_edited', v_new, s.id, null, null, s.acted_role,
                           jsonb_build_object('previous', s.comment, 'decision', s.status));
  if a.requested_by is distinct from auth.uid() then
    perform app.notify(a.requested_by, 'approval.comment', a.request_no || ': comment updated',
                       app.user_name(auth.uid()) || ': ' || left(coalesce(v_new, '(comment removed)'), 200), s.request_id);
  end if;
end;
$$;
revoke all on function public.approval_edit_step_comment(uuid, text) from public, anon;
grant execute on function public.approval_edit_step_comment(uuid, text) to authenticated;

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
      'act_step_id', v_act));
end;
$$;

