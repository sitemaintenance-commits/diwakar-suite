-- =====================================================================
-- PROJECTS REPORT (Analytics)
--
-- The "Project Reports" permission existed, but Analytics had no projects
-- report. This is it: the portfolio, and per project where it stands --
-- stage, progress, tasks, site updates filed in the period, materials,
-- approvals and the money. Security invoker like the other reports, so it
-- never shows a row the caller could not open in Projects.
-- =====================================================================
create or replace function public.report_projects(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, (v_to - interval '30 days')::date);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform app.require_report('reports.projects');
  return (
    with p as (
      select pr.id, pr.name, pr.stage, pr.capacity_kwp, pr.capacity_ac_kw, pr.contract_value, pr.target_commissioning,
             coalesce(t.total, 0) task_total, coalesce(t.done, 0) task_done,
             coalesce(t.open_n, 0) tasks_open, coalesce(t.overdue, 0) tasks_overdue,
             coalesce(u.n, 0) updates, u.last_update,
             coalesce(m.open_n, 0) materials_open, coalesce(m.short_n, 0) shortages,
             coalesce(a.pending, 0) approvals_pending,
             coalesce(c.invoiced, 0) invoiced, coalesce(c.received, 0) received,
             coalesce(b.waiting, 0) bills_waiting
      from public.projects pr
      left join (select project_id, count(*) total, count(*) filter (where status = 'done') done,
                        count(*) filter (where status not in ('done','cancelled')) open_n,
                        count(*) filter (where status not in ('done','cancelled') and due_date < v_today) overdue
                 from public.project_tasks where deleted_at is null group by project_id) t on t.project_id = pr.id
      left join (select project_id, count(*) filter (where update_date between v_from and v_to) n, max(update_date) last_update
                 from public.project_updates where deleted_at is null group by project_id) u on u.project_id = pr.id
      left join (select project_id, count(*) filter (where status in ('pending','ordered','dispatched','shortage')) open_n,
                        count(*) filter (where status = 'shortage') short_n
                 from public.project_materials where deleted_at is null group by project_id) m on m.project_id = pr.id
      left join (select project_id, count(*) filter (where status <> 'approved') pending
                 from public.project_approvals where deleted_at is null group by project_id) a on a.project_id = pr.id
      left join (select project_id, sum(amount) invoiced, sum(received_amount) received
                 from public.client_payments where deleted_at is null group by project_id) c on c.project_id = pr.id
      left join (select project_id, count(*) filter (where status in ('submitted','pm_approved')) waiting
                 from public.vendor_bills where deleted_at is null group by project_id) b on b.project_id = pr.id
      where pr.deleted_at is null
    ),
    scored as (
      select p.*, case when task_total > 0 then round(100.0 * task_done / task_total, 0)
                       when stage in ('commissioning','handover','closed') then 100 else 0 end progress
      from p
    )
    select jsonb_build_object(
      'from', v_from, 'to', v_to,
      'summary', jsonb_build_object(
        'projects', (select count(*) from scored),
        'commissioned', (select count(*) from scored where stage in ('commissioning','handover','closed')),
        'capacity_kwp', coalesce((select sum(capacity_kwp) from scored), 0),
        'capacity_ac_kw', coalesce((select sum(capacity_ac_kw) from scored), 0),
        'average_progress', coalesce((select round(avg(progress), 0) from scored), 0),
        'updates', coalesce((select sum(updates) from scored), 0),
        'sites_updating', (select count(*) from scored where updates > 0),
        'tasks_open', coalesce((select sum(tasks_open) from scored), 0),
        'tasks_overdue', coalesce((select sum(tasks_overdue) from scored), 0),
        'shortages', coalesce((select sum(shortages) from scored), 0),
        'approvals_pending', coalesce((select sum(approvals_pending) from scored), 0),
        'contract_value', coalesce((select sum(contract_value) from scored), 0),
        'outstanding', coalesce((select sum(invoiced - received) from scored), 0)),
      'by_project', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'project', name, 'stage', initcap(stage::text), 'capacity_kwp', capacity_kwp, 'progress', progress,
                 'tasks_open', tasks_open, 'tasks_overdue', tasks_overdue,
                 'updates', updates, 'last_update', last_update,
                 'materials_open', materials_open, 'shortages', shortages,
                 'approvals_pending', approvals_pending, 'bills_waiting', bills_waiting,
                 'contract_value', contract_value, 'outstanding_value', invoiced - received)
               order by (stage in ('commissioning','handover','closed')), name)
        from scored), '[]'::jsonb),
      'by_stage', coalesce((
        select jsonb_agg(jsonb_build_object('stage', initcap(stage::text), 'projects', n, 'capacity_kwp', kwp) order by stage)
        from (select stage, count(*) n, sum(capacity_kwp) kwp from scored group by stage) s), '[]'::jsonb))
  );
end;
$$;

grant execute on function public.report_projects(date, date) to authenticated;
revoke execute on function public.report_projects(date, date) from anon, public;
