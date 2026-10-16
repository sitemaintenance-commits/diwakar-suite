-- =====================================================================
-- LOCAL CONVEYANCE: MODE OF CONVEYANCE
--
-- A local conveyance request says how the trip was made: car or bike.
-- Required before the request is submitted; shown to the approvers.
-- =====================================================================

alter table public.approval_requests
  add column if not exists conveyance_mode text check (conveyance_mode in ('car', 'bike'));

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
  if v_cat not in ('purchase','payment','reimbursement','travel','local_conveyance','leave','procurement','project','maintenance','marketing','other') then
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
