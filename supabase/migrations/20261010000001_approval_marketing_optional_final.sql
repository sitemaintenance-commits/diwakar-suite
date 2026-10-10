-- =====================================================================
-- APPROVALS: ACCOUNTS LAST IS A CHOICE; MARKETING & SOCIAL MEDIA
--
--   * The Accounts head (Robin Goyal) approving last is now the requester's
--     choice (include_final), ticked to begin with for purchases, payments,
--     reimbursements and procurement. He still sees every request.
--   * A new request type, Marketing & social media (marketing), always ends
--     with its own approver -- Deepanshu Bansal (setting
--     approval_marketing_approver) -- instead of the Accounts head.
--   * A marketing request carries the post's text (post_content) next to the
--     post PDF it attaches, so the approvers approve both together; it cannot
--     be submitted without the text.
-- =====================================================================

alter table public.approval_requests
  add column if not exists include_final boolean not null default true,
  add column if not exists post_content  text;

alter table public.approval_requests drop constraint if exists approval_requests_category_check;
alter table public.approval_requests add constraint approval_requests_category_check check (category in
  ('purchase','payment','reimbursement','travel','leave','procurement','project','maintenance','marketing','other',
   'advance','equipment'));   -- the last two: requests raised before the multi-level upgrade

-- The marketing approver: Deepanshu Bansal.
insert into public.app_settings (key, value)
select 'approval_marketing_approver', to_jsonb(e.id::text)
from public.employees e where e.full_name = 'Deepanshu Bansal' and e.deleted_at is null
order by e.created_at limit 1
on conflict (key) do nothing;

/** The last approver of every Marketing & social media request. */
create or replace function app.approval_marketing_employee()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select e.id from public.employees e
  where e.id = (select nullif(value #>> '{}', '')::uuid from public.app_settings where key = 'approval_marketing_approver')
    and e.deleted_at is null;
$$;

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
  if v_cat not in ('purchase','payment','reimbursement','travel','leave','procurement','project','maintenance','marketing','other') then
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
    update public.approval_requests
       set post_content = case when v_cat = 'marketing' then v_post end,
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
  if v_cat is not null and v_cat not in ('purchase','payment','reimbursement','travel','leave','procurement','project','maintenance','marketing','other') then
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
                           where e.id is distinct from app.my_employee_id()
                             and e.id is distinct from app.approval_final_employee()), '[]'::jsonb),
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
