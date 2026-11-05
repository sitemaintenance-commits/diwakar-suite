-- =====================================================================
-- DAILY WORK: FINISH A PENDING TASK LATER
--
-- A submitted sheet stays locked, but a task on it that was not started,
-- in progress or on hold can be marked completed afterwards -- by the
-- employee on their own sheet, or by HR. The day's counts are worked out
-- again, so the day score and the Performance Score go up. Only forward:
-- a completed task is not turned back. The day it was finished is kept
-- (completed_on), and it is allowed for sheets of the last 30 days
-- (setting worklog_complete_days).
-- =====================================================================

alter table public.work_log_tasks add column if not exists completed_on date;

insert into public.app_settings (key, value)
values ('worklog_complete_days', to_jsonb(30))
on conflict (key) do nothing;

create or replace function app.worklog_complete_days()
returns int
language sql stable security definer
set search_path = ''
as $$
  select greatest(0, coalesce((select (value #>> '{}')::int from public.app_settings where key = 'worklog_complete_days'), 30));
$$;

/** Recount a sheet's tasks into its summary columns (what the scores read). */
create or replace function app.worklog_recount(p_log uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.work_logs l
     set task_count = c.total, completed = c.done, in_progress = c.wip,
         not_started = c.todo, on_hold = c.hold, updated_at = now()
    from (select count(*) total,
                 count(*) filter (where status = 'completed') done,
                 count(*) filter (where status = 'in_progress') wip,
                 count(*) filter (where status = 'not_started') todo,
                 count(*) filter (where status = 'on_hold') hold
            from public.work_log_tasks where log_id = p_log) c
   where l.id = p_log;
$$;

create or replace function public.complete_work_task(p_task_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  t public.work_log_tasks;
  l public.work_logs;
begin
  select * into t from public.work_log_tasks where id = p_task_id;
  if t.id is not null then
    select * into l from public.work_logs where id = t.log_id and deleted_at is null;
  end if;
  if l.id is null then
    raise exception 'That task was not found.' using errcode = 'P0002';
  end if;
  if not app.is_active_user() or (
       l.employee_id <> coalesce(app.my_employee_id(), '00000000-0000-0000-0000-000000000000'::uuid)
       and not app.hr_row_visible('hr.worklog', 'edit', l.employee_id)) then
    raise exception 'You may not change this work sheet.' using errcode = '42501';
  end if;
  if t.status = 'completed' then
    raise exception 'This task is already completed.' using errcode = '22023';
  end if;
  if l.log_date < v_today - app.worklog_complete_days()
     and not (app.has_perm('hr.worklog', 'edit') and app.perm_scope('hr.worklog', 'edit') in ('all', 'team')) then
    raise exception 'Tasks of the last % days can be completed. Ask HR for an earlier day.', app.worklog_complete_days()
      using errcode = '42501';
  end if;

  update public.work_log_tasks set status = 'completed', completed_on = v_today where id = t.id;
  perform app.worklog_recount(l.id);
  select * into l from public.work_logs where id = l.id;
  return jsonb_build_object('log_id', l.id, 'date', l.log_date, 'task_count', l.task_count, 'completed', l.completed,
    'score', case when l.task_count > 0 then round(100 * (l.completed + 0.5 * l.in_progress)::numeric / l.task_count) else 0 end);
end;
$$;
revoke all on function public.complete_work_task(uuid) from public, anon;
grant execute on function public.complete_work_task(uuid) to authenticated;

-- The sheet now carries each task's id and when a late one was finished,
-- and the pending tasks of earlier locked sheets that can still be completed.
create or replace function public.get_my_work_log(p_date date default null, p_employee_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date := coalesce(p_date, v_today);
  v_emp uuid := coalesce(p_employee_id, app.my_employee_id());
  v_log public.work_logs;
begin
  if not app.hr_row_visible('hr.worklog', 'view', v_emp) then
    raise exception 'Access denied: you may not read this work sheet.' using errcode = '42501';
  end if;

  select * into v_log from public.work_logs
  where employee_id = v_emp and log_date = v_date and deleted_at is null;

  return jsonb_build_object(
    'date', v_date,
    'employee', (select jsonb_build_object(
                   'id', e.id, 'name', e.full_name, 'code', e.employee_code,
                   'department', d.name, 'designation', g.name)
                 from public.employees e
                 left join public.departments d on d.id = e.department_id
                 left join public.designations g on g.id = e.designation_id
                 where e.id = v_emp),
    'log', case when v_log.id is null then null else jsonb_build_object(
             'id', v_log.id, 'status', v_log.status, 'priority', v_log.priority,
             'remarks', v_log.remarks, 'submitted_at', v_log.submitted_at,
             'task_count', v_log.task_count, 'completed', v_log.completed) end,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'seq', t.seq, 'description', t.description,
                                          'status', t.status, 'completed_on', t.completed_on)
                       order by t.seq)
      from public.work_log_tasks t where t.log_id = v_log.id), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', l.log_date, 'completed', l.completed, 'task_count', l.task_count,
               'status', l.status) order by l.log_date desc)
      from public.work_logs l
      where l.employee_id = v_emp and l.deleted_at is null
        and l.log_date between v_date - 13 and v_date), '[]'::jsonb),
    -- Sheets that can no longer be edited (submitted, or too old to file):
    -- their unfinished tasks, newest day first.
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'date', l.log_date, 'seq', t.seq,
                                          'description', t.description, 'status', t.status)
                       order by l.log_date desc, t.seq)
      from public.work_logs l
      join public.work_log_tasks t on t.log_id = l.id
      where l.employee_id = v_emp and l.deleted_at is null and t.status <> 'completed'
        and l.log_date >= v_today - app.worklog_complete_days()
        and (l.status <> 'draft' or l.log_date < v_today - app.worklog_backfill_days())), '[]'::jsonb),
    'complete_days', app.worklog_complete_days());
end;
$$;
