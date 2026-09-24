-- =====================================================================
-- PHASE 5 — HR / PMS
--   attendance           one row per employee per day
--   leave_requests       apply → approve / reject
--   performance_reviews  review period per employee
--   performance_goals    goals / KPIs inside a review
--   tasks                the central task log (used by every module)
--
-- Access rules differ from the business modules: everyone may see their
-- OWN attendance, leave and review without any HR permission. Seeing
-- other people's HR data needs the module permission, and the data scope
-- decides whether that means the whole company or just your reports.
-- Salary and identity data stay in employee_private (Phase 1), behind a
-- separate permission.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  att_date    date not null,
  status      public.attendance_status not null default 'present',
  check_in    timestamptz,
  check_out   timestamptz,
  work_hours  numeric(5,2),
  site_id     uuid references public.sites(id) on delete set null,
  remarks     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  deleted_at  timestamptz,
  unique (employee_id, att_date)
);
create index attendance_date_idx on public.attendance(att_date desc);
create index attendance_employee_idx on public.attendance(employee_id, att_date desc);

-- ---------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------
create table public.leave_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  leave_type   text not null default 'casual',       -- casual / sick / earned / unpaid / comp-off
  from_date    date not null,
  to_date      date not null,
  days         numeric(4,1) not null default 1 check (days > 0),
  reason       text,
  status       public.leave_status not null default 'pending',
  approved_by  uuid references public.profiles(id) on delete set null,
  approved_at  timestamptz,
  decision_note text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid,
  deleted_at   timestamptz,
  check (to_date >= from_date)
);
create index leave_employee_idx on public.leave_requests(employee_id, from_date desc);
create index leave_status_idx on public.leave_requests(status, from_date desc);

-- ---------------------------------------------------------------------
-- Performance
-- ---------------------------------------------------------------------
create table public.performance_reviews (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  period_label      text not null,                   -- "FY 2026-27 H1"
  period_start      date,
  period_end        date,
  reviewer_id       uuid references public.profiles(id) on delete set null,
  overall_rating    numeric(3,1) check (overall_rating is null or (overall_rating >= 0 and overall_rating <= 5)),
  manager_comments  text,
  employee_comments text,
  status            public.review_status not null default 'draft',
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid,
  deleted_at        timestamptz
);
create index reviews_employee_idx on public.performance_reviews(employee_id);
create index reviews_status_idx on public.performance_reviews(status);

create table public.performance_goals (
  id             uuid primary key default gen_random_uuid(),
  review_id      uuid not null references public.performance_reviews(id) on delete cascade,
  sort_order     int not null default 1,
  title          text not null,
  kpi            text,
  target         text,
  actual         text,
  weight         numeric(5,2) not null default 0,
  self_rating    numeric(3,1) check (self_rating is null or (self_rating >= 0 and self_rating <= 5)),
  manager_rating numeric(3,1) check (manager_rating is null or (manager_rating >= 0 and manager_rating <= 5)),
  comments       text,
  created_at     timestamptz not null default now()
);
create index goals_review_idx on public.performance_goals(review_id);

-- ---------------------------------------------------------------------
-- Central task log — any module can point at it
-- ---------------------------------------------------------------------
create sequence public.task_code_seq start 1;

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  task_code    text not null unique default ('TSK-' || lpad(nextval('public.task_code_seq')::text, 5, '0')),
  title        text not null,
  description  text,
  module       public.task_module not null default 'general',
  assigned_to  uuid references public.profiles(id) on delete set null,
  due_date     date,
  priority     public.priority not null default 'medium',
  status       public.task_status not null default 'todo',
  site_id      uuid references public.sites(id) on delete set null,
  tender_id    uuid references public.tenders(id) on delete set null,
  lead_id      uuid references public.leads(id) on delete set null,
  ticket_id    uuid references public.maintenance_tickets(id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index tasks_assigned_idx on public.tasks(assigned_to, status);
create index tasks_due_idx on public.tasks(due_date) where deleted_at is null;
create index tasks_module_idx on public.tasks(module);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- Tasks behave like a normal business module.
select app.apply_standard_policies('tasks', 'tasks', 'site_id', array['created_by','assigned_to'], array['assigned_to']);

-- Tasks are often company-wide (no site); keep NULL sites visible.
drop policy std_select on public.tasks;
create policy std_select on public.tasks for select to authenticated
  using (deleted_at is null and (select app.has_perm('tasks', 'view'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('tasks', 'view')), array[created_by, assigned_to]::uuid[],
                      (select auth.uid()), (select app.my_team_ids())));
drop policy std_insert on public.tasks;
create policy std_insert on public.tasks for insert to authenticated
  with check ((select app.has_perm('tasks', 'create'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));
drop policy std_update on public.tasks;
create policy std_update on public.tasks for update to authenticated
  using (deleted_at is null and (select app.has_perm('tasks', 'edit'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('tasks', 'edit')), array[created_by, assigned_to]::uuid[],
                      (select auth.uid()), (select app.my_team_ids())))
  with check (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]));

-- HR tables: "mine" is always visible; other people's rows follow the
-- module permission and its data scope.
create or replace function app.hr_row_visible(p_module text, p_action public.perm_action, p_employee uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when not app.is_active_user() then false
    when p_employee = app.my_employee_id() and p_action = 'view' then true
    when not app.has_perm(p_module, p_action) then false
    when app.perm_scope(p_module, p_action) = 'all' then true
    when app.perm_scope(p_module, p_action) = 'team' then p_employee = any (app.my_team_employee_ids())
    else p_employee = app.my_employee_id()
  end;
$$;
grant execute on function app.hr_row_visible(text, public.perm_action, uuid) to authenticated;

do $$
declare r record;
begin
  for r in select * from (values
      ('attendance', 'hr.attendance'),
      ('leave_requests', 'hr.leave'),
      ('performance_reviews', 'hr.performance')) as v(tbl, module)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('grant select, insert, update on public.%I to authenticated', r.tbl);
    execute format($f$create policy hr_select on public.%I for select to authenticated
                      using (deleted_at is null and app.hr_row_visible(%L, 'view', employee_id))$f$, r.tbl, r.module);
    execute format($f$create policy hr_insert on public.%I for insert to authenticated
                      with check (app.hr_row_visible(%L, 'create', employee_id))$f$, r.tbl, r.module);
    execute format($f$create policy hr_update on public.%I for update to authenticated
                      using (deleted_at is null and app.hr_row_visible(%L, 'edit', employee_id)) with check (true)$f$, r.tbl, r.module);
    execute format('create trigger touch_row before update on public.%I for each row execute function app.touch_row()', r.tbl);
    execute format('create trigger audit_row after insert or update or delete on public.%I
                    for each row execute function app.audit_row_change(%L)', r.tbl, r.module);
    execute format('insert into app.managed_tables values (%L, %L, null, array[''created_by''], ''{}'')
                    on conflict (table_name) do nothing', r.tbl, r.module);
  end loop;
end $$;

-- Self-service: employees may apply for their own leave and withdraw it
-- while it is still pending, and may add their own comments to their own
-- review. What they may CHANGE is then narrowed by the guard triggers
-- below (they cannot approve their own leave or rate themselves).
create policy leave_self_insert on public.leave_requests for insert to authenticated
  with check (employee_id = (select app.my_employee_id()) and status = 'pending');
create policy leave_self_update on public.leave_requests for update to authenticated
  using (deleted_at is null and employee_id = (select app.my_employee_id()) and status = 'pending')
  with check (employee_id = (select app.my_employee_id()));
create policy review_self_update on public.performance_reviews for update to authenticated
  using (deleted_at is null and employee_id = (select app.my_employee_id()))
  with check (employee_id = (select app.my_employee_id()));

-- Goals follow their review.
alter table public.performance_goals enable row level security;
grant select, insert, update, delete on public.performance_goals to authenticated;
create policy goals_select on public.performance_goals for select to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id));
create policy goals_write on public.performance_goals for insert to authenticated
  with check (exists (select 1 from public.performance_reviews r where r.id = review_id));
create policy goals_update on public.performance_goals for update to authenticated
  using (exists (select 1 from public.performance_reviews r where r.id = review_id)) with check (true);
create policy goals_delete on public.performance_goals for delete to authenticated
  using ((select app.has_perm('hr.performance', 'edit'))
     and exists (select 1 from public.performance_reviews r where r.id = review_id));

-- ---------------------------------------------------------------------
-- Guards: approving leave and completing a review need APPROVE.
-- ---------------------------------------------------------------------
create or replace function app.guard_leave_decision()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if not app.has_perm('hr.leave', 'approve') then
      raise exception 'Approving or rejecting leave requires the APPROVE permission.' using errcode = '42501';
    end if;
    if new.employee_id = app.my_employee_id() and not app.is_super_admin() then
      raise exception 'You cannot approve your own leave.' using errcode = '42501';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end;
$$;
create trigger guard_decision before update on public.leave_requests
  for each row execute function app.guard_leave_decision();

create or replace function app.guard_review_completion()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    if not app.has_perm('hr.performance', 'approve') then
      raise exception 'Completing a performance review requires the APPROVE permission.' using errcode = '42501';
    end if;
    new.completed_at := now();
  end if;
  -- The employee may only write their own comments once the review is shared.
  if new.employee_id = app.my_employee_id() and not app.has_perm('hr.performance', 'edit')
     and (new.overall_rating is distinct from old.overall_rating
          or new.manager_comments is distinct from old.manager_comments
          or new.status is distinct from old.status) then
    raise exception 'You can only add your own comments to your review.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_completion before update on public.performance_reviews
  for each row execute function app.guard_review_completion();

-- Mark tasks complete with a timestamp.
create or replace function app.guard_task_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
create trigger guard_status before update on public.tasks
  for each row execute function app.guard_task_status();

-- ---------------------------------------------------------------------
-- Bulk attendance for one day (marking a whole team at once)
-- ---------------------------------------------------------------------
create or replace function public.save_attendance(p_rows jsonb)
returns int
language plpgsql security invoker
set search_path = ''
as $$
declare v_count int := 0;
begin
  with rows as (
    select (r->>'employee_id')::uuid as employee_id,
           (r->>'att_date')::date as att_date,
           (r->>'status')::public.attendance_status as status,
           nullif(r->>'site_id', '')::uuid as site_id,
           nullif(r->>'remarks', '') as remarks
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  ), ins as (
    insert into public.attendance (employee_id, att_date, status, site_id, remarks)
    select employee_id, att_date, status, site_id, remarks from rows
    on conflict (employee_id, att_date) do update
      set status = excluded.status, site_id = excluded.site_id, remarks = excluded.remarks
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;
grant execute on function public.save_attendance(jsonb) to authenticated;
revoke execute on function public.save_attendance(jsonb) from anon, public;

-- ---------------------------------------------------------------------
-- HR summary for the dashboard and the HR pages
-- ---------------------------------------------------------------------
create or replace function public.get_hr_summary(p_date date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
begin
  return jsonb_build_object(
    'date', v_date,
    'employees', coalesce((select count(*) from public.employees where status = 'active' and deleted_at is null), 0),
    'present',   coalesce((select count(*) from public.attendance where att_date = v_date and status = 'present'), 0),
    'absent',    coalesce((select count(*) from public.attendance where att_date = v_date and status = 'absent'), 0),
    'on_leave',  coalesce((select count(*) from public.attendance where att_date = v_date and status = 'leave'), 0),
    'marked',    coalesce((select count(*) from public.attendance where att_date = v_date), 0),
    'leave_pending', coalesce((select count(*) from public.leave_requests where status = 'pending'), 0),
    'reviews_open',  coalesce((select count(*) from public.performance_reviews where status <> 'completed'), 0),
    'tasks_open',    coalesce((select count(*) from public.tasks where status in ('todo','in_progress','blocked')), 0),
    'tasks_overdue', coalesce((select count(*) from public.tasks where status in ('todo','in_progress','blocked') and due_date < v_date), 0)
  );
end;
$$;
grant execute on function public.get_hr_summary(date) to authenticated;
revoke execute on function public.get_hr_summary(date) from anon, public;

-- ---------------------------------------------------------------------
-- Enable the HR modules
-- ---------------------------------------------------------------------
update public.modules set is_enabled = true
where key in ('hr.employees', 'hr.employees_private', 'hr.attendance', 'hr.performance', 'hr.leave', 'tasks');

-- Everyone should be able to see and work their own tasks, and every role
-- that already has a dashboard gets the basic HR self-service implicitly
-- through the "own record" rules above.
do $$
declare v_tasks uuid := (select id from public.modules where key = 'tasks');
begin
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_tasks, a, 'own'
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key in ('technician', 'sales_executive')
  on conflict do nothing;
end $$;

grant usage, select on all sequences in schema public to authenticated;
