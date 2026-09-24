-- =====================================================================
-- PHASE 7 — REPORTS
--
-- One RPC per report. All of them are SECURITY INVOKER, so a report can
-- never show a row the caller could not open in its own module: the same
-- RLS (permission + data scope + site access) applies inside the report.
-- Each RPC additionally refuses outright unless the caller holds VIEW on
-- the matching reports.* module.
-- =====================================================================

create or replace function app.require_report(p_module text)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.has_perm(p_module, 'view') then
    raise exception 'Access denied: % VIEW permission required.', p_module using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Tender / CRM report
-- ---------------------------------------------------------------------
create or replace function public.report_tenders(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, (v_to - interval '1 year')::date);
begin
  perform app.require_report('reports.crm');
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'summary', (
      select jsonb_build_object(
        'total', coalesce(count(*), 0),
        'submitted', coalesce(count(*) filter (where status in ('submitted','technical_qualified','financial_opened','won','lost')), 0),
        'won', coalesce(count(*) filter (where status = 'won'), 0),
        'lost', coalesce(count(*) filter (where status in ('lost','technical_disqualified')), 0),
        'win_rate', case when count(*) filter (where status in ('won','lost','technical_disqualified')) > 0
                         then round(100.0 * count(*) filter (where status = 'won')
                                    / count(*) filter (where status in ('won','lost','technical_disqualified')), 1) end,
        'value_submitted', coalesce(sum(coalesce(our_bid_value, estimated_value)) filter (where status <> 'identified'), 0),
        'value_won', coalesce(sum(coalesce(contract_value, our_bid_value, estimated_value)) filter (where status = 'won'), 0),
        'emd_blocked', coalesce(sum(emd_amount) filter (where emd_status in ('submitted','refund_requested')), 0),
        'emd_refunded', coalesce(sum(emd_amount) filter (where emd_status = 'refunded'), 0))
      from public.tenders where coalesce(submission_due_at::date, created_at::date) between v_from and v_to),
    'by_authority', coalesce((
      select jsonb_agg(x order by x->>'authority')
      from (select jsonb_build_object(
              'authority', coalesce(authority, 'Not recorded'),
              'tenders', count(*),
              'won', count(*) filter (where status = 'won'),
              'value', coalesce(sum(estimated_value), 0),
              'won_value', coalesce(sum(coalesce(contract_value, our_bid_value)) filter (where status = 'won'), 0)) as x
            from public.tenders
            where coalesce(submission_due_at::date, created_at::date) between v_from and v_to
            group by authority) t), '[]'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, n)
      from (select status::text, count(*) as n from public.tenders
            where coalesce(submission_due_at::date, created_at::date) between v_from and v_to
            group by status) s), '{}'::jsonb),
    'quotations', (
      select jsonb_build_object(
        'count', coalesce(count(*), 0),
        'value', coalesce(sum(grand_total), 0),
        'approved', coalesce(count(*) filter (where status = 'approved'), 0))
      from public.quotations where quote_date between v_from and v_to));
end;
$$;

-- ---------------------------------------------------------------------
-- Generation report (per site, per month)
-- ---------------------------------------------------------------------
create or replace function public.report_generation(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, date_trunc('month', v_to)::date);
begin
  perform app.require_report('reports.generation');
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'by_site', coalesce((
      select jsonb_agg(jsonb_build_object(
        'site', s.name,
        'capacity_kwp', coalesce(ss.capacity_dc_kwp, s.capacity_kwp),
        'generation', coalesce(g.total, 0),
        'expected', g.expected,
        'days_recorded', coalesce(g.days, 0),
        'grid_outage', coalesce(g.grid_out, 0),
        'plant_outage', coalesce(g.plant_out, 0),
        'tariff', ss.tariff_per_kwh,
        'revenue', case when ss.tariff_per_kwh is not null then round(coalesce(g.total, 0) * ss.tariff_per_kwh, 2) end)
        order by s.name)
      from public.sites s
      left join public.solar_sites ss on ss.site_id = s.id
      left join (select site_id, sum(generation_kwh) total, sum(expected_kwh) expected, count(*) days,
                        sum(grid_outage_hrs) grid_out, sum(plant_outage_hrs) plant_out
                 from public.generation_records where gen_date between v_from and v_to group by site_id) g on g.site_id = s.id
      where s.status = 'active'), '[]'::jsonb),
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'generation', m.total, 'expected', m.expected) order by m.month)
      from (select to_char(date_trunc('month', gen_date), 'YYYY-MM') as month,
                   sum(generation_kwh) total, sum(expected_kwh) expected
            from public.generation_records where gen_date between v_from and v_to
            group by date_trunc('month', gen_date)) m), '[]'::jsonb),
    'total', coalesce((select sum(generation_kwh) from public.generation_records where gen_date between v_from and v_to), 0));
end;
$$;

-- ---------------------------------------------------------------------
-- O&M report (tickets and maintenance)
-- ---------------------------------------------------------------------
create or replace function public.report_om(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, (v_to - interval '90 days')::date);
begin
  perform app.require_report('reports.om');
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'tickets', (
      select jsonb_build_object(
        'raised', coalesce(count(*), 0),
        'closed', coalesce(count(*) filter (where status = 'closed'), 0),
        'open', coalesce(count(*) filter (where status in ('open','assigned','in_progress')), 0),
        'critical', coalesce(count(*) filter (where priority = 'critical'), 0),
        'avg_downtime_hours', round(avg(downtime_hours) filter (where downtime_hours is not null), 2),
        'generation_loss', coalesce(sum(generation_loss_kwh), 0))
      from public.maintenance_tickets where reported_at::date between v_from and v_to),
    'by_site', coalesce((
      select jsonb_agg(jsonb_build_object(
        'site', s.name,
        'tickets', coalesce(t.n, 0),
        'open', coalesce(t.open_n, 0),
        'downtime', coalesce(t.downtime, 0),
        'maintenance_done', coalesce(m.done_n, 0),
        'maintenance_pending', coalesce(m.pending_n, 0)) order by s.name)
      from public.sites s
      left join (select site_id, count(*) n, count(*) filter (where status in ('open','assigned','in_progress')) open_n,
                        sum(downtime_hours) downtime
                 from public.maintenance_tickets where reported_at::date between v_from and v_to group by site_id) t on t.site_id = s.id
      left join (select site_id, count(*) filter (where status = 'done') done_n,
                        count(*) filter (where status in ('todo','in_progress')) pending_n
                 from public.maintenance_records group by site_id) m on m.site_id = s.id
      where s.status = 'active'), '[]'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', coalesce(category, 'Not set'), 'tickets', n) order by n desc)
      from (select category, count(*) n from public.maintenance_tickets
            where reported_at::date between v_from and v_to group by category) c), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- HR report
-- ---------------------------------------------------------------------
create or replace function public.report_hr(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, date_trunc('month', v_to)::date);
begin
  perform app.require_report('reports.hr');
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'headcount', (
      select jsonb_build_object(
        'active', coalesce(count(*) filter (where status = 'active'), 0),
        'joined_in_period', coalesce(count(*) filter (where joining_date between v_from and v_to), 0))
      from public.employees where deleted_at is null),
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object('department', coalesce(d.name, 'Unassigned'), 'employees', coalesce(e.n, 0)) order by d.name)
      from public.departments d
      left join (select department_id, count(*) n from public.employees
                 where status = 'active' and deleted_at is null group by department_id) e on e.department_id = d.id
      where d.status = 'active'), '[]'::jsonb),
    'attendance', (
      select jsonb_build_object(
        'records', coalesce(count(*), 0),
        'present', coalesce(count(*) filter (where status = 'present'), 0),
        'absent', coalesce(count(*) filter (where status = 'absent'), 0),
        'leave', coalesce(count(*) filter (where status = 'leave'), 0),
        'present_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where status = 'present') / count(*), 1) end)
      from public.attendance where att_date between v_from and v_to),
    'leave', (
      select jsonb_build_object(
        'requests', coalesce(count(*), 0),
        'approved', coalesce(count(*) filter (where status = 'approved'), 0),
        'pending', coalesce(count(*) filter (where status = 'pending'), 0),
        'days', coalesce(sum(days) filter (where status = 'approved'), 0))
      from public.leave_requests where from_date between v_from and v_to),
    'tasks', (
      select jsonb_build_object(
        'created', coalesce(count(*), 0),
        'done', coalesce(count(*) filter (where status = 'done'), 0),
        'open', coalesce(count(*) filter (where status in ('todo','in_progress','blocked')), 0))
      from public.tasks where created_at::date between v_from and v_to));
end;
$$;

-- ---------------------------------------------------------------------
-- Daily review report
-- ---------------------------------------------------------------------
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
      where d.status = 'active'), '[]'::jsonb));
end;
$$;

grant execute on function
  public.report_tenders(date, date), public.report_generation(date, date),
  public.report_om(date, date), public.report_hr(date, date), public.report_daily(date, date)
to authenticated;
revoke execute on function
  public.report_tenders(date, date), public.report_generation(date, date),
  public.report_om(date, date), public.report_hr(date, date), public.report_daily(date, date)
from anon, public;

-- ---------------------------------------------------------------------
-- Enable the report modules and give the obvious roles access
-- ---------------------------------------------------------------------
update public.modules set is_enabled = true where key like 'reports.%';
update public.modules set route = '/reports', show_in_nav = false where key like 'reports.%';

do $$
begin
  -- Admin keeps everything.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'all'
  from public.roles r, public.modules m, unnest(array['view','export']::public.perm_action[]) a
  where r.key = 'admin' and m.key like 'reports.%'
  on conflict do nothing;

  -- Management already holds reports.* view/export from the Phase 1 seed;
  -- make sure export is there too.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'export', 'all'
  from public.roles r, public.modules m
  where r.key = 'management' and m.key like 'reports.%'
  on conflict do nothing;
end $$;
