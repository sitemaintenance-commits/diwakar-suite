-- Work History gets an "All time" period: asked from before 2001,
-- get_work_history starts at the employee's first sheet or joining date
-- (whichever is earlier), and it takes up to ten years instead of one.

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
  select joining_date into v_joined from public.employees where id = v_emp;
  -- "All time" asks from before 2001: start where their history does -- the
  -- first sheet or the joining date, whichever is earlier; failing both, the
  -- company's first sheet.
  if v_from < date '2001-01-01' then
    v_from := coalesce(
      least(v_joined, (select min(l.log_date) from public.work_logs l where l.employee_id = v_emp and l.deleted_at is null)),
      (select min(l.log_date) from public.work_logs l where l.deleted_at is null),
      v_to);
  end if;
  if v_to - v_from > 3660 then
    raise exception 'Choose up to ten years at a time.' using errcode = '22023';
  end if;

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


