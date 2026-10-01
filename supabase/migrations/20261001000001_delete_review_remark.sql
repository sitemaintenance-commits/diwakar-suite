-- =====================================================================
-- Delete a CCM or Founder remark on a daily report.
--
-- Remarks could be added but never removed, so a wrong or duplicate one
-- stayed in the review and in every Excel export. A remark may now be
-- deleted by whoever wrote it, or by anyone who may edit Management Review
-- (the CCM office, management). "Reviewed" / "returned" entries are the
-- report's history and stay. Every deletion is written to the audit log.
-- get_daily_review now gives each remark its id and whether the caller may
-- delete it, using the same rule as the policy.
-- =====================================================================
grant delete on public.review_actions to authenticated;

create policy review_actions_delete on public.review_actions for delete to authenticated
  using (exists (select 1 from public.daily_reports r where r.id = report_id)
         and action in ('ccm_remark', 'founder_remark')
         and (created_by = (select auth.uid())
              or reviewer_id = (select auth.uid())
              or (select app.has_perm('daily.review', 'edit'))));

drop trigger if exists audit_row on public.review_actions;
create trigger audit_row after insert or delete on public.review_actions
  for each row execute function app.audit_row_change('daily.review');

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
                    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'comment', a.comment,
                                                                            'at', a.created_at,
                                                                            'by', coalesce((select p2.full_name from public.profiles p2 where p2.id = a.reviewer_id), a.reviewer_name),
                                                                            -- the same rule as the delete policy, so the page only offers what will work
                                                                            'can_delete', a.action in ('ccm_remark', 'founder_remark')
                                                                                          and (a.created_by = auth.uid() or a.reviewer_id = auth.uid()
                                                                                               or public.has_permission('daily.review', 'edit')))
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
