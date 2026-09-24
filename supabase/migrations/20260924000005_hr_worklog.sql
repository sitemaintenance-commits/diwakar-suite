-- =====================================================================
-- HR / PMS — DAILY WORK LOG AND THE SCORING ENGINE
--
-- Replaces the last part of the Diwakar PMS app: the "Daily Employee
-- Working Sheet" Google Form (employee · post · department · date ·
-- ten tasks each with a status · priority · remarks) and the score sheet
-- built from it.
--
-- The legacy sheet scores 60/20/10/10. Reading its own numbers back:
--
--   r            = (completed + ½ × in progress) ÷ tasks
--   KPI %        = 60 + 40 × r          (60 is the floor for turning up)
--   Competency % = 100 × r
--   Discipline % = days reported ÷ working days
--   Final        = 60·KPI + 20·Competency + 10·Discipline + 10·Attendance
--
-- The legacy sheet had no attendance data, so it counted discipline
-- twice for the last 20. The suite does have attendance, so the fourth
-- criterion reads the attendance register and falls back to discipline
-- for an employee with no attendance marked — which reproduces the
-- legacy figure exactly until HR starts marking attendance.
--
-- Weights and the KPI floor are rows in pms_criteria, not constants.
-- =====================================================================

create type public.work_task_status as enum ('not_started','in_progress','completed','on_hold');

create table public.pms_criteria (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  description text,
  weight      int not null check (weight >= 0),
  floor_pct   int not null default 0 check (floor_pct between 0 and 100),
  sort_order  int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.pms_criteria (key, label, description, weight, floor_pct, sort_order) values
  ('kpi',        'KPI achievement', 'Work assigned against work completed, with a floor for reporting the day', 60, 60, 1),
  ('competency', 'Competency',      'The completion ratio itself, with no floor',                               20,  0, 2),
  ('discipline', 'Discipline',      'Reporting the daily work sheet on every working day',                      10,  0, 3),
  ('attendance', 'Attendance',      'Presence in the register, ignoring leave and holidays; falls back to discipline', 10, 0, 4);

-- ---------------------------------------------------------------------
-- One work sheet per employee per day, with up to ten tasks.
-- ---------------------------------------------------------------------
create table public.work_logs (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  log_date      date not null default (now() at time zone 'Asia/Kolkata')::date,
  priority      public.priority not null default 'medium',
  remarks       text,
  status        public.daily_report_status not null default 'draft',
  task_count    int not null default 0,
  completed     int not null default 0,
  in_progress   int not null default 0,
  not_started   int not null default 0,
  on_hold       int not null default 0,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  deleted_at    timestamptz
);
create unique index work_logs_key_idx on public.work_logs(employee_id, log_date) where deleted_at is null;
create index work_logs_date_idx on public.work_logs(log_date desc);

create table public.work_log_tasks (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.work_logs(id) on delete cascade,
  seq         int not null,
  description text not null,
  status      public.work_task_status not null default 'not_started',
  unique (log_id, seq)
);
create index work_log_tasks_log_idx on public.work_log_tasks(log_id);

-- ---------------------------------------------------------------------
-- RLS — the same rule the rest of HR uses: you always see your own row,
-- anything wider needs the module permission and its data scope.
-- ---------------------------------------------------------------------
alter table public.work_logs enable row level security;
grant select, insert, update on public.work_logs to authenticated;
create policy hr_select on public.work_logs for select to authenticated
  using (deleted_at is null and app.hr_row_visible('hr.worklog', 'view', employee_id));
create policy hr_insert on public.work_logs for insert to authenticated
  with check (app.hr_row_visible('hr.worklog', 'create', employee_id)
              or employee_id = (select app.my_employee_id()));
create policy hr_update on public.work_logs for update to authenticated
  using (deleted_at is null
         and (app.hr_row_visible('hr.worklog', 'edit', employee_id)
              or (employee_id = (select app.my_employee_id()) and status = 'draft')))
  with check (true);

create trigger touch_row before update on public.work_logs for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.work_logs
  for each row execute function app.audit_row_change('hr.worklog');
insert into app.managed_tables values ('work_logs', 'hr.worklog', null, array['created_by'], '{}')
  on conflict (table_name) do nothing;

alter table public.work_log_tasks enable row level security;
grant select, insert, update, delete on public.work_log_tasks to authenticated;
create policy tasks_select on public.work_log_tasks for select to authenticated
  using (exists (select 1 from public.work_logs l where l.id = log_id));
create policy tasks_write on public.work_log_tasks for insert to authenticated
  with check (exists (select 1 from public.work_logs l where l.id = log_id));
create policy tasks_update on public.work_log_tasks for update to authenticated
  using (exists (select 1 from public.work_logs l where l.id = log_id)) with check (true);
create policy tasks_delete on public.work_log_tasks for delete to authenticated
  using (exists (select 1 from public.work_logs l where l.id = log_id));

alter table public.pms_criteria enable row level security;
grant select, insert, update on public.pms_criteria to authenticated;
create policy criteria_select on public.pms_criteria for select to authenticated
  using ((select app.has_any_perm(array['hr.worklog','hr.scorecard','hr.performance'], 'view')));
create policy criteria_write on public.pms_criteria for update to authenticated
  using ((select app.has_perm('hr.scorecard', 'approve'))) with check (true);
create policy criteria_insert on public.pms_criteria for insert to authenticated
  with check ((select app.has_perm('hr.scorecard', 'approve')));
create trigger touch_row before update on public.pms_criteria for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.pms_criteria
  for each row execute function app.audit_row_change('hr.scorecard');

-- ---------------------------------------------------------------------
-- A submitted sheet is the day's record: reopening it needs APPROVE.
-- ---------------------------------------------------------------------
create or replace function app.guard_work_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status = 'submitted' and new.status = 'draft'
       and not app.has_perm('hr.worklog', 'approve') then
      raise exception 'A submitted work sheet can only be reopened by HR.' using errcode = '42501';
    end if;
    if new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_workflow before insert or update on public.work_logs
  for each row execute function app.guard_work_log();

-- =====================================================================
-- Scoring helpers
-- =====================================================================

/** The rating band the score sheet prints next to the final percentage. */
create or replace function app.pms_rating(p_score numeric)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_score is null then 'Not rated'
    when p_score >= 90 then 'Outstanding'
    when p_score >= 80 then 'Excellent'
    when p_score >= 70 then 'Very Good'
    when p_score >= 60 then 'Good'
    else 'Needs Improvement'
  end;
$$;

-- =====================================================================
-- The form: the signed-in employee's own sheet for a date.
-- SECURITY DEFINER so someone whose whole job is filing this sheet needs
-- nothing but hr.worklog.
-- =====================================================================
create or replace function public.get_my_work_log(p_date date default null, p_employee_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
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
      select jsonb_agg(jsonb_build_object('seq', t.seq, 'description', t.description, 'status', t.status)
                       order by t.seq)
      from public.work_log_tasks t where t.log_id = v_log.id), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', l.log_date, 'completed', l.completed, 'task_count', l.task_count,
               'status', l.status) order by l.log_date desc)
      from public.work_logs l
      where l.employee_id = v_emp and l.deleted_at is null
        and l.log_date between v_date - 13 and v_date), '[]'::jsonb));
end;
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

-- =====================================================================
-- The score sheet, for any period. One row per employee who either
-- filed a sheet or is expected to.
-- =====================================================================
create or replace function public.get_pms_scores(
  p_from date default null,
  p_to date default null,
  p_department_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, date_trunc('month', v_to)::date);
  v_me uuid := app.my_employee_id();
  v_all boolean := app.has_perm('hr.scorecard', 'view')
                   and app.perm_scope('hr.scorecard', 'view') = 'all';
  v_team uuid[] := app.my_team_employee_ids();
  v_kpi_floor int;
  w_kpi int; w_comp int; w_disc int; w_att int; w_total int;
  v_working int;
  v jsonb;
begin
  if not app.has_perm('hr.scorecard', 'view') then
    raise exception 'Access denied: hr.scorecard VIEW permission required.' using errcode = '42501';
  end if;

  select max(weight) filter (where key = 'kpi'),
         max(weight) filter (where key = 'competency'),
         max(weight) filter (where key = 'discipline'),
         max(weight) filter (where key = 'attendance'),
         max(floor_pct) filter (where key = 'kpi')
    into w_kpi, w_comp, w_disc, w_att, v_kpi_floor
  from public.pms_criteria;
  w_total := greatest(coalesce(w_kpi, 0) + coalesce(w_comp, 0) + coalesce(w_disc, 0) + coalesce(w_att, 0), 1);

  -- Working days = the days the company actually reported on. No holiday
  -- calendar to maintain, and it self-corrects for Sundays and festivals.
  select count(distinct l.log_date) into v_working
  from public.work_logs l
  where l.deleted_at is null and l.status <> 'draft' and l.log_date between v_from and v_to;
  v_working := greatest(coalesce(v_working, 0), 1);

  with visible as (
    select e.id, e.full_name, e.employee_code, e.department_id,
           d.name as department, g.name as designation
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
    where e.deleted_at is null and e.status = 'active'
      and (p_department_id is null or e.department_id = p_department_id)
      and (v_all or e.id = v_me or e.id = any (v_team))
  ),
  log as (
    select l.employee_id,
           count(*) as days,
           sum(l.task_count) as tasks,
           sum(l.completed) as completed,
           sum(l.in_progress) as in_progress,
           sum(l.not_started) as not_started,
           sum(l.on_hold) as on_hold
    from public.work_logs l
    where l.deleted_at is null and l.status <> 'draft'
      and l.log_date between v_from and v_to
    group by l.employee_id
  ),
  att as (
    -- Approved leave, holidays and week-offs are neither presence nor
    -- absence: they leave the ratio alone, exactly as a payroll sheet does.
    select a.employee_id,
           count(*) filter (where a.status in ('present','absent','half_day')) as marked,
           count(*) filter (where a.status = 'present') as present,
           count(*) filter (where a.status = 'half_day') as half
    from public.attendance a
    where a.deleted_at is null and a.att_date between v_from and v_to
    group by a.employee_id
  ),
  scored as (
    select v.*,
           coalesce(l.tasks, 0) as tasks,
           coalesce(l.completed, 0) as completed,
           coalesce(l.in_progress, 0) as in_progress,
           coalesce(l.not_started, 0) as not_started,
           coalesce(l.on_hold, 0) as on_hold,
           coalesce(l.days, 0) as days,
           case when coalesce(l.tasks, 0) > 0
                then (l.completed + 0.5 * l.in_progress)::numeric / l.tasks
                else 0 end as r,
           least(100, round(100.0 * coalesce(l.days, 0) / v_working, 0)) as discipline,
           case when coalesce(a.marked, 0) > 0
                then least(100, round(100.0 * (a.present + 0.5 * a.half) / a.marked, 0))
                end as attendance
    from visible v
    left join log l on l.employee_id = v.id
    left join att a on a.employee_id = v.id
  ),
  final as (
    select s.*,
           round(v_kpi_floor + (100 - v_kpi_floor) * s.r, 0) as kpi,
           round(100 * s.r, 0) as competency,
           coalesce(s.attendance, s.discipline) as attendance_pct
    from scored s
  ),
  result as (
    select f.*,
           round((w_kpi * f.kpi + w_comp * f.competency + w_disc * f.discipline
                  + w_att * f.attendance_pct)::numeric / w_total, 0) as final_score
    from final f
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'working_days', v_working,
    'weights', jsonb_build_object('kpi', w_kpi, 'competency', w_comp,
                                  'discipline', w_disc, 'attendance', w_att, 'kpi_floor', v_kpi_floor),
    'employee_count', (select count(*) from result where tasks > 0 or days > 0),
    'task_total', coalesce((select sum(tasks) from result), 0),
    'task_completed', coalesce((select sum(completed) from result), 0),
    'task_in_progress', coalesce((select sum(in_progress) from result), 0),
    'task_not_started', coalesce((select sum(not_started) from result), 0),
    'task_on_hold', coalesce((select sum(on_hold) from result), 0),
    'team_score', coalesce((select round(avg(final_score), 0) from result where tasks > 0 or days > 0), 0),
    'team_rating', app.pms_rating((select avg(final_score) from result where tasks > 0 or days > 0)),
    'rows', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'employee_id', id, 'employee_code', employee_code, 'employee', full_name,
                 'designation', designation, 'department', department,
                 'days', days, 'tasks', tasks, 'completed', completed,
                 'in_progress', in_progress, 'not_started', not_started, 'on_hold', on_hold,
                 'kpi', kpi, 'competency', competency, 'discipline', discipline,
                 'attendance', attendance_pct,
                 'attendance_source', case when attendance is null then 'discipline' else 'register' end,
                 'final', final_score, 'rating', app.pms_rating(final_score)) x
        from result
        where tasks > 0 or days > 0
        order by final_score desc, completed desc, full_name) q), '[]'::jsonb),
    'not_reporting', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', id, 'employee', full_name,
                                          'department', department) order by full_name)
      from result where tasks = 0 and days = 0), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

-- The day's sheets, as the legacy "Today data" / "Last day" tables.
create or replace function public.get_work_logs(p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_me uuid := app.my_employee_id();
  v_all boolean := app.has_perm('hr.worklog', 'view') and app.perm_scope('hr.worklog', 'view') = 'all';
  v_team uuid[] := app.my_team_employee_ids();
begin
  if not app.has_perm('hr.worklog', 'view') then
    raise exception 'Access denied: hr.worklog VIEW permission required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'date', v_date,
    'entries', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'id', l.id, 'date', l.log_date,
                 'employee_code', e.employee_code, 'employee', e.full_name,
                 'designation', g.name, 'department', d.name,
                 'priority', l.priority, 'status', l.status, 'remarks', l.remarks,
                 'task_count', l.task_count, 'completed', l.completed,
                 'score', case when l.task_count > 0
                               then round(100.0 * (l.completed + 0.5 * l.in_progress) / l.task_count, 0)
                               else 0 end,
                 'tasks', coalesce((
                   select jsonb_agg(jsonb_build_object('seq', t.seq, 'description', t.description,
                                                       'status', t.status) order by t.seq)
                   from public.work_log_tasks t where t.log_id = l.id), '[]'::jsonb)) x
        from public.work_logs l
        join public.employees e on e.id = l.employee_id
        left join public.departments d on d.id = e.department_id
        left join public.designations g on g.id = e.designation_id
        where l.deleted_at is null and l.log_date = v_date and l.status <> 'draft'
          and (v_all or l.employee_id = v_me or l.employee_id = any (v_team))
        order by e.full_name) q), '[]'::jsonb));
end;
$$;

grant execute on function public.get_my_work_log(date, uuid) to authenticated;
grant execute on function public.save_work_log(date, jsonb, public.priority, text, boolean, uuid) to authenticated;
grant execute on function public.get_pms_scores(date, date, uuid) to authenticated;
grant execute on function public.get_work_logs(date) to authenticated;
revoke execute on function public.get_my_work_log(date, uuid),
                        public.save_work_log(date, jsonb, public.priority, text, boolean, uuid),
                        public.get_pms_scores(date, date, uuid),
                        public.get_work_logs(date) from anon, public;

-- ---------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, m.key, m.label, m.description, m.route, m.icon, m.sort_order,
       m.actions::public.perm_action[], true, false, true, true, 5
from public.module_groups g,
     (values
       ('hr.worklog', 'Daily Work', 'The daily working sheet every employee files',
        '/hr/daily-work', 'ClipboardCheck', 25, '{view,create,edit,delete,export,approve}'),
       ('hr.scorecard', 'Performance Score', 'KPI, competency, discipline and attendance scoring',
        '/hr/scorecard', 'Award', 32, '{view,export,approve}')
     ) as m(key, label, description, route, icon, sort_order, actions)
where g.key = 'hr'
on conflict (key) do nothing;

do $$
declare
  v_work uuid := (select id from public.modules where key = 'hr.worklog');
  v_score uuid := (select id from public.modules where key = 'hr.scorecard');
begin
  -- Everybody files their own sheet and sees their own score. The row
  -- policies and the scorecard RPC both fall back to "your own" even
  -- without a role grant, so this is the floor, not the ceiling.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_work, a, 'own'
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key in ('technician', 'sales_executive', 'project_manager', 'om_manager')
  on conflict do nothing;

  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_score, 'view', 'own'
  from public.roles r where r.key in ('technician', 'sales_executive')
  on conflict do nothing;

  -- A manager sees their team.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_score, a, 'team'
  from public.roles r, unnest(array['view','export']::public.perm_action[]) a
  where r.key in ('project_manager', 'om_manager')
  on conflict do nothing;

  -- HR and administrators run both modules company-wide.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m, a, 'all'
  from public.roles r, unnest(array[v_work, v_score]) m,
       unnest(array['view','export','approve']::public.perm_action[]) a
  where r.key in ('hr_admin', 'admin')
  on conflict do nothing;

  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_work, a, 'all'
  from public.roles r, unnest(array['create','edit','delete']::public.perm_action[]) a
  where r.key in ('hr_admin', 'admin')
  on conflict do nothing;

  -- Management reads the score sheet for the whole company.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m, a, 'all'
  from public.roles r, unnest(array[v_work, v_score]) m,
       unnest(array['view','export']::public.perm_action[]) a
  where r.key = 'management'
  on conflict do nothing;
end $$;
