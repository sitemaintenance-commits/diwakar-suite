-- =====================================================================
-- A REQUEST GOES ONLY TO THE APPROVERS CHOSEN
--
-- A request sent with nobody chosen except the Accounts head (the final
-- approver) used to fall back to the default workflow -- Department Head,
-- Director, then Accounts -- so it showed three levels, one of them waiting
-- for a Director nobody is. Now:
--   * chosen approvers, then the final approver if ticked (as before);
--   * nobody chosen but the final approver ticked: the final approver alone;
--   * the default workflow only when there is neither.
-- The Accounts head can also be picked in the approver list like anyone
-- else (picked and ticked, he still approves once).
-- =====================================================================

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
  v_final uuid;
  v_level int := 0;
begin
  select * into a from public.approval_requests where id = p_request for update;
  v_round := a.round + 1;
  -- Marketing & social media ends with its own approver; anything else with
  -- the Accounts head when the requester asked for it.
  v_final := case when a.category = 'marketing' then app.approval_marketing_employee()
                  when a.include_final then app.approval_final_employee() end;
  select employee_id into v_emp from public.profiles where id = a.requested_by;

  if a.round = 0 then
    if coalesce(array_length(a.chosen_approvers, 1), 0) > 0 then
      -- The approvers the requester chose, in their order.
      foreach v_approver in array a.chosen_approvers loop
        continue when v_approver = v_final;
        v_level := v_level + 1;
        insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id)
        values (p_request, v_round, v_level,
                coalesce((select ap.title from public.approval_approvers ap where ap.employee_id = v_approver), 'Approver'),
                'employee', v_approver);
      end loop;
      update public.approval_requests set workflow_id = null, workflow_name = 'Chosen approvers' where id = p_request;
    elsif v_final is not null then
      -- Nobody chosen before the final approver: the final approver alone decides.
      update public.approval_requests set workflow_id = null, workflow_name = 'Chosen approvers' where id = p_request;
    else
      select * into w from public.approval_workflows
      where is_active and (category = a.category or category is null)
      order by (category is null), created_at limit 1;
      if w.id is not null then
        for r in select * from public.approval_workflow_levels where workflow_id = w.id order by level_no loop
          v_approver := case r.approver_type
            when 'employee' then r.approver_employee_id
            when 'department_head' then (select d.head_employee_id from public.departments d where d.id = a.department_id)
            else null end;
          continue when r.approver_type <> 'role' and v_approver is not null and v_approver = v_final;
          v_level := v_level + 1;
          insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id, approver_role_id)
          values (p_request, v_round, v_level, r.name, r.approver_type, v_approver,
                  case when r.approver_type = 'role' then r.approver_role_id end);
        end loop;
        update public.approval_requests set workflow_id = w.id, workflow_name = w.name where id = p_request;
      end if;
    end if;
    -- Every request ends with the Accounts head.
    if v_final is not null then
      v_level := v_level + 1;
      insert into public.approval_steps (request_id, round, level_no, name, approver_type, approver_employee_id)
      values (p_request, v_round, v_level,
              case when a.category = 'marketing' then 'Marketing (final)' else 'Accounts (final)' end,
              'employee', v_final);
    end if;
    if v_level = 0 then
      raise exception 'No approval workflow is set up for this type of request. Ask an admin to add one in Workflow settings.' using errcode = '22023';
    end if;
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

create or replace function public.approval_form_options()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.approval_assert_user();
  return jsonb_build_object(
    -- Whom a request can be sent to, in order; the Accounts head comes last by itself.
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'title', ap.title)
                                            order by ap.sort_order, e.full_name)
                           from public.approval_approvers ap
                           join public.employees e on e.id = ap.employee_id and e.deleted_at is null and e.status = 'active'
                           where e.id is distinct from app.my_employee_id()), '[]'::jsonb),
    'final_approver', (select jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'title', 'Accounts (final)')
                       from public.employees e where e.id = app.approval_final_employee()),
    'marketing_approver', (select jsonb_build_object('employee_id', e.id, 'name', e.full_name, 'title', 'Marketing (final)')
                           from public.employees e where e.id = app.approval_marketing_employee()),
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

revoke execute on function app.approval_start_round(uuid) from public, anon, authenticated;
