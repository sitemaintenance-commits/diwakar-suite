-- =====================================================================
-- DAILY WORK: EMPLOYEES MAY CATCH UP ON THE LAST FEW DAYS
--
-- Employees filed today's sheet only (20260930000009). For now they may
-- also fill the last 8 days -- the company will tighten it later by
-- changing one setting, worklog_backfill_days (0 puts back today only).
-- HR (team or all scope) still fills or corrects any past day.
-- =====================================================================
insert into public.app_settings (key, value)
values ('worklog_backfill_days', to_jsonb(8))
on conflict (key) do nothing;

/** How many days back an employee may file their own Daily Work sheet. */
create or replace function app.worklog_backfill_days()
returns int
language sql stable security definer
set search_path = ''
as $$
  select greatest(0, coalesce((select (value #>> '{}')::int from public.app_settings where key = 'worklog_backfill_days'), 0));
$$;

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
  -- An employee files today's sheet, or one of the last few days while the
  -- company allows catching up (setting worklog_backfill_days; 0 = today
  -- only). Anything older is HR's to fill in or correct (team or all scope).
  if p_date < (now() at time zone 'Asia/Kolkata')::date - app.worklog_backfill_days()
     and not (app.has_perm('hr.worklog', 'edit') and app.perm_scope('hr.worklog', 'edit') in ('all', 'team')) then
    if app.worklog_backfill_days() = 0 then
      raise exception 'You can file today''s sheet only. Ask HR to fill in an earlier day.' using errcode = '42501';
    end if;
    raise exception 'You can file the last % days only. Ask HR to fill in an earlier day.', app.worklog_backfill_days() using errcode = '42501';
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

