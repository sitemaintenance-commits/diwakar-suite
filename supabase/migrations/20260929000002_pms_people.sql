-- =====================================================================
-- THE PMS PEOPLE, AND AN IMPORT THAT RECOGNISES THEM
--
-- The Diwakar PMS knows its people only by what they type into the
-- "Daily Employee Working Sheet" form. Its response sheet (461 forms,
-- 1,772 tasks, 20 Jan - 29 Sep 2026) spells 23 names 44 ways -- "Banwari",
-- "banwari", "Banwari Verma"; "Anurag Shekhawat", "Anurag shekhwat";
-- "RAMKESH DAINI" for Ramkesh Saini -- and its departments 36 ways.
-- The PMS site maps names to DRIPL employee numbers behind the scenes.
--
-- This migration brings that master across:
--
--   * the 21 employees, with their DRIPL numbers, designations and
--     departments. Not carried: "Diwakar Solar" (a test entry, 0/1
--     tasks) and "DEVANTH SINGH" (a mistyped Devnath Singh Shikhawat).
--     Shivdatt Singh has no DRIPL number yet and gets a DS- code HR can
--     change;
--   * every spelling seen in the sheet, as employee_aliases, so the
--     history lands on the right person;
--   * four departments the PMS uses that the suite did not have -- Tender,
--     Land & Legal, Marketing & Social Media, Security -- and Accounts &
--     Finance active again for HR.
--
-- Departments also define the Daily Review round ("n of 6 reported").
-- in_daily_review keeps that round exactly as it is: the new HR-only
-- departments, and Accounts & Finance, stay out of it until someone
-- decides otherwise.
--
-- The importer changes with it:
--   * a name is matched through the aliases, case- and space-insensitive;
--   * an unknown name is reported, not turned into a new employee -- with
--     a master in place, a typo must not create a person;
--   * a second form for the same person and day (6 in the sheet) adds its
--     tasks to the sheet an earlier import created, instead of being
--     skipped; re-importing adds nothing twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------
alter table public.departments
  add column if not exists in_daily_review boolean not null default true;
comment on column public.departments.in_daily_review is
  'Whether the department files a Daily Review report. HR-only departments are active but outside the round.';

-- Today's round is the active departments; keep it that.
update public.departments set in_daily_review = (status = 'active');

insert into public.departments (name, code, color, status, in_daily_review) values
  ('Tender',                   'TENDER', '#7C3AED', 'active', false),
  ('Land & Legal',             'LEGAL',  '#B45309', 'active', false),
  ('Marketing & Social Media', 'MKTG',   '#DB2777', 'active', false),
  ('Security',                 'SEC',    '#475569', 'active', false)
on conflict (name) do nothing;

update public.departments set status = 'active', in_daily_review = false, updated_at = now()
where name = 'Accounts & Finance';

-- ---------------------------------------------------------------------
-- Designations, as the PMS posts them (tidied)
-- ---------------------------------------------------------------------
insert into public.designations (name, department_id)
select v.name, d.id
from (values
  ('Data Analyst & MIS',          'O&M / Service'),
  ('O&M Senior Engineer',         'O&M / Service'),
  ('O&M Engineer',                'O&M / Service'),
  ('Site Engineer',               'O&M / Service'),
  ('Technician',                  'O&M / Service'),
  ('Account Executive',           'Accounts & Finance'),
  ('Accountant',                  'Accounts & Finance'),
  ('Procurement Executive',       'Procurement & Stores'),
  ('Tender Executive',            'Tender'),
  ('Social Media Executive',      'Marketing & Social Media'),
  ('AI & Social Media Executive', 'Admin'),
  ('Design Engineer',             'Design & Engineering'),
  ('HR Executive',                'HR'),
  ('Security Officer',            'Security'),
  ('Head - Land & Legal',         'Land & Legal'),
  ('Land Acquisition',            'Land & Legal'),
  ('EA to MD',                    'Admin'),
  ('Office Assistant',            'Admin'),
  ('Project Manager',             'Projects & Installation')
) as v(name, dept)
left join public.departments d on d.name = v.dept
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------
insert into public.employees (employee_code, full_name, department_id, designation_id, status)
select coalesce(v.code, 'DS-' || nextval('public.employee_code_seq')::text), v.name, d.id, g.id, 'active'
from (values
  ('DRIPL_1004', 'Devnath Singh Shikhawat', 'Tender',                   'Tender Executive'),
  ('DRIPL_1005', 'Raj Kumar Sharma',        'Land & Legal',             'Land Acquisition'),
  ('DRIPL_1007', 'Vinod Kumar Meena',       'Admin',                    'Office Assistant'),
  ('DRIPL_1018', 'Rahul Jangid',            'Admin',                    'EA to MD'),
  ('DRIPL_1047', 'Banshi Dhar Sharma',      'Accounts & Finance',       'Accountant'),
  ('DRIPL_1050', 'Arti Agarwal',            'Accounts & Finance',       'Account Executive'),
  ('DRIPL_1060', 'Anurag Singh Shikhawat',  'O&M / Service',            'O&M Senior Engineer'),
  ('DRIPL_1062', 'Diksha Chauhan',          'Marketing & Social Media', 'Social Media Executive'),
  ('DRIPL_1066', 'Sonu Saini',              'Accounts & Finance',       'Accountant'),
  ('DRIPL_1069', 'Ramkesh Saini',           'Projects & Installation',  'Project Manager'),
  ('DRIPL_1074', 'Aditya Kumar Gaur',       'O&M / Service',            'Data Analyst & MIS'),
  ('DRIPL_1084', 'Bhupendra Sahu',          'Procurement & Stores',     'Procurement Executive'),
  ('DRIPL_1088', 'Lokesh Narain',           'Land & Legal',             'Head - Land & Legal'),
  ('DRIPL_1089', 'Rakesh Kumar Kataria',    'O&M / Service',            'Technician'),
  ('DRIPL_1090', 'Ganesh Prajapat',         'Design & Engineering',     'Design Engineer'),
  ('DRIPL_1096', 'Shubham Sharma',          'O&M / Service',            'O&M Engineer'),
  ('DRIPL_1099', 'Keshav Agarwal',          'HR',                       'HR Executive'),
  ('DRIPL_1101', 'Banwari Verma',           'HR',                       'HR Executive'),
  ('DRIPL_1111', 'Ketan Sharma',            'Security',                 'Security Officer'),
  ('DRIPL_1112', 'Keshav Thathera',         'Admin',                    'AI & Social Media Executive'),
  (null,         'Shivdatt Singh',          'O&M / Service',            'Site Engineer')
) as v(code, name, dept, designation)
left join public.departments d on d.name = v.dept
left join public.designations g on g.name = v.designation
where not exists (select 1 from public.employees e
                  where e.deleted_at is null
                    and (e.employee_code = v.code or lower(e.full_name) = lower(v.name)));

-- ---------------------------------------------------------------------
-- Every way a name has been typed
-- ---------------------------------------------------------------------
create or replace function app.name_key(p_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')), '');
$$;

create table public.employee_aliases (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  alias        text not null,
  alias_key    text generated always as (app.name_key(alias)) stored,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create unique index employee_aliases_key_idx on public.employee_aliases(alias_key);
create index employee_aliases_employee_idx on public.employee_aliases(employee_id);
comment on table public.employee_aliases is
  'Other spellings of an employee''s name, as typed into legacy forms. Used to match imported history.';

alter table public.employee_aliases enable row level security;
grant select, insert, delete on public.employee_aliases to authenticated;
create policy ea_select on public.employee_aliases for select to authenticated
  using ((select app.has_perm('hr.employees', 'view')));
create policy ea_insert on public.employee_aliases for insert to authenticated
  with check ((select app.has_perm('hr.employees', 'edit')));
create policy ea_delete on public.employee_aliases for delete to authenticated
  using ((select app.has_perm('hr.employees', 'edit')));
create trigger audit_row after insert or delete on public.employee_aliases
  for each row execute function app.audit_row_change('hr.employees');

insert into public.employee_aliases (employee_id, alias)
select e.id, v.alias
from (values
  ('DRIPL_1004', 'DEVNATH SINGH'), ('DRIPL_1004', 'DEVANTH SINGH'), ('DRIPL_1004', 'Devnath Singh Shekhawat'),
  ('DRIPL_1005', 'Raj kumar sharma'),
  ('DRIPL_1007', 'Vinod Kumar'),
  ('DRIPL_1047', 'Banshi Sharma'),
  ('DRIPL_1050', 'Arti Agrawal'),
  ('DRIPL_1060', 'Anurag Shekhawat'), ('DRIPL_1060', 'Anurag shekhwat'), ('DRIPL_1060', 'Anurag Singh Shekhawat'),
  ('DRIPL_1069', 'RAMKESH DAINI'),
  ('DRIPL_1088', 'lOKESH naRAIN'),
  ('DRIPL_1089', 'Rakesh kataria'),
  ('DRIPL_1090', 'Ganesh prajpat'),
  ('DRIPL_1099', 'Keshav Aggarwal'),
  ('DRIPL_1101', 'Banwari')
) as v(code, alias)
join public.employees e on e.employee_code = v.code and e.deleted_at is null
on conflict (alias_key) do nothing;

/** The employee a typed name means: the full name, or a known alias. */
create or replace function app.employee_by_name(p_name text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select e.id from public.employees e
      where e.deleted_at is null and app.name_key(e.full_name) = app.name_key(p_name)
      order by e.status = 'active' desc limit 1),
    (select a.employee_id from public.employee_aliases a
       join public.employees e on e.id = a.employee_id and e.deleted_at is null
      where a.alias_key = app.name_key(p_name) limit 1));
$$;

-- ---------------------------------------------------------------------
-- The importer
-- ---------------------------------------------------------------------
alter table public.work_logs
  add column if not exists source text not null default 'form';
comment on column public.work_logs.source is
  '''form'' for sheets filed in the suite, ''legacy'' for sheets brought across from the PMS response sheet.';

create or replace function public.import_work_logs(p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_merged int := 0;
  v_skipped int := 0;
  v_ignored int := 0;
  v_unknown text[] := '{}';
  r record;
  v_emp uuid;
  v_log public.work_logs;
  v_id uuid;
  v_next int;
  v_added int;
  v_counts record;
begin
  if not app.has_perm('hr.worklog', 'create') then
    raise exception 'Access denied: hr.worklog CREATE permission required to import work sheets.'
      using errcode = '42501';
  end if;

  for r in
    select nullif(trim(x->>'employee'), '') as employee,
           nullif(x->>'date', '')::date as log_date,
           lower(coalesce(nullif(trim(x->>'priority'), ''), 'medium')) as priority,
           nullif(trim(coalesce(x->>'remarks', '')), '') as remarks,
           coalesce(x->'tasks', '[]'::jsonb) as tasks,
           ord
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(x, ord)
    order by 2, 1, ord
  loop
    continue when r.log_date is null or r.employee is null;

    v_emp := app.employee_by_name(r.employee);
    if v_emp is null then
      v_ignored := v_ignored + 1;
      if not (r.employee = any (v_unknown)) then
        v_unknown := v_unknown || r.employee;
      end if;
      continue;
    end if;

    select * into v_log from public.work_logs w
    where w.employee_id = v_emp and w.log_date = r.log_date and w.deleted_at is null;

    if v_log.id is not null then
      -- A sheet already exists. One filed in the suite is the record and is
      -- left alone; one an import made takes this form's new tasks.
      if v_log.source <> 'legacy' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      select count(*) into v_added
      from jsonb_array_elements(r.tasks) t
      where nullif(trim(coalesce(t->>'description', '')), '') is not null
        and not exists (select 1 from public.work_log_tasks k
                        where k.log_id = v_log.id
                          and lower(trim(k.description)) = lower(trim(t->>'description')));
      if v_added = 0 then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_merged := v_merged + 1;
      continue when p_dry_run;
      v_id := v_log.id;
      select coalesce(max(seq), 0) into v_next from public.work_log_tasks where log_id = v_id;
      insert into public.work_log_tasks (log_id, seq, description, status)
      select v_id, v_next + row_number() over (order by t.ord), trim(t.x->>'description'),
             app.work_status_from_text(t.x->>'status')
      from jsonb_array_elements(r.tasks) with ordinality as t(x, ord)
      where nullif(trim(coalesce(t.x->>'description', '')), '') is not null
        and not exists (select 1 from public.work_log_tasks k
                        where k.log_id = v_id
                          and lower(trim(k.description)) = lower(trim(t.x->>'description')));
      update public.work_logs
         set remarks = coalesce(remarks, r.remarks),
             priority = case when r.priority in ('low','medium','high','critical')
                              and array_position(array['low','medium','high','critical'], r.priority)
                                > array_position(array['low','medium','high','critical'], priority::text)
                             then r.priority::public.priority else priority end
       where id = v_id;
    else
      if p_dry_run then
        v_inserted := v_inserted + 1;
        continue;
      end if;
      insert into public.work_logs (employee_id, log_date, priority, remarks, status, source, submitted_at, created_by)
      values (v_emp, r.log_date,
              case when r.priority in ('low','medium','high','critical')
                   then r.priority::public.priority else 'medium' end,
              r.remarks, 'submitted', 'legacy', r.log_date::timestamptz, auth.uid())
      returning id into v_id;
      insert into public.work_log_tasks (log_id, seq, description, status)
      select v_id, row_number() over (order by t.ord), trim(t.x->>'description'),
             app.work_status_from_text(t.x->>'status')
      from jsonb_array_elements(r.tasks) with ordinality as t(x, ord)
      where nullif(trim(coalesce(t.x->>'description', '')), '') is not null;
      v_inserted := v_inserted + 1;
    end if;

    select count(*) as total,
           count(*) filter (where status = 'completed') as done,
           count(*) filter (where status = 'in_progress') as wip,
           count(*) filter (where status = 'not_started') as todo,
           count(*) filter (where status = 'on_hold') as hold
      into v_counts
    from public.work_log_tasks where log_id = v_id;
    update public.work_logs
       set task_count = v_counts.total, completed = v_counts.done, in_progress = v_counts.wip,
           not_started = v_counts.todo, on_hold = v_counts.hold
     where id = v_id;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'hr.worklog', 'work_logs', null,
      format('Imported %s work sheet(s) and added to %s from the legacy PMS', v_inserted, v_merged),
      jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'skipped', v_skipped,
                         'ignored', v_ignored, 'unknown_employees', to_jsonb(v_unknown)));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'skipped', v_skipped,
                            'ignored', v_ignored, 'employees_created', 0,
                            'unknown_employees', to_jsonb(v_unknown),
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;

create or replace function app.work_status_from_text(p_text text)
returns public.work_task_status
language sql immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_text, '')))
           when 'completed' then 'completed'
           when 'complete' then 'completed'
           when 'done' then 'completed'
           when 'in progress' then 'in_progress'
           when 'in_progress' then 'in_progress'
           when 'on hold' then 'on_hold'
           when 'on_hold' then 'on_hold'
           else 'not_started' end::public.work_task_status;
$$;

-- =====================================================================
-- The Daily Review round is the departments that file one. Each function
-- below is its latest definition with the department filter narrowed.
-- =====================================================================

-- (from 20260926000004_daily_review_legacy_shape.sql)
create or replace function public.get_daily_review(p_date date default null, p_compare date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_prev date := coalesce(p_compare, v_date - 1);
begin
  if not public.has_permission('daily.reports', 'view') and not public.has_permission('daily.summary', 'view') then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'date', v_date,
    'compare_date', v_prev,
    'headline', (select jsonb_build_object('metrics', h.metrics, 'note', h.note)
                 from public.daily_headlines h where h.headline_date = v_date),
    'totals', (
      select jsonb_build_object(
        'departments', coalesce((select count(*) from public.departments where status = 'active' and in_daily_review), 0),
        'reported',    coalesce(count(*) filter (where status <> 'draft'), 0),
        'drafts',      coalesce(count(*) filter (where status = 'draft'), 0),
        'reviewed',    coalesce(count(*) filter (where status = 'reviewed'), 0),
        'on_track',    coalesce(count(*) filter (where health = 'on_track'), 0),
        'needs_attention', coalesce(count(*) filter (where health = 'needs_attention'), 0),
        'critical',    coalesce(count(*) filter (where health = 'critical'), 0),
        'with_issues', coalesce(count(*) filter (where coalesce(trim(issues), '') <> ''), 0))
      from public.daily_reports where report_date = v_date),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'department_id', d.id,
        'name', d.name,
        'color', d.color,
        'today', (select jsonb_build_object(
                    'id', r.id, 'health', r.health, 'status', r.status,
                    'work_completed', r.work_completed, 'issues', r.issues,
                    'next_day_plan', r.next_day_plan, 'remarks', r.remarks,
                    'reporter', coalesce((select p.full_name from public.profiles p where p.id = r.reporter_id), r.reporter_name),
                    'metrics', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'value', i.value) order by i.sort_order)
                                         from public.daily_report_items i where i.report_id = r.id), '[]'::jsonb),
                    'reviews', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'comment', a.comment,
                                                                            'at', a.created_at,
                                                                            'by', coalesce((select p2.full_name from public.profiles p2 where p2.id = a.reviewer_id), a.reviewer_name))
                                                          order by a.created_at)
                                         from public.review_actions a where a.report_id = r.id), '[]'::jsonb))
                  from public.daily_reports r where r.department_id = d.id and r.report_date = v_date limit 1),
        'previous', (select jsonb_build_object(
                       'id', r.id, 'health', r.health, 'status', r.status,
                       'work_completed', r.work_completed, 'issues', r.issues,
                       'metrics', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'value', i.value) order by i.sort_order)
                                            from public.daily_report_items i where i.report_id = r.id), '[]'::jsonb))
                     from public.daily_reports r where r.department_id = d.id and r.report_date = v_prev limit 1))
        order by d.name)
      from public.departments d where d.status = 'active' and d.in_daily_review), '[]'::jsonb)
  );
end;
$$;

-- (from 20260926000005_bulk_review_remark.sql)
create or replace function public.save_review_remark(
  p_date date,
  p_comment text,
  p_department_ids uuid[] default null,
  p_action text default 'founder_remark'
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_applied int := 0;
  v_already int := 0;
  v_targets uuid[];
  v_missing text[] := '{}';
  r record;
begin
  if p_action not in ('ccm_remark', 'founder_remark', 'returned') then
    raise exception 'Unknown remark type %.', p_action using errcode = '22023';
  end if;
  if v_comment is null then
    raise exception 'A remark needs some text.' using errcode = '22023';
  end if;
  if not (app.has_perm('daily.review', 'create') or app.has_perm('daily.review', 'approve')) then
    raise exception 'Access denied: daily.review CREATE or APPROVE permission required.'
      using errcode = '42501';
  end if;

  -- No departments named means every active one, which is what the
  -- legacy "All Departments" button does.
  if p_department_ids is null or cardinality(p_department_ids) = 0 then
    select array_agg(id) into v_targets from public.departments where status = 'active' and in_daily_review;
  else
    v_targets := p_department_ids;
  end if;

  for r in
    select d.id, d.name,
           (select dr.id from public.daily_reports dr
             where dr.department_id = d.id and dr.report_date = v_date
               and dr.deleted_at is null limit 1) as report_id
    from public.departments d
    where d.id = any (v_targets)
    order by d.name
  loop
    if r.report_id is null then
      v_missing := v_missing || r.name;
      continue;
    end if;
    if exists (select 1 from public.review_actions a
                where a.report_id = r.report_id and a.action = p_action
                  and a.comment is not distinct from v_comment) then
      v_already := v_already + 1;
      continue;
    end if;
    insert into public.review_actions (report_id, action, comment, reviewer_id)
    values (r.report_id, p_action, v_comment, auth.uid());
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object(
    'date', v_date,
    'action', p_action,
    'applied', v_applied,
    'already_had_it', v_already,
    'no_report_that_day', to_jsonb(v_missing));
end;
$$;

-- (from 20260923000005_reports.sql)
create or replace function public.report_daily(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, date_trunc('month', v_to)::date);
begin
  perform app.require_report('reports.daily');
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'summary', (
      select jsonb_build_object(
        'reports', coalesce(count(*), 0),
        'submitted', coalesce(count(*) filter (where status <> 'draft'), 0),
        'reviewed', coalesce(count(*) filter (where status = 'reviewed'), 0),
        'with_issues', coalesce(count(*) filter (where coalesce(trim(issues), '') <> ''), 0),
        'critical', coalesce(count(*) filter (where health = 'critical'), 0))
      from public.daily_reports where report_date between v_from and v_to),
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object(
        'department', coalesce(d.name, 'Unassigned'),
        'reports', coalesce(r.n, 0),
        'on_track', coalesce(r.ok_n, 0),
        'needs_attention', coalesce(r.warn_n, 0),
        'critical', coalesce(r.crit_n, 0),
        'issues', coalesce(r.issue_n, 0)) order by d.name)
      from public.departments d
      left join (select department_id, count(*) n,
                        count(*) filter (where health = 'on_track') ok_n,
                        count(*) filter (where health = 'needs_attention') warn_n,
                        count(*) filter (where health = 'critical') crit_n,
                        count(*) filter (where coalesce(trim(issues), '') <> '') issue_n
                 from public.daily_reports where report_date between v_from and v_to group by department_id) r
        on r.department_id = d.id
      where d.status = 'active' and d.in_daily_review), '[]'::jsonb));
end;
$$;
