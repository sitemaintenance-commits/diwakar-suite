-- =====================================================================
-- REPLACING THE PMS SITE: EMPLOYEE LOGINS AND THE WORK HISTORY CALENDAR
--
-- diwakar-pms.netlify.app let anyone fill the daily sheet for anyone. Here
-- every employee signs in and files only their own sheet; HR and the Super
-- Admin follow everyone's history day by day.
--
--   * An "Employee" role: their own Daily Work sheet and score, their own
--     attendance and leave, the dashboard and documents. Nothing else.
--   * A login can be given to someone already on the employee list: the
--     account is linked to that record (admin_save_user takes employee_id)
--     instead of creating a second employee with a new number.
--   * employee_logins(): who has a login, who is still to be invited.
--   * An employee files today's sheet, or yesterday's if they forgot; older
--     days are HR's to fill in or correct.
--   * get_work_history(): one employee's days between two dates -- filed,
--     draft, missed, leave or holiday -- with the tasks, for the calendar.
-- =====================================================================

-- ------------------------------------------------------------ the role
insert into public.roles (key, name, description, is_system)
values ('employee', 'Employee',
        'Every staff member: files their own Daily Work sheet, sees their own score, attendance and leave.', false)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, g.action::public.perm_action, g.scope::public.perm_scope
from public.roles r
cross join (values
  ('dashboard',     'view',   'all'),
  ('documents',     'view',   'all'),
  ('documents',     'export', 'all'),
  ('hr.worklog',    'view',   'own'),
  ('hr.worklog',    'create', 'own'),
  ('hr.worklog',    'edit',   'own'),
  ('hr.scorecard',  'view',   'own'),
  ('hr.attendance', 'view',   'own'),
  ('hr.leave',      'view',   'own'),
  ('hr.leave',      'create', 'own')
) as g(module, action, scope)
join public.modules m on m.key = g.module and g.action::public.perm_action = any (m.supported_actions)
where r.key = 'employee'
on conflict (role_id, module_id, action) do nothing;

-- ------------------------------------------------------ sheets: who, when
create or replace function public.save_work_log(
  p_date date,
  p_tasks jsonb,                              -- [{seq, description, status}]
  p_priority public.priority default 'medium',
  p_remarks text default null,
  p_submit boolean default false,
  p_employee_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_emp uuid := coalesce(p_employee_id, app.my_employee_id());
  v_id uuid;
  v_status public.daily_report_status;
  v_counts record;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record. Ask HR to link it.' using errcode = '22023';
  end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot file a work sheet for a future date.' using errcode = '22023';
  end if;
  -- An employee files today's sheet, or yesterday's if they forgot; older
  -- days are HR's to fill in or correct (team or all scope, not just own).
  if p_date < (now() at time zone 'Asia/Kolkata')::date - 1
     and not (app.has_perm('hr.worklog', 'edit') and app.perm_scope('hr.worklog', 'edit') in ('all', 'team')) then
    raise exception 'You can file the sheet for today or yesterday only. Ask HR to fill in an older day.' using errcode = '42501';
  end if;
  -- Your own sheet always; anyone else's needs the module permission.
  if v_emp <> coalesce(app.my_employee_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     and not app.hr_row_visible('hr.worklog', 'edit', v_emp) then
    raise exception 'You may not file a work sheet for this employee.' using errcode = '42501';
  end if;

  select id, status into v_id, v_status from public.work_logs
  where employee_id = v_emp and log_date = p_date and deleted_at is null;

  if v_id is null then
    insert into public.work_logs (employee_id, log_date, priority, remarks, created_by)
    values (v_emp, p_date, coalesce(p_priority, 'medium'), nullif(trim(coalesce(p_remarks, '')), ''), auth.uid())
    returning id into v_id;
  else
    if v_status = 'submitted' and not app.has_perm('hr.worklog', 'approve') then
      raise exception 'This work sheet is already submitted. Ask HR to reopen it.' using errcode = '42501';
    end if;
    update public.work_logs
       set priority = coalesce(p_priority, priority),
           remarks = nullif(trim(coalesce(p_remarks, '')), ''),
           updated_by = auth.uid()
     where id = v_id;
  end if;

  -- The task list is replaced wholesale: it is one sheet, not a log.
  delete from public.work_log_tasks where log_id = v_id;
  insert into public.work_log_tasks (log_id, seq, description, status)
  select v_id, t.seq, trim(t.description),
         coalesce(nullif(t.status, '')::public.work_task_status, 'not_started')
  from jsonb_to_recordset(coalesce(p_tasks, '[]'::jsonb)) t(seq int, description text, status text)
  where nullif(trim(coalesce(t.description, '')), '') is not null;

  select count(*) as total,
         count(*) filter (where status = 'completed') as done,
         count(*) filter (where status = 'in_progress') as wip,
         count(*) filter (where status = 'not_started') as todo,
         count(*) filter (where status = 'on_hold') as hold
    into v_counts
  from public.work_log_tasks where log_id = v_id;

  if p_submit and v_counts.total = 0 then
    raise exception 'Add at least one task before submitting the sheet.' using errcode = '22023';
  end if;

  update public.work_logs
     set task_count = v_counts.total, completed = v_counts.done, in_progress = v_counts.wip,
         not_started = v_counts.todo, on_hold = v_counts.hold,
         status = case when p_submit then 'submitted'::public.daily_report_status else status end
   where id = v_id;

  return jsonb_build_object('id', v_id, 'task_count', v_counts.total, 'completed', v_counts.done,
                            'submitted', coalesce(p_submit, false));
end;
$$;


-- ------------------------------------------- logins for existing employees
create or replace function public.admin_save_user(p_user_id uuid, p_data jsonb, p_is_new boolean default false)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_emp uuid;
  v_emp_fields jsonb;
begin
  perform app.require_perm('admin.users', case when p_is_new then 'create' else 'edit' end::public.perm_action);

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  if app.is_super_admin(p_user_id) and not app.is_super_admin() and p_user_id <> auth.uid() then
    raise exception 'Only a Super Admin can modify another Super Admin.' using errcode = '42501';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p_data->>'full_name'), ''), full_name),
         phone     = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else phone end
   where id = p_user_id;

  -- Employee record (HR master) — create or update the linked one.
  v_emp_fields := p_data - array['full_name','phone','role_ids','site_ids','all_sites','employee_id'];
  if v_emp_fields <> '{}'::jsonb or v_profile.employee_id is not null or p_is_new then
    v_emp := v_profile.employee_id;
    -- Giving a login to someone already on the employee list links that
    -- record, instead of creating a second one with a new number.
    if v_emp is null and p_is_new and nullif(p_data->>'employee_id', '') is not null then
      select e.id into v_emp from public.employees e
      where e.id = (p_data->>'employee_id')::uuid and e.deleted_at is null;
      if v_emp is null then
        raise exception 'That employee record does not exist.' using errcode = 'P0002';
      end if;
      if exists (select 1 from public.profiles p where p.employee_id = v_emp and p.id <> p_user_id) then
        raise exception 'This employee already has a login.' using errcode = '23505';
      end if;
      update public.profiles set employee_id = v_emp where id = p_user_id;
    end if;
    if v_emp is null then
      insert into public.employees (employee_code, full_name, email, phone)
      values (coalesce(nullif(trim(p_data->>'employee_code'), ''),
                       'DS-' || nextval('public.employee_code_seq')::text),
              coalesce(nullif(trim(p_data->>'full_name'), ''), v_profile.full_name),
              v_profile.email, nullif(trim(p_data->>'phone'), ''))
      returning id into v_emp;
      update public.profiles set employee_id = v_emp where id = p_user_id;
    end if;

    update public.employees e
       set employee_code  = coalesce(nullif(trim(p_data->>'employee_code'), ''), e.employee_code),
           full_name      = coalesce(nullif(trim(p_data->>'full_name'), ''), e.full_name),
           email          = v_profile.email,
           phone          = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else e.phone end,
           department_id  = case when p_data ? 'department_id' then nullif(p_data->>'department_id', '')::uuid else e.department_id end,
           designation_id = case when p_data ? 'designation_id' then nullif(p_data->>'designation_id', '')::uuid else e.designation_id end,
           joining_date   = case when p_data ? 'joining_date' then nullif(p_data->>'joining_date', '')::date else e.joining_date end,
           reporting_manager_id = case when p_data ? 'reporting_manager_id'
                                       then nullif(p_data->>'reporting_manager_id', '')::uuid else e.reporting_manager_id end
     where e.id = v_emp;
  end if;

  if p_data ? 'role_ids' then
    perform public.set_user_roles(p_user_id,
      array(select jsonb_array_elements_text(p_data->'role_ids')::uuid));
  end if;
  if p_data ? 'site_ids' or p_data ? 'all_sites' then
    perform public.set_user_sites(p_user_id,
      case when p_data ? 'site_ids'
           then array(select jsonb_array_elements_text(p_data->'site_ids')::uuid)
           else array(select site_id from public.user_sites where user_id = p_user_id) end,
      case when p_data ? 'all_sites' then (p_data->>'all_sites')::boolean end);
  end if;

  if p_is_new then
    perform app.write_audit('user.create', 'admin.users', 'profiles', p_user_id::text,
      'User created: ' || coalesce(nullif(trim(p_data->>'full_name'), ''), v_profile.full_name)
      || ' <' || v_profile.email || '>');
  end if;
end;
$$;


-- ----------------------------------------------------------- logins
/** Every active employee with their login, for giving logins from the Employees page. */
create or replace function public.employee_logins()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_perm('admin.users', 'view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'employee_id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
             'email', e.email, 'phone', e.phone, 'department', d.name,
             'user_id', p.id, 'login_email', p.email, 'login_status', p.status,
             'last_sign_in_at', u.last_sign_in_at,
             'roles', coalesce((select jsonb_agg(r.name order by r.name)
                                from public.user_roles ur join public.roles r on r.id = ur.role_id
                                where ur.user_id = p.id), '[]'::jsonb))
           order by e.full_name)
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.profiles p on p.employee_id = e.id
    left join auth.users u on u.id = p.id
    where e.deleted_at is null and e.status = 'active'), '[]'::jsonb);
end;
$$;
grant execute on function public.employee_logins() to authenticated;
revoke execute on function public.employee_logins() from anon, public;

-- ------------------------------------------------- the history calendar
/**
 * One employee's days from p_from to p_to: each day is 'submitted',
 * 'draft', 'missed' (a working day -- someone filed -- with no sheet),
 * 'leave' / 'holiday' / 'week_off' from attendance, or 'none'. Submitted
 * and draft days carry the tasks. Your own history always; anyone else's
 * needs hr.worklog VIEW over them (all, or your team).
 */
create or replace function public.get_work_history(p_employee uuid default null, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_emp uuid := coalesce(p_employee, app.my_employee_id());
  v_from date := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to date := least(coalesce(p_to, v_today), v_today);
  v_joined date;
  v jsonb;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record. Ask HR to link it.' using errcode = '22023';
  end if;
  if not app.hr_row_visible('hr.worklog', 'view', v_emp) then
    raise exception 'You may not see this employee''s work history.' using errcode = '42501';
  end if;
  if v_to - v_from > 400 then
    raise exception 'Choose up to about a year at a time.' using errcode = '22023';
  end if;
  select joining_date into v_joined from public.employees where id = v_emp;

  with days as (
    select d::date as day from generate_series(v_from, greatest(v_from, v_to), interval '1 day') d
  ),
  workday as (
    select distinct l.log_date as day from public.work_logs l
    where l.deleted_at is null and l.status <> 'draft' and l.log_date between v_from and v_to
  ),
  logs as (
    select l.* from public.work_logs l
    where l.employee_id = v_emp and l.deleted_at is null and l.log_date between v_from and v_to
  ),
  att as (
    select a.att_date, a.status from public.attendance a
    where a.employee_id = v_emp and a.deleted_at is null and a.att_date between v_from and v_to
  ),
  rows as (
    select dd.day, l.id as log_id, l.status as log_status, l.priority, l.remarks,
           l.task_count, l.completed, l.in_progress, l.not_started, l.on_hold,
           a.status as att_status,
           (w.day is not null) as working,
           case
             when l.id is not null and l.status <> 'draft' then 'submitted'
             when l.id is not null then 'draft'
             when a.status in ('leave', 'holiday', 'week_off') then a.status::text
             when a.status = 'absent' then 'absent'
             when w.day is not null and (v_joined is null or dd.day >= v_joined) and dd.day < v_today then 'missed'
             else 'none'
           end as state
    from days dd
    left join logs l on l.log_date = dd.day
    left join att a on a.att_date = dd.day
    left join workday w on w.day = dd.day
  )
  select jsonb_build_object(
    'employee', (select jsonb_build_object('id', e.id, 'code', e.employee_code, 'name', e.full_name,
                                           'department', d.name, 'designation', g.name, 'joining_date', e.joining_date)
                 from public.employees e
                 left join public.departments d on d.id = e.department_id
                 left join public.designations g on g.id = e.designation_id
                 where e.id = v_emp),
    'from', v_from, 'to', v_to,
    'summary', jsonb_build_object(
      'working_days', (select count(*) from rows where working and (v_joined is null or day >= v_joined)),
      'submitted', (select count(*) from rows where state = 'submitted'),
      'drafts', (select count(*) from rows where state = 'draft'),
      'missed', (select count(*) from rows where state in ('missed', 'absent')),
      'leave', (select count(*) from rows where state in ('leave', 'holiday', 'week_off')),
      'tasks', coalesce((select sum(task_count) from rows where state = 'submitted'), 0),
      'completed', coalesce((select sum(completed) from rows where state = 'submitted'), 0),
      'in_progress', coalesce((select sum(in_progress) from rows where state = 'submitted'), 0),
      'score', (select round(100.0 * sum(completed + 0.5 * in_progress) / nullif(sum(task_count), 0), 0)
                from rows where state = 'submitted')),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', r.day, 'state', r.state, 'working', r.working, 'attendance', r.att_status,
               'priority', r.priority, 'remarks', r.remarks,
               'task_count', r.task_count, 'completed', r.completed, 'in_progress', r.in_progress,
               'score', case when r.task_count > 0
                             then round(100.0 * (r.completed + 0.5 * r.in_progress) / r.task_count, 0) end,
               'tasks', case when r.log_id is not null then coalesce((
                          select jsonb_agg(jsonb_build_object('seq', t.seq, 'description', t.description, 'status', t.status)
                                           order by t.seq)
                          from public.work_log_tasks t where t.log_id = r.log_id), '[]'::jsonb) end)
             order by r.day)
      from rows r), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
grant execute on function public.get_work_history(uuid, date, date) to authenticated;
revoke execute on function public.get_work_history(uuid, date, date) from anon, public;
