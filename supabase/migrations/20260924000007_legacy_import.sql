-- =====================================================================
-- LEGACY DATA IMPORT
--
-- The four legacy apps keep their history in Google Sheets, mirrored
-- into the browser. Each importer below takes that mirror as JSON and
-- writes it into the suite.
--
-- Three rules hold for all of them:
--   * they check the caller's permission first — an import is a bulk
--     CREATE, so it needs CREATE on the target module;
--   * they are idempotent. A row that already exists is left exactly as
--     it is and counted as skipped, so running an import twice cannot
--     duplicate history or overwrite a correction someone has made;
--   * every run is written to the audit log with its counts.
-- =====================================================================

/**
 * The O&M sheet writes grid outage as free text: "No", or one or more
 * windows like "08:33 - 10:00" on separate lines, sometimes labelled
 * ("Grid Failure :-", "Plant Trip :-") and sometimes typed with an en
 * dash. Turn all of that into hours; a window that ends before it starts
 * is a typo and contributes nothing rather than a negative.
 */
create or replace function app.parse_outage_hours(p_text text)
returns numeric
language sql immutable
set search_path = ''
as $$
  select coalesce((
    select round(sum(greatest(
             (m[3]::int * 60 + m[4]::int) - (m[1]::int * 60 + m[2]::int), 0))::numeric / 60, 2)
    from regexp_matches(coalesce(p_text, ''),
                        '(\d{1,2}):(\d{2})\s*[-‐-―]\s*(\d{1,2}):(\d{2})', 'g') m
  ), 0);
$$;

-- ---------------------------------------------------------------------
-- 1. O&M generation history
--
-- Accepts the shape the O&M CRM keeps in the browser:
--   { "reports": { "2026-01-01": [ { short, site, generation,
--                                    insolation, outage, remarks } ] } }
-- or a flat array of { date, site, generation, insolation, outage, remarks }.
-- ---------------------------------------------------------------------
create or replace function public.import_om_generation(p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_skipped int := 0;
  v_ignored int := 0;
  v_unknown text[] := '{}';
  v_sites uuid[] := app.my_site_ids();
  v_from date;
  v_to date;
  r record;
  v_site_id uuid;
  v_expected numeric;
begin
  if not app.has_perm('om.generation', 'create') then
    raise exception 'Access denied: om.generation CREATE permission required to import readings.'
      using errcode = '42501';
  end if;

  create temporary table if not exists _imp_gen (
    gen_date date, site_name text, generation numeric, insolation numeric,
    outage numeric, remarks text
  ) on commit drop;
  delete from _imp_gen;

  if jsonb_typeof(p_payload) = 'array' then
    insert into _imp_gen
    select nullif(x->>'date', '')::date,
           coalesce(nullif(x->>'short', ''), x->>'site'),
           nullif(x->>'generation', '')::numeric,
           nullif(nullif(x->>'insolation', '')::numeric, 0),
           app.parse_outage_hours(x->>'outage'),
           nullif(trim(coalesce(x->>'remarks', '')), '')
    from jsonb_array_elements(p_payload) x;
  else
    insert into _imp_gen
    select d.key::date,
           coalesce(nullif(x->>'short', ''), x->>'site'),
           nullif(x->>'generation', '')::numeric,
           nullif(nullif(x->>'insolation', '')::numeric, 0),
           app.parse_outage_hours(x->>'outage'),
           nullif(trim(coalesce(x->>'remarks', '')), '')
    from jsonb_each(coalesce(p_payload->'reports', '{}'::jsonb)) d,
         jsonb_array_elements(d.value) x;
  end if;

  -- Nothing to do for a site with no reading that day.
  delete from _imp_gen where generation is null or generation <= 0 or gen_date is null;

  select min(gen_date), max(gen_date) into v_from, v_to from _imp_gen;

  for r in select * from _imp_gen order by gen_date, site_name loop
    select s.id into v_site_id
    from public.sites s
    where lower(s.name) = lower(r.site_name)
       or lower(split_part(r.site_name, ' - ', 1)) = lower(s.name)
    limit 1;

    if v_site_id is null then
      v_ignored := v_ignored + 1;
      if not (r.site_name = any (v_unknown)) then
        v_unknown := v_unknown || r.site_name;
      end if;
      continue;
    end if;

    -- Site access is enforced here because this function runs as definer.
    if not (v_site_id = any (v_sites)) then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    if exists (select 1 from public.generation_records g
               where g.site_id = v_site_id and g.gen_date = r.gen_date and g.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_dry_run then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    select round(ss.capacity_dc_kwp * ss.expected_yield, 3) into v_expected
    from public.solar_sites ss where ss.site_id = v_site_id;

    insert into public.generation_records
      (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
       grid_outage_hrs, plant_outage_hrs, remarks, source, created_by)
    values (v_site_id, r.gen_date, r.generation, v_expected, r.insolation,
            coalesce(r.outage, 0), 0, r.remarks, 'legacy', auth.uid());
    v_inserted := v_inserted + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'om.generation', 'generation_records', null,
      format('Imported %s O&M reading(s) from the legacy dashboard', v_inserted),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                         'ignored', v_ignored, 'from', v_from, 'to', v_to));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'unknown_sites', to_jsonb(v_unknown), 'from', v_from, 'to', v_to,
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Daily Review history
--
-- Accepts { depts: [{id, name, head}], reports: [{deptId, date, status,
-- reporter, metrics: [{label, value}], highlights, blockers, remarks}] }.
-- ---------------------------------------------------------------------
create or replace function public.import_daily_reports(p_payload jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_skipped int := 0;
  v_ignored int := 0;
  v_unknown text[] := '{}';
  r record;
  v_dept uuid;
  v_dept_name text;
  v_id uuid;
  v_health public.daily_health;
begin
  if not app.has_perm('daily.reports', 'create') then
    raise exception 'Access denied: daily.reports CREATE permission required to import reports.'
      using errcode = '42501';
  end if;

  for r in
    select nullif(x->>'date', '')::date as report_date,
           x->>'deptId' as dept_id,
           x->>'status' as status,
           x->>'reporter' as reporter,
           x->>'highlights' as highlights,
           x->>'blockers' as blockers,
           x->>'remarks' as remarks,
           x->'metrics' as metrics
    from jsonb_array_elements(coalesce(p_payload->'reports', '[]'::jsonb)) x
    order by 1
  loop
    continue when r.report_date is null;

    -- The payload names its own departments; match them to ours by name.
    select d->>'name' into v_dept_name
    from jsonb_array_elements(coalesce(p_payload->'depts', '[]'::jsonb)) d
    where d->>'id' = r.dept_id limit 1;

    select id into v_dept from public.departments
    where lower(name) = lower(coalesce(v_dept_name, ''))
    limit 1;

    if v_dept is null then
      v_ignored := v_ignored + 1;
      if not (coalesce(v_dept_name, r.dept_id) = any (v_unknown)) then
        v_unknown := v_unknown || coalesce(v_dept_name, r.dept_id);
      end if;
      continue;
    end if;

    if exists (select 1 from public.daily_reports dr
               where dr.department_id = v_dept and dr.report_date = r.report_date
                 and dr.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_dry_run then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    v_health := case
      when r.status ilike '%critical%' then 'critical'
      when r.status ilike '%attention%' or r.status ilike '%delay%' or r.status ilike '%risk%' then 'needs_attention'
      else 'on_track' end::public.daily_health;

    insert into public.daily_reports
      (report_date, department_id, health, work_completed, issues, remarks, status, created_by)
    values (r.report_date, v_dept, v_health,
            nullif(trim(coalesce(r.highlights, '')), ''),
            nullif(trim(coalesce(r.blockers, '')), ''),
            nullif(trim(coalesce(r.remarks, '')), ''),
            'reviewed', auth.uid())
    returning id into v_id;

    insert into public.daily_report_items (report_id, sort_order, label, value)
    select v_id, ord, m->>'label', coalesce(m->>'value', '')
    from jsonb_array_elements(coalesce(r.metrics, '[]'::jsonb)) with ordinality as t(m, ord)
    where nullif(trim(coalesce(m->>'label', '')), '') is not null;

    v_inserted := v_inserted + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'daily.reports', 'daily_reports', null,
      format('Imported %s daily report(s) from the legacy Daily Review CRM', v_inserted),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'unknown_departments', to_jsonb(v_unknown),
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;

-- ---------------------------------------------------------------------
-- 3. PMS daily working sheets
--
-- Accepts [{ employee, post, department, date, priority, remarks,
--            tasks: [{description, status}] }] — the Google Form's own
-- response rows, parsed into JSON by the import page.
--
-- Employees who are not on the master are created when the caller may
-- create them, so a year of history does not arrive attached to nobody.
-- ---------------------------------------------------------------------
create or replace function public.import_work_logs(p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inserted int := 0;
  v_skipped int := 0;
  v_ignored int := 0;
  v_created int := 0;
  v_unknown text[] := '{}';
  v_may_create_emp boolean := app.has_perm('hr.employees', 'create');
  r record;
  v_emp uuid;
  v_dept uuid;
  v_id uuid;
  v_counts record;
begin
  if not app.has_perm('hr.worklog', 'create') then
    raise exception 'Access denied: hr.worklog CREATE permission required to import work sheets.'
      using errcode = '42501';
  end if;

  for r in
    select nullif(trim(x->>'employee'), '') as employee,
           nullif(trim(x->>'post'), '') as post,
           nullif(trim(x->>'department'), '') as department,
           nullif(x->>'date', '')::date as log_date,
           lower(coalesce(nullif(trim(x->>'priority'), ''), 'medium')) as priority,
           nullif(trim(coalesce(x->>'remarks', '')), '') as remarks,
           x->'tasks' as tasks
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    order by 4, 1
  loop
    continue when r.log_date is null or r.employee is null;

    select id into v_emp from public.employees
    where deleted_at is null and lower(full_name) = lower(r.employee)
    limit 1;

    if v_emp is null then
      if not v_may_create_emp or p_dry_run then
        v_ignored := v_ignored + 1;
        if not (r.employee = any (v_unknown)) then
          v_unknown := v_unknown || r.employee;
        end if;
        continue;
      end if;
      select id into v_dept from public.departments where lower(name) = lower(coalesce(r.department, '')) limit 1;
      insert into public.employees (full_name, department_id, status, created_by)
      values (r.employee, v_dept, 'active', auth.uid())
      returning id into v_emp;
      v_created := v_created + 1;
    end if;

    if exists (select 1 from public.work_logs w
               where w.employee_id = v_emp and w.log_date = r.log_date and w.deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_dry_run then
      v_inserted := v_inserted + 1;
      continue;
    end if;

    insert into public.work_logs (employee_id, log_date, priority, remarks, status, created_by)
    values (v_emp, r.log_date,
            case when r.priority in ('low','medium','high','critical')
                 then r.priority::public.priority else 'medium' end,
            r.remarks, 'submitted', auth.uid())
    returning id into v_id;

    insert into public.work_log_tasks (log_id, seq, description, status)
    select v_id, ord, trim(t->>'description'),
           case lower(coalesce(t->>'status', ''))
             when 'completed' then 'completed'
             when 'in progress' then 'in_progress'
             when 'in_progress' then 'in_progress'
             when 'on hold' then 'on_hold'
             when 'on_hold' then 'on_hold'
             else 'not_started' end::public.work_task_status
    from jsonb_array_elements(coalesce(r.tasks, '[]'::jsonb)) with ordinality as x(t, ord)
    where nullif(trim(coalesce(t->>'description', '')), '') is not null;

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

    v_inserted := v_inserted + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'hr.worklog', 'work_logs', null,
      format('Imported %s work sheet(s) from the legacy PMS', v_inserted),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                         'ignored', v_ignored, 'employees_created', v_created));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'employees_created', v_created, 'unknown_employees', to_jsonb(v_unknown),
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;

grant execute on function public.import_om_generation(jsonb, boolean) to authenticated;
grant execute on function public.import_daily_reports(jsonb, boolean) to authenticated;
grant execute on function public.import_work_logs(jsonb, boolean) to authenticated;
revoke execute on function public.import_om_generation(jsonb, boolean),
                        public.import_daily_reports(jsonb, boolean),
                        public.import_work_logs(jsonb, boolean) from anon, public;

-- ---------------------------------------------------------------------
-- Module
-- ---------------------------------------------------------------------
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'admin.import', 'Data Import',
       'One-time import of the history from the four legacy applications',
       '/admin/import', 'Blocks', 55, '{view,create}'::public.perm_action[],
       false, false, true, true, 1
from public.module_groups g where g.key = 'admin'
on conflict (key) do nothing;

do $$
declare v_m uuid := (select id from public.modules where key = 'admin.import');
begin
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_m, a, 'all'
  from public.roles r, unnest(array['view','create']::public.perm_action[]) a
  where r.key = 'admin'
  on conflict do nothing;
end $$;
