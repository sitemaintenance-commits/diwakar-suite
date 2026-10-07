-- =====================================================================
-- TODAY IN THE COMPANY (dashboard)
--
-- One card per section for whoever sees that whole section (Super Admin
-- sees all): a traffic light -- good / ok / bad -- and two or three plain
-- facts. Daily filings (O&M readings, DPRs, department reports, Daily Work
-- sheets) are judged on yesterday until 6 pm, then on today, so the board
-- is not red every morning before people have filed.
-- =====================================================================

/** Whether the caller sees the whole of a module (not just their own rows). */
create or replace function app.sees_all(p_module text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_user()
     and (app.is_super_admin() or (app.has_perm(p_module, 'view') and app.perm_scope(p_module, 'view') = 'all'));
$$;

/** good / ok / bad from a share filed: 90% and up is good, 60% and up ok. */
create or replace function app.light(p_done numeric, p_total numeric)
returns text
language sql immutable
set search_path = ''
as $$
  select case when coalesce(p_total, 0) = 0 then 'good'
              when p_done / p_total >= 0.9 then 'good'
              when p_done / p_total >= 0.6 then 'ok'
              else 'bad' end;
$$;

create or replace function public.get_company_today()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := v_now::date;
  -- The day filings are judged on: yesterday until 6 pm.
  v_day date := case when extract(hour from v_now) >= 18 then v_now::date else v_now::date - 1 end;
  v_day_label text := case when extract(hour from v_now) >= 18 then 'today' else 'yesterday' end;
  v_out jsonb := '[]'::jsonb;
  a int; b int; c int; d int; d2 int; e numeric; f numeric;
  v_light text;
  v_chips jsonb;
begin
  if not app.is_active_user() then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------- O&M
  if app.sees_all('om.daily_entry') or app.sees_all('om.generation') then
    select count(*) into a from public.sites where status = 'active';
    -- plants that filed readings on the judged day, and today so far
    select count(distinct g.site_id) filter (where g.gen_date = v_day),
           count(distinct g.site_id) filter (where g.gen_date = v_today)
      into b, c
      from public.generation_records g join public.sites s on s.id = g.site_id and s.status = 'active'
      where g.gen_date in (v_day, v_today) and g.deleted_at is null;
    select coalesce(sum(generation_kwh), 0), coalesce(sum(expected_kwh), 0) into e, f
      from public.generation_records where gen_date = v_today - 1 and deleted_at is null;
    -- open tickets; d2 holds the critical ones
    select count(*) filter (where status in ('open','assigned','in_progress')),
           count(*) filter (where status in ('open','assigned','in_progress') and priority = 'critical')
      into d, d2
      from public.maintenance_tickets where deleted_at is null;
    v_light := case when d2 > 0 then 'bad' else app.light(b, a) end;
    v_out := v_out || jsonb_build_object(
      'key', 'om', 'title', 'O&M', 'route', '/operations/daily-entry', 'status', v_light,
      'headline', format('%s of %s plants filed readings %s', b, a, v_day_label),
      'facts', jsonb_build_array(
        format('Today so far: %s of %s plants', c, a),
        case when f > 0 then format('Yesterday''s generation: %s kWh (%s%% of expected)', to_char(e, 'FM99,99,99,990'), round(100 * e / f))
             else format('Yesterday''s generation: %s kWh', to_char(e, 'FM99,99,99,990')) end,
        format('%s open ticket(s)%s', d, case when d2 > 0 then format(', %s critical', d2) else '' end)));
  end if;

  -- -------------------------------------------------------- Projects
  if app.sees_all('projects.projects') or app.sees_all('projects.updates') then
    select count(*) into a from public.projects
      where deleted_at is null and stage not in ('commissioning','handover','closed');
    select count(distinct u.project_id) into b from public.project_updates u
      join public.projects p on p.id = u.project_id and p.deleted_at is null and p.stage not in ('commissioning','handover','closed')
      where u.update_date = v_day and u.deleted_at is null;
    select count(*) into c from public.project_updates u
      where u.update_date between v_today - 1 and v_today and u.deleted_at is null and u.safety_followed = false;
    select count(*) into d from public.project_tasks t join public.projects p on p.id = t.project_id and p.deleted_at is null
      where t.deleted_at is null and t.status not in ('done','cancelled') and t.due_date < v_today;
    v_light := case when a = 0 then 'good' when c > 0 and app.light(b, a) = 'good' then 'ok' else app.light(b, a) end;
    v_out := v_out || jsonb_build_object(
      'key', 'projects', 'title', 'Projects', 'route', '/projects/updates', 'status', v_light,
      'headline', case when a = 0 then 'No sites under construction'
                       else format('%s of %s sites under construction filed a DPR %s', b, a, v_day_label) end,
      'facts', jsonb_build_array(
        format('%s overdue task(s)', d),
        case when c > 0 then format('Safety not followed at %s site(s) — see the DPR', c) else 'Safety followed at every site that reported' end));
  end if;

  -- --------------------------------------------------------- Tenders
  if app.sees_all('crm.tenders') then
    select count(*) into a from public.tenders where deleted_at is null
      and status in ('identified','evaluating','preparing') and submission_due_at < now();
    select count(*) into b from public.tenders where deleted_at is null
      and status in ('identified','evaluating','preparing') and submission_due_at between now() and now() + interval '3 days';
    select count(*) into c from public.tenders where deleted_at is null
      and status in ('identified','evaluating','preparing') and submission_due_at between now() and now() + interval '7 days';
    select count(*) into d from public.tenders where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date = v_today;
    v_light := case when a > 0 then 'bad' when b > 0 then 'ok' else 'good' end;
    v_out := v_out || jsonb_build_object(
      'key', 'tenders', 'title', 'Tenders', 'route', '/crm/tenders', 'status', v_light,
      'headline', case when a > 0 then format('%s tender(s) past the due date and not submitted', a)
                       when b > 0 then format('%s tender(s) due in the next 3 days', b)
                       else format('%s tender(s) due this week — all on time', c) end,
      'facts', jsonb_build_array(
        format('%s due in the next 7 days', c),
        format('%s new tender(s) added today', d),
        format('%s submitted, %s won this month',
               (select count(*) from public.tenders where deleted_at is null and submitted_at >= date_trunc('month', v_now)),
               (select count(*) from public.tenders where deleted_at is null and status = 'won' and coalesce(result_declared_on, updated_at::date) >= date_trunc('month', v_now)::date))));
  end if;

  -- --------------------------------------------- Department Review
  if app.sees_all('daily.reports') then
    select count(*) into a from public.departments where status = 'active' and in_daily_review;
    select count(distinct r.department_id) into b from public.daily_reports r
      join public.departments d2 on d2.id = r.department_id and d2.status = 'active' and d2.in_daily_review
      where r.report_date = v_day and r.deleted_at is null and r.status <> 'draft';
    select count(*) into c from public.daily_reports r
      where r.report_date = v_day and r.deleted_at is null and r.status <> 'draft' and r.health = 'critical';
    -- One chip per department: its health that day, or not filed.
    select coalesce(jsonb_agg(jsonb_build_object('label', d2.name,
             'status', case r.health when 'on_track' then 'good' when 'needs_attention' then 'ok' when 'critical' then 'bad' else 'none' end,
             'note', case when r.id is null then 'not filed' else replace(r.health::text, '_', ' ') end)
             order by case r.health when 'critical' then 0 when 'needs_attention' then 1 when 'on_track' then 3 else 2 end, d2.name), '[]'::jsonb)
      into v_chips
      from public.departments d2
      left join lateral (select * from public.daily_reports x where x.department_id = d2.id and x.report_date = v_day
                         and x.deleted_at is null and x.status <> 'draft' order by x.updated_at desc limit 1) r on true
      where d2.status = 'active' and d2.in_daily_review;
    v_light := case when c > 0 then 'bad' else app.light(b, a) end;
    v_out := v_out || jsonb_build_object(
      'key', 'departments', 'title', 'Departments', 'route', '/daily-review/reports', 'status', v_light,
      'headline', format('%s of %s departments reported %s', b, a, v_day_label),
      'facts', jsonb_build_array(case when c > 0 then format('%s department(s) critical', c) else 'No department critical' end),
      'chips', v_chips);
  end if;

  -- ------------------------------------------------- HR daily work
  if app.sees_all('hr.worklog') then
    select cardinality(coalesce(public.daily_sheet_filers(), '{}'::uuid[])) into a;
    select count(*) into b from public.work_logs w
      where w.log_date = v_day and w.deleted_at is null and w.status = 'submitted'
        and w.employee_id = any (coalesce(public.daily_sheet_filers(), '{}'::uuid[]));
    select count(*) into c from public.work_logs w
      where w.log_date = v_today and w.deleted_at is null and w.status = 'submitted'
        and w.employee_id = any (coalesce(public.daily_sheet_filers(), '{}'::uuid[]));
    -- Best and lowest filing department that day.
    select coalesce(jsonb_agg(jsonb_build_object('label', name, 'status', app.light(done, total),
             'note', format('%s/%s', done, total)) order by done::numeric / total desc, name), '[]'::jsonb)
      into v_chips
      from (select d2.name, count(*) total,
                   count(*) filter (where exists (select 1 from public.work_logs w where w.employee_id = e2.id and w.log_date = v_day
                                                  and w.deleted_at is null and w.status = 'submitted')) done
            from public.employees e2 join public.departments d2 on d2.id = e2.department_id
            where e2.id = any (coalesce(public.daily_sheet_filers(), '{}'::uuid[]))
            group by d2.name) x;
    v_out := v_out || jsonb_build_object(
      'key', 'hr', 'title', 'Daily Work (HR)', 'route', '/hr/work-history', 'status', app.light(b, a),
      'headline', format('%s of %s employees submitted their sheet %s', b, a, v_day_label),
      'facts', jsonb_build_array(format('Today so far: %s of %s', c, a)),
      'chips', v_chips);
  end if;

  -- ------------------------------------------------------- Approvals
  if app.is_super_admin() or app.has_perm('approvals', 'approve') then
    select count(*) filter (where status in ('pending','needs_info')),
           count(*) filter (where status = 'pending' and created_at < now() - interval '3 days'),
           count(*) filter (where (created_at at time zone 'Asia/Kolkata')::date = v_today)
      into a, b, c
      from public.approval_requests;
    v_out := v_out || jsonb_build_object(
      'key', 'approvals', 'title', 'Approvals', 'route', '/approvals', 'status',
      case when b > 0 then 'bad' when a > 0 then 'ok' else 'good' end,
      'headline', case when a = 0 then 'Nothing waiting for a decision' else format('%s request(s) waiting for a decision', a) end,
      'facts', jsonb_build_array(
        case when b > 0 then format('%s waiting more than 3 days', b) else 'None waiting more than 3 days' end,
        format('%s new request(s) today', c)));
  end if;

  return jsonb_build_object('judged_on', v_day, 'judged_label', v_day_label, 'sections', v_out);
end;
$$;

grant execute on function public.get_company_today() to authenticated;
revoke execute on function public.get_company_today() from anon, public;
