-- =====================================================================
-- DEPARTMENT REPORT ROWS CAN CARRY A NOTE
--
-- Each row of a department's daily report ("Office housekeeping: Done")
-- can now have optional additional information under it. Saved with the
-- row, shown wherever the row is shown (the report, the review page).
-- =====================================================================

alter table public.daily_report_items add column if not exists note text;
comment on column public.daily_report_items.note is 'Optional additional information for this row.';

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
  insert into public.daily_report_items (report_id, sort_order, label, value, note)
  select v_id, row_number() over (), i.label, coalesce(i.value, ''), nullif(btrim(coalesce(i.note, '')), '')
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) i(label text, value text, note text)
  where coalesce(trim(i.label), '') <> '';

  return v_id;
end;
$$;

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
                    'metrics', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'value', i.value, 'note', i.note) order by i.sort_order)
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
                       'metrics', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'value', i.value, 'note', i.note) order by i.sort_order)
                                            from public.daily_report_items i where i.report_id = r.id), '[]'::jsonb))
                     from public.daily_reports r where r.department_id = d.id and r.report_date = v_prev limit 1))
        order by d.name)
      from public.departments d where d.status = 'active' and d.in_daily_review), '[]'::jsonb)
  );
end;
$$;
