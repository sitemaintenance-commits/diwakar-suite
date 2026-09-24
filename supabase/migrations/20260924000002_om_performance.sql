-- =====================================================================
-- O&M TEAM PERFORMANCE
--
-- Replaces the "Performance" tab of the O&M CRM, where a Google Form and
-- a sheet produced a daily technician score out of 100:
--
--   Attendance      20  | present and on duty at the assigned site
--   Daily Work      25  | the assigned site work actually completed
--   Task Assigned   10  | a task was assigned and accepted / completed
--   Form Submit     25  | the daily form submitted properly and on time
--   ---------------------------------------------------------------
--   Auto            80  | derived from what the suite already records
--   Monthly Review  20  | entered at month end by the reviewers
--
-- In the suite the first 80 are not typed by anyone: they come from the
-- site register, the task log and the daily field entry the technician
-- already files here. The last 20 stay a human judgement and need the
-- APPROVE permission on this module.
--
-- The weights live in om_score_criteria, so they can be re-balanced
-- without a release.
-- =====================================================================

create table public.om_score_criteria (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  description text,
  max_score   int not null check (max_score >= 0),
  is_auto     boolean not null default true,
  sort_order  int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.om_score_criteria (key, label, description, max_score, is_auto, sort_order) values
  ('attendance',     'Attendance',     'Daily presence and duty availability at the assigned solar site', 20, true,  1),
  ('daily_work',     'Daily Work',     'Completion and quality of all assigned site work tasks',          25, true,  2),
  ('task_assigned',  'Task Assigned',  'Score based on whether a task was assigned and completed',        10, true,  3),
  ('form_submit',    'Form Submit',    'Daily work form submitted properly and on time',                  25, true,  4),
  ('monthly_review', 'Monthly Review', 'Entered at month end by the O&M reviewers',                       20, false, 5);

create table public.om_tech_scores (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites(id) on delete cascade,
  score_date      date not null,
  member_id       uuid references public.om_team_members(id) on delete set null,
  technician_id   uuid references public.profiles(id) on delete set null,
  technician_name text not null,
  attendance      int not null default 0 check (attendance between 0 and 20),
  daily_work      int not null default 0 check (daily_work between 0 and 25),
  task_assigned   int not null default 0 check (task_assigned between 0 and 10),
  task_status     text,                         -- Completed / Pending / Not Applicable
  form_submit     int not null default 0 check (form_submit between 0 and 25),
  monthly_review  int check (monthly_review between 0 and 20),
  remarks         text,
  source          text not null default 'auto', -- auto | manual
  auto_score      int generated always as (attendance + daily_work + task_assigned + form_submit) stored,
  total_score     int generated always as
                    (attendance + daily_work + task_assigned + form_submit + coalesce(monthly_review, 0)) stored,
  subject_key     text generated always as
                    (coalesce(member_id::text, technician_id::text, lower(technician_name))) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz
);
create unique index om_tech_scores_key_idx on public.om_tech_scores(site_id, score_date, subject_key)
  where deleted_at is null;
create index om_tech_scores_date_idx on public.om_tech_scores(score_date desc);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select app.apply_standard_policies('om_tech_scores', 'om.performance', 'site_id',
                                   array['created_by','technician_id']);

alter table public.om_score_criteria enable row level security;
grant select, insert, update on public.om_score_criteria to authenticated;
create policy criteria_select on public.om_score_criteria for select to authenticated
  using ((select app.has_perm('om.performance', 'view')));
create policy criteria_update on public.om_score_criteria for update to authenticated
  using ((select app.has_perm('om.performance', 'approve'))) with check (true);
create policy criteria_insert on public.om_score_criteria for insert to authenticated
  with check ((select app.has_perm('om.performance', 'approve')));
create trigger touch_row before update on public.om_score_criteria for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.om_score_criteria
  for each row execute function app.audit_row_change('om.performance');

-- ---------------------------------------------------------------------
-- The manual 20 marks are a judgement, not data entry: they need APPROVE.
-- ---------------------------------------------------------------------
create or replace function app.guard_tech_score()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.monthly_review is distinct from (case when tg_op = 'INSERT' then null else old.monthly_review end)
     and new.monthly_review is not null
     and not app.has_perm('om.performance', 'approve') then
    raise exception 'The monthly review marks can only be set by a reviewer (APPROVE permission).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_monthly_review before insert or update on public.om_tech_scores
  for each row execute function app.guard_tech_score();

-- =====================================================================
-- The automatic 80 marks, derived from what the technician already filed.
-- =====================================================================
create or replace function app.sync_tech_score(p_log_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.om_site_logs;
  v_name text;
  v_task text;
  v_form boolean;
  v_work int;
begin
  select * into l from public.om_site_logs where id = p_log_id;
  if l.id is null or l.deleted_at is not null or l.status = 'draft' then
    return;
  end if;

  v_name := coalesce(
    nullif(trim(coalesce(l.technician_name, '')), ''),
    (select m.full_name from public.om_team_members m where m.id = l.member_id),
    (select p.full_name from public.profiles p where p.id = l.technician_id),
    'Unnamed technician');

  -- Task assigned: a task for this person at this site, due that day.
  select t.status::text into v_task
  from public.tasks t
  where t.deleted_at is null and t.site_id = l.site_id and t.due_date = l.log_date
    and t.assigned_to is not null and t.assigned_to = l.technician_id
  order by case t.status when 'done' then 0 else 1 end
  limit 1;

  -- Form submitted: the daily field entry for this site and day.
  select exists (select 1 from public.generation_records g
                 where g.site_id = l.site_id and g.gen_date = l.log_date and g.deleted_at is null)
    into v_form;

  v_work := round(25 * least(greatest(l.readiness, 0), 100) / 100.0);

  insert into public.om_tech_scores
    (site_id, score_date, member_id, technician_id, technician_name,
     attendance, daily_work, task_assigned, task_status, form_submit, source, created_by)
  values (l.site_id, l.log_date, l.member_id, l.technician_id, v_name,
          20, v_work,
          case when v_task = 'done' then 10 else 0 end,
          case when v_task is null then 'Not Applicable'
               when v_task = 'done' then 'Completed'
               else initcap(replace(v_task, '_', ' ')) end,
          case when v_form then 25 else 0 end,
          'auto', l.created_by)
  on conflict (site_id, score_date, subject_key) where deleted_at is null do update
    set attendance = excluded.attendance,
        daily_work = excluded.daily_work,
        task_assigned = excluded.task_assigned,
        task_status = excluded.task_status,
        form_submit = excluded.form_submit,
        member_id = coalesce(excluded.member_id, public.om_tech_scores.member_id),
        technician_name = excluded.technician_name;
end;
$$;

create or replace function app.on_site_log_scored()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.sync_tech_score(new.id);
  return null;
end;
$$;

create trigger score_on_submit after insert or update on public.om_site_logs
  for each row execute function app.on_site_log_scored();

-- The field entry and the task log feed the same score, so a register
-- filed before the form still ends the day at 80.
create or replace function app.on_generation_scored()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select id from public.om_site_logs
              where site_id = new.site_id and log_date = new.gen_date and deleted_at is null
  loop
    perform app.sync_tech_score(v_id);
  end loop;
  return null;
end;
$$;

create trigger score_on_generation after insert or update on public.generation_records
  for each row execute function app.on_generation_scored();

-- =====================================================================
-- RPCs
-- =====================================================================

-- Month-end review marks, and any correction the O&M head needs to make.
create or replace function public.save_tech_score(
  p_id uuid,
  p_monthly_review int default null,
  p_remarks text default null)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_total int;
begin
  update public.om_tech_scores
     set monthly_review = coalesce(p_monthly_review, monthly_review),
         remarks = coalesce(nullif(trim(coalesce(p_remarks, '')), ''), remarks),
         source = case when p_monthly_review is not null then 'manual' else source end,
         updated_by = auth.uid()
   where id = p_id and deleted_at is null
  returning total_score into v_total;

  if v_total is null then
    raise exception 'That score row was not found, or you may not change it.' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_id, 'total_score', v_total);
end;
$$;

create or replace function public.get_team_performance(
  p_from date default null,
  p_to date default null,
  p_site_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, v_to - 6);
  v_sites uuid[] := app.my_site_ids();
  v_rows jsonb;
  -- SECURITY DEFINER bypasses RLS, so a technician holding VIEW with the
  -- "own" scope must see their own card and nobody else's.
  v_scope public.perm_scope := app.perm_scope('om.performance', 'view');
  v_me uuid := auth.uid();
  v_team uuid[] := app.my_team_ids();
begin
  if not app.has_perm('om.performance', 'view') then
    raise exception 'Access denied: om.performance VIEW permission required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'id', t.id, 'score_date', t.score_date, 'site', s.name, 'site_id', t.site_id,
             'technician', t.technician_name,
             'attendance', t.attendance, 'daily_work', t.daily_work,
             'task_assigned', t.task_assigned, 'task_status', coalesce(t.task_status, '—'),
             'form_submit', t.form_submit, 'auto_score', t.auto_score,
             'monthly_review', t.monthly_review, 'total_score', t.total_score,
             'band', case when t.total_score >= 70 then 'Good'
                          when t.total_score >= 55 then 'Average' else 'Critical' end,
             'remarks', t.remarks, 'source', t.source) x
    from public.om_tech_scores t
    join public.sites s on s.id = t.site_id
    where t.deleted_at is null and t.score_date between v_from and v_to
      and t.site_id = any (v_sites) and (p_site_id is null or t.site_id = p_site_id)
      and app.in_scope(v_scope, array[t.created_by, t.technician_id]::uuid[], v_me, v_team)
    order by t.score_date desc, s.name, t.technician_name
    limit 600) q;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'criteria', coalesce((select jsonb_agg(jsonb_build_object(
                            'key', c.key, 'label', c.label, 'description', c.description,
                            'max_score', c.max_score, 'is_auto', c.is_auto) order by c.sort_order)
                          from public.om_score_criteria c), '[]'::jsonb),
    'records', v_rows,
    'record_count', jsonb_array_length(v_rows),
    'average', coalesce((select round(avg(t.total_score), 1) from public.om_tech_scores t
                         where t.deleted_at is null and t.score_date between v_from and v_to
                           and t.site_id = any (v_sites) and (p_site_id is null or t.site_id = p_site_id)
      and app.in_scope(v_scope, array[t.created_by, t.technician_id]::uuid[], v_me, v_team)), 0),
    'pending_review', (select count(*) from public.om_tech_scores t
                       where t.deleted_at is null and t.score_date between v_from and v_to
                         and t.site_id = any (v_sites) and t.monthly_review is null
                         and app.in_scope(v_scope, array[t.created_by, t.technician_id]::uuid[], v_me, v_team)),
    -- Average per technician: the ranking and the score split.
    'ranking', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'technician', t.technician_name,
                 'site', max(s.name),
                 'score', round(avg(t.total_score), 0),
                 'days', count(*)) x
        from public.om_tech_scores t join public.sites s on s.id = t.site_id
        where t.deleted_at is null and t.score_date between v_from and v_to
          and t.site_id = any (v_sites) and (p_site_id is null or t.site_id = p_site_id)
      and app.in_scope(v_scope, array[t.created_by, t.technician_id]::uuid[], v_me, v_team)
        group by t.technician_name
        order by avg(t.total_score) desc, t.technician_name
        limit 50) q), '[]'::jsonb),
    -- Average per site.
    'by_site', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object('site', s.name, 'site_id', t.site_id,
                                  'score', round(avg(t.total_score), 0),
                                  'records', count(*)) x
        from public.om_tech_scores t join public.sites s on s.id = t.site_id
        where t.deleted_at is null and t.score_date between v_from and v_to
          and t.site_id = any (v_sites) and (p_site_id is null or t.site_id = p_site_id)
      and app.in_scope(v_scope, array[t.created_by, t.technician_id]::uuid[], v_me, v_team)
        group by t.site_id, s.name
        order by avg(t.total_score) desc, s.name) q), '[]'::jsonb),
    -- Week-wise trend (Monday-based weeks).
    'weekly', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object('week_start', date_trunc('week', t.score_date)::date,
                                  'score', round(avg(t.total_score), 0),
                                  'records', count(*)) x
        from public.om_tech_scores t
        where t.deleted_at is null and t.score_date between v_from and v_to
          and t.site_id = any (v_sites) and (p_site_id is null or t.site_id = p_site_id)
      and app.in_scope(v_scope, array[t.created_by, t.technician_id]::uuid[], v_me, v_team)
        group by date_trunc('week', t.score_date)
        order by date_trunc('week', t.score_date)) q), '[]'::jsonb));
end;
$$;

-- The site contact register and team strength (the same tab's lower half).
create or replace function public.get_om_teams()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sites uuid[] := app.my_site_ids();
begin
  if not app.has_perm('om.team', 'view') then
    raise exception 'Access denied: om.team VIEW permission required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'site_count', (select count(*) from public.sites s where s.status = 'active' and s.id = any (v_sites)),
    'member_count', (select count(*) from public.om_team_members t
                     where t.deleted_at is null and t.is_active and t.site_id = any (v_sites)),
    'sites', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'site_id', s.id, 'site', s.name, 'location', coalesce(s.district, s.location),
                 'members', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', t.id, 'name', t.full_name, 'role', t.role_title,
                            'mobile', t.mobile, 'is_lead', t.is_lead, 'user_id', t.user_id)
                          order by t.is_lead desc, t.full_name)
                   from public.om_team_members t
                   where t.site_id = s.id and t.deleted_at is null and t.is_active), '[]'::jsonb),
                 'member_count', (select count(*) from public.om_team_members t
                                  where t.site_id = s.id and t.deleted_at is null and t.is_active),
                 'readiness', coalesce((select round(avg(l.readiness), 0) from public.om_site_logs l
                                        where l.site_id = s.id and l.deleted_at is null
                                          and l.status <> 'draft'
                                          and l.log_date > (now() at time zone 'Asia/Kolkata')::date - 30), 0)) x
        from public.sites s
        where s.status = 'active' and s.id = any (v_sites)
        order by s.name) q), '[]'::jsonb));
end;
$$;

grant execute on function public.save_tech_score(uuid, int, text) to authenticated;
grant execute on function public.get_team_performance(date, date, uuid) to authenticated;
grant execute on function public.get_om_teams() to authenticated;
revoke execute on function public.save_tech_score(uuid, int, text),
                        public.get_team_performance(date, date, uuid),
                        public.get_om_teams() from anon, public;

-- ---------------------------------------------------------------------
-- Module
-- ---------------------------------------------------------------------
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'om.performance', 'Team Performance',
       'Daily technician scores, rankings and the month-end review',
       '/operations/team-performance', 'TrendingUp', 80,
       '{view,create,edit,delete,export,approve}'::public.perm_action[], true, true, true, true, 4
from public.module_groups g where g.key = 'operations'
on conflict (key) do nothing;

do $$
declare
  v_perf uuid := (select id from public.modules where key = 'om.performance');
begin
  -- The O&M head and administrators, including the month-end marks.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_perf, a, 'all'
  from public.roles r, unnest(array['view','create','edit','export','approve']::public.perm_action[]) a
  where r.key in ('om_manager', 'admin')
  on conflict do nothing;

  -- Management reads and exports.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_perf, a, 'all'
  from public.roles r, unnest(array['view','export']::public.perm_action[]) a
  where r.key = 'management'
  on conflict do nothing;

  -- A technician sees their own card, nothing else.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_perf, 'view', 'own' from public.roles r where r.key = 'technician'
  on conflict do nothing;
end $$;
