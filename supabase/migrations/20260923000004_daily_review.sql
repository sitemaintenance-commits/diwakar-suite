-- =====================================================================
-- PHASE 6 — DAILY REVIEW
--
-- Rebuilds the Daily Review CRM natively. It follows the shape the
-- existing tool uses: ONE report per department per day, each carrying
-- free-text updates plus a list of label/value metrics, with the
-- management layer adding CCM and Founder remarks on top. A company-wide
-- "headline" row per day holds the numbers the founder looks at first.
--
-- Legacy statuses ("On track" / CCM Remarks / Founder Remarks) were a
-- mix of health and review state; here they are separated:
--   health  -> on_track | needs_attention | critical   (the department)
--   status  -> draft | submitted | reviewed | returned (the workflow)
-- =====================================================================

create table public.daily_reports (
  id             uuid primary key default gen_random_uuid(),
  report_date    date not null default (now() at time zone 'Asia/Kolkata')::date,
  department_id  uuid references public.departments(id) on delete set null,
  employee_id    uuid references public.employees(id) on delete set null,
  reporter_id    uuid references public.profiles(id) on delete set null,
  site_id        uuid references public.sites(id) on delete set null,
  health         public.daily_health not null default 'on_track',
  work_completed text,
  issues         text,
  next_day_plan  text,
  remarks        text,
  status         public.daily_report_status not null default 'draft',
  submitted_at   timestamptz,
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  deleted_at     timestamptz
);
-- One report per department per day (the legacy rule).
create unique index daily_reports_dept_date_idx on public.daily_reports(department_id, report_date)
  where deleted_at is null and department_id is not null;
create index daily_reports_date_idx on public.daily_reports(report_date desc);
create index daily_reports_status_idx on public.daily_reports(status);

create table public.daily_report_items (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.daily_reports(id) on delete cascade,
  sort_order int not null default 1,
  label      text not null,
  value      text not null default '',
  created_at timestamptz not null default now()
);
create index daily_report_items_parent_idx on public.daily_report_items(report_id);

create table public.review_actions (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.daily_reports(id) on delete cascade,
  action      text not null,                     -- ccm_remark | founder_remark | reviewed | returned
  comment     text,
  reviewer_id uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index review_actions_report_idx on public.review_actions(report_id, created_at desc);

create table public.daily_headlines (
  id            uuid primary key default gen_random_uuid(),
  headline_date date not null unique,
  metrics       jsonb not null default '[]'::jsonb,   -- [{label, value}]
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select app.apply_standard_policies('daily_reports', 'daily.reports', 'site_id', array['created_by','reporter_id']);

-- Most reports have no site; keep those visible to permitted users.
drop policy std_select on public.daily_reports;
create policy std_select on public.daily_reports for select to authenticated
  using (deleted_at is null and (select app.has_perm('daily.reports', 'view'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('daily.reports', 'view')), array[created_by, reporter_id]::uuid[],
                      (select auth.uid()), (select app.my_team_ids())));
drop policy std_insert on public.daily_reports;
create policy std_insert on public.daily_reports for insert to authenticated
  with check ((select app.has_perm('daily.reports', 'create'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));
drop policy std_update on public.daily_reports;
create policy std_update on public.daily_reports for update to authenticated
  using (deleted_at is null
     and ((select app.has_perm('daily.reports', 'edit'))
          and app.in_scope((select app.perm_scope('daily.reports', 'edit')), array[created_by, reporter_id]::uuid[],
                           (select auth.uid()), (select app.my_team_ids()))
          -- management can add remarks / close reports it can see
          or (select app.has_perm('daily.review', 'approve'))))
  with check (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]));

-- Items follow their report.
alter table public.daily_report_items enable row level security;
grant select, insert, update, delete on public.daily_report_items to authenticated;
create policy items_select on public.daily_report_items for select to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id));
create policy items_insert on public.daily_report_items for insert to authenticated
  with check (exists (select 1 from public.daily_reports r where r.id = report_id)
              and ((select app.has_perm('daily.reports', 'create')) or (select app.has_perm('daily.reports', 'edit'))));
create policy items_update on public.daily_report_items for update to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id)
         and (select app.has_perm('daily.reports', 'edit'))) with check (true);
create policy items_delete on public.daily_report_items for delete to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id)
         and (select app.has_perm('daily.reports', 'edit')));

-- Review actions: readable with the report, written with daily.review.
alter table public.review_actions enable row level security;
grant select, insert on public.review_actions to authenticated;
create policy review_actions_select on public.review_actions for select to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id));
create policy review_actions_insert on public.review_actions for insert to authenticated
  with check (exists (select 1 from public.daily_reports r where r.id = report_id)
              and ((select app.has_perm('daily.review', 'create')) or (select app.has_perm('daily.review', 'approve'))));

-- Headlines: visible to anyone who may see the summary, written by reviewers.
alter table public.daily_headlines enable row level security;
grant select, insert, update on public.daily_headlines to authenticated;
create policy headlines_select on public.daily_headlines for select to authenticated
  using ((select app.has_any_perm(array['daily.summary','daily.reports','daily.review'], 'view')));
create policy headlines_insert on public.daily_headlines for insert to authenticated
  with check ((select app.has_any_perm(array['daily.review','daily.reports'], 'create'))
              or (select app.has_perm('daily.review', 'edit')));
create policy headlines_update on public.daily_headlines for update to authenticated
  using ((select app.has_any_perm(array['daily.review','daily.reports'], 'edit'))) with check (true);

create trigger touch_row before update on public.daily_headlines for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.daily_headlines
  for each row execute function app.audit_row_change('daily.review');
create trigger audit_row after insert on public.review_actions
  for each row execute function app.audit_row_change('daily.review');

-- ---------------------------------------------------------------------
-- Workflow guard: only a reviewer may mark a report reviewed / returned.
-- ---------------------------------------------------------------------
create or replace function app.guard_daily_report()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- A report can be created already submitted (the usual case from the UI).
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
    if new.status in ('reviewed', 'returned') then
      if not app.has_perm('daily.review', 'approve') and not app.has_perm('daily.reports', 'approve') then
        raise exception 'Reviewing a daily report requires the APPROVE permission.' using errcode = '42501';
      end if;
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    if new.status = 'submitted' and old.status <> 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_workflow before insert or update on public.daily_reports
  for each row execute function app.guard_daily_report();

-- ---------------------------------------------------------------------
-- Save a report and its metrics together (the legacy "metrics" rows).
-- ---------------------------------------------------------------------
create or replace function public.save_daily_report(p_report jsonb, p_items jsonb, p_id uuid default null)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if v_id is null then
    insert into public.daily_reports
      (report_date, department_id, site_id, reporter_id, health, work_completed, issues, next_day_plan, remarks, status)
    values (
      coalesce(nullif(p_report->>'report_date', '')::date, (now() at time zone 'Asia/Kolkata')::date),
      nullif(p_report->>'department_id', '')::uuid,
      nullif(p_report->>'site_id', '')::uuid,
      coalesce(nullif(p_report->>'reporter_id', '')::uuid, auth.uid()),
      coalesce(nullif(p_report->>'health', '')::public.daily_health, 'on_track'),
      p_report->>'work_completed', p_report->>'issues', p_report->>'next_day_plan', p_report->>'remarks',
      coalesce(nullif(p_report->>'status', '')::public.daily_report_status, 'draft'))
    returning id into v_id;
  else
    update public.daily_reports
       set report_date    = coalesce(nullif(p_report->>'report_date', '')::date, report_date),
           department_id  = nullif(p_report->>'department_id', '')::uuid,
           site_id        = nullif(p_report->>'site_id', '')::uuid,
           health         = coalesce(nullif(p_report->>'health', '')::public.daily_health, health),
           work_completed = p_report->>'work_completed',
           issues         = p_report->>'issues',
           next_day_plan  = p_report->>'next_day_plan',
           remarks        = p_report->>'remarks',
           status         = coalesce(nullif(p_report->>'status', '')::public.daily_report_status, status)
     where id = v_id;
    if not found then
      raise exception 'Report not found or not permitted.' using errcode = '42501';
    end if;
  end if;

  delete from public.daily_report_items where report_id = v_id;
  insert into public.daily_report_items (report_id, sort_order, label, value)
  select v_id, row_number() over (), i.label, coalesce(i.value, '')
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) i(label text, value text)
  where coalesce(trim(i.label), '') <> '';

  return v_id;
end;
$$;
grant execute on function public.save_daily_report(jsonb, jsonb, uuid) to authenticated;
revoke execute on function public.save_daily_report(jsonb, jsonb, uuid) from anon, public;

-- ---------------------------------------------------------------------
-- The day's picture: every department, its report for the date and for
-- the day before — the comparison the existing tool shows.
-- ---------------------------------------------------------------------
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
        'departments', coalesce((select count(*) from public.departments where status = 'active'), 0),
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
                    'reporter', (select p.full_name from public.profiles p where p.id = r.reporter_id),
                    'metrics', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'value', i.value) order by i.sort_order)
                                         from public.daily_report_items i where i.report_id = r.id), '[]'::jsonb),
                    'reviews', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'comment', a.comment,
                                                                            'at', a.created_at,
                                                                            'by', (select p2.full_name from public.profiles p2 where p2.id = a.reviewer_id))
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
      from public.departments d where d.status = 'active'), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_daily_review(date, date) to authenticated;
revoke execute on function public.get_daily_review(date, date) from anon, public;

-- Month view: one row per date with how many departments reported.
create or replace function public.get_daily_month(p_month date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Kolkata')::date))::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', d.report_date, 'reported', d.reported, 'critical', d.critical,
      'needs_attention', d.needs_attention, 'issues', d.issues) order by d.report_date desc)
    from (
      select report_date,
             count(*) filter (where status <> 'draft') as reported,
             count(*) filter (where health = 'critical') as critical,
             count(*) filter (where health = 'needs_attention') as needs_attention,
             count(*) filter (where coalesce(trim(issues), '') <> '') as issues
      from public.daily_reports
      where report_date >= v_month and report_date < (v_month + interval '1 month')::date
      group by report_date) d), '[]'::jsonb);
end;
$$;
grant execute on function public.get_daily_month(date) to authenticated;
revoke execute on function public.get_daily_month(date) from anon, public;

-- ---------------------------------------------------------------------
-- Enable the Daily Review modules
-- ---------------------------------------------------------------------
update public.modules set is_enabled = true where key in ('daily.reports', 'daily.summary', 'daily.review');

-- Every working role should be able to file its own daily report.
do $$
declare v_reports uuid := (select id from public.modules where key = 'daily.reports');
begin
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_reports, a, 'own'
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key in ('technician', 'sales_executive', 'project_manager', 'om_manager', 'hr_admin')
  on conflict do nothing;
end $$;

grant usage, select on all sequences in schema public to authenticated;
