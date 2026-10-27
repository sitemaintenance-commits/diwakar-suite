-- =====================================================================
-- REQUEST TYPE "REPAIR"
-- =====================================================================

alter table public.approval_requests drop constraint if exists approval_requests_category_check;
alter table public.approval_requests add constraint approval_requests_category_check check (category in
  ('purchase','payment','reimbursement','travel','local_conveyance','leave','procurement','project','maintenance','repair','marketing','other',
   'advance','equipment'));   -- the last two: requests raised before the multi-level upgrade

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
  v_post text := nullif(btrim(coalesce(p_request->>'post_content', '')), '');
  v_mode text := nullif(p_request->>'conveyance_mode', '');
  v_final_opt boolean := nullif(p_request->>'include_final', '')::boolean;
  v_changes jsonb := '{}'::jsonb;
  v_was text;
begin
  if not app.is_active_user() or not app.has_perm('approvals', 'create') then
    raise exception 'Access denied: you cannot raise requests.' using errcode = '42501';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'Give the request a title (3 to 200 characters).' using errcode = '22023';
  end if;
  if v_cat not in ('purchase','payment','reimbursement','travel','local_conveyance','leave','procurement','project','maintenance','repair','marketing','other') then
    raise exception 'Unknown request type %.', v_cat using errcode = '22023';
  end if;
  if v_mode is not null and v_mode not in ('car', 'bike') then
    raise exception 'Choose car or bike as the mode of conveyance.' using errcode = '22023';
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
    update public.approval_requests
       set post_content = case when v_cat = 'marketing' then v_post end,
           conveyance_mode = case when v_cat = 'local_conveyance' then v_mode end,
           include_final = coalesce(v_final_opt, v_cat in ('purchase','payment','reimbursement','procurement'))
     where id = v_id;
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
      ('post_content', to_jsonb(a.post_content), to_jsonb(case when v_cat = 'marketing' then v_post end)),
      ('mode of conveyance', to_jsonb(a.conveyance_mode), to_jsonb(case when v_cat = 'local_conveyance' then v_mode end)),
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
      priority = v_pri, department_id = v_dept, site_id = v_site, project_id = v_project, updated_by = v_me,
      post_content = case when v_cat = 'marketing' then v_post end,
      conveyance_mode = case when v_cat = 'local_conveyance' then v_mode end,
      -- who approves last is fixed once the request has been submitted
      include_final = case when a.round = 0 then coalesce(v_final_opt, a.include_final) else a.include_final end
    where id = p_id;
    if v_changes <> '{}'::jsonb then
      perform app.approval_log(p_id, 'edited', nullif(p_request->>'edit_note', ''), null, a.status, a.status,
                               case when a.requested_by = v_me then 'Requester' else 'Admin' end,
                               jsonb_build_object('changes', v_changes));
    end if;
    -- The requester changed a request someone has already approved: approval starts again from Level 1.
    if v_changes <> '{}'::jsonb and a.requested_by = v_me and not p_submit
       and a.status in ('submitted', 'pending', 'in_review', 'approved')
       and exists (select 1 from public.approval_steps s where s.request_id = p_id and s.round = a.round and s.status = 'approved') then
      update public.approval_steps set status = 'cancelled'
       where request_id = p_id and round = a.round and status in ('pending', 'locked');
      perform app.approval_start_round(p_id);
      perform app.approval_log(p_id, 'resubmitted', 'Edited by the requester: approval starts again from Level 1.', null, a.status,
                               (select status from public.approval_requests where id = p_id), 'Requester');
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
    if a.category = 'marketing' and nullif(btrim(coalesce(a.post_content, '')), '') is null then
      raise exception 'Write the post content before submitting.' using errcode = '22023';
    end if;
    if a.category = 'local_conveyance' and a.conveyance_mode is null then
      raise exception 'Choose the mode of conveyance (car or bike) before submitting.' using errcode = '22023';
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
  if v_cat is not null and v_cat not in ('purchase','payment','reimbursement','travel','local_conveyance','leave','procurement','project','maintenance','repair','marketing','other') then
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
