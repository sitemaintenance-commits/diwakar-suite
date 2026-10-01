-- =====================================================================
-- SITE TECHNICIANS DO NOT KEEP THE DAILY WORK SHEET
--
-- Technicians fill the plant forms (Daily Entry, Non-Tech Activities,
-- tickets), not the daily task log. So:
--   * the Technician role no longer opens Daily Work, Work History or the
--     Performance Score;
--   * nobody with the Technician role also holds the Employee role (it was
--     given to everyone when logins were handed out);
--   * the score sheet and Work History count only people who keep the daily
--     sheet: an employee whose login cannot file it is neither scored nor
--     listed as "not filed". Employees without a login still count -- HR
--     files for them.
-- =====================================================================

delete from public.role_permissions rp
using public.roles r, public.modules m
where rp.role_id = r.id and rp.module_id = m.id
  and r.key = 'technician' and m.key in ('hr.worklog', 'hr.history', 'hr.scorecard');

delete from public.user_roles ur
using public.roles e
where ur.role_id = e.id and e.key = 'employee'
  and exists (select 1 from public.user_roles t join public.roles tr on tr.id = t.role_id
              where t.user_id = ur.user_id and tr.key = 'technician');

/** Whether an employee keeps the daily work sheet: no login yet, or a login that may file it. */
create or replace function app.files_daily_sheet(p_employee uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles p where p.employee_id = p_employee)
      or exists (select 1 from public.profiles p
                 join public.user_roles ur on ur.user_id = p.id
                 join public.role_permissions rp on rp.role_id = ur.role_id and rp.action = 'create'
                 join public.modules m on m.id = rp.module_id and m.key = 'hr.worklog'
                 where p.employee_id = p_employee);
$$;

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
    select e.id, e.full_name, e.employee_code, e.department_id, e.joining_date,
           d.name as department, g.name as designation
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.designations g on g.id = e.designation_id
    where e.deleted_at is null and e.status = 'active'
      and (p_department_id is null or e.department_id = p_department_id)
      and (v_all or e.id = v_me or e.id = any (v_team))
      -- Only people who keep the daily sheet are scored or listed as not reporting.
      and app.files_daily_sheet(e.id)
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
  workday as (
    -- The working days: the days the company reported on (as above).
    select distinct l.log_date as d
    from public.work_logs l
    where l.deleted_at is null and l.status <> 'draft' and l.log_date between v_from and v_to
  ),
  att as (
    -- Every working day since joining counts. A day nobody marked and no
    -- Daily Work was filed for is an absence. Approved leave, holidays and
    -- week-offs leave the ratio alone, exactly as a payroll sheet does.
    select v.id as employee_id,
           count(*) filter (where a.status is null or a.status in ('present','absent','half_day')) as expected,
           count(*) filter (where a.status = 'present') as present,
           count(*) filter (where a.status = 'half_day') as half
    from visible v
    join workday w on w.d >= coalesce(v.joining_date, w.d)
    left join public.attendance a
      on a.employee_id = v.id and a.att_date = w.d and a.deleted_at is null
    group by v.id
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
           case when coalesce(a.expected, 0) > 0
                then least(100, round(100.0 * (a.present + 0.5 * a.half) / a.expected, 0))
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


-- The attendance form starts someone who did not file on a working day as
-- absent; that holds only for people who keep the daily sheet.
create or replace function public.daily_sheet_filers()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.employees e
  where e.deleted_at is null and e.status = 'active' and app.files_daily_sheet(e.id)
    and app.has_perm('hr.attendance', 'view');
$$;
grant execute on function public.daily_sheet_filers() to authenticated;
revoke execute on function public.daily_sheet_filers() from anon, public;
