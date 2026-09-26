-- =====================================================================
-- DAILY REVIEW — WHAT THE LEGACY APP ACTUALLY HOLDS
--
-- Reading the live Firestore data rather than the checked-in Netlify
-- Blobs version (whose store is empty) turned up three things the
-- importer did not handle:
--
--  1. The reporter is a NAME typed into the old app -- "Ankit Goyal" --
--     and none of those people have logins yet. reporter_id is a uuid,
--     so every name was being dropped on the floor.
--
--  2. The CCM's remark is written into the `blockers` field, not
--     `remarks` (which is empty on all 47 reports). Sixteen reports
--     carry one, all in CCM voice: "Monitor closely to avoid delay in
--     installation schedule". Those are review comments, not the
--     department's own blockers, and they belong in review_actions.
--
--  3. The status " CCM Remarks" (with a leading space) means the CCM
--     commented, not that the department is unhealthy, so health stays
--     as it was and the comment is recorded separately.
--
-- Also drops Accounts & Finance from the daily round: the legacy app
-- runs six departments and that is not one of them.
-- =====================================================================

alter table public.daily_reports
  add column if not exists reporter_name text;
comment on column public.daily_reports.reporter_name is
  'Who reported, as free text. Used for legacy rows and anyone without a login; reporter_id wins when both are set.';

alter table public.review_actions
  add column if not exists reviewer_name text;
comment on column public.review_actions.reviewer_name is
  'Who reviewed, as free text, for legacy rows whose reviewer has no account.';

update public.departments set status = 'inactive', updated_at = now()
where name = 'Accounts & Finance' and status = 'active';
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
      from public.departments d where d.status = 'active'), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.get_daily_review(date, date) to authenticated;
revoke execute on function public.get_daily_review(date, date) from anon, public;


-- ---------------------------------------------------------------------
-- The importer, rewritten around what the export really contains.
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
  v_remarks int := 0;
  v_notes int := 0;
  v_unknown text[] := '{}';
  r record;
  n record;
  v_dept uuid;
  v_dept_name text;
  v_id uuid;
  v_health public.daily_health;
  v_ccm text;
begin
  if not app.has_perm('daily.reports', 'create') then
    raise exception 'Access denied: daily.reports CREATE permission required to import reports.'
      using errcode = '42501';
  end if;

  for r in
    select nullif(x->>'date', '')::date as report_date,
           x->>'deptId'     as dept_id,
           x->>'status'     as status,
           x->>'reporter'   as reporter,
           x->>'analyzedBy' as analyzed_by,
           x->>'highlights' as highlights,
           x->>'blockers'   as blockers,
           x->>'remarks'    as remarks,
           x->'metrics'     as metrics
    from jsonb_array_elements(coalesce(p_payload->'reports', '[]'::jsonb)) x
    order by 1
  loop
    continue when r.report_date is null;

    select d->>'name' into v_dept_name
    from jsonb_array_elements(coalesce(p_payload->'depts', '[]'::jsonb)) d
    where d->>'id' = r.dept_id limit 1;

    select id into v_dept from public.departments
    where lower(name) = lower(coalesce(v_dept_name, '')) limit 1;

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
      if nullif(trim(coalesce(r.blockers, '')), '') is not null then
        v_remarks := v_remarks + 1;
      end if;
      continue;
    end if;

    -- " CCM Remarks" says the CCM commented, not that the department is
    -- unwell, so it leaves health alone. Only wording that actually names
    -- a problem moves the needle.
    v_health := case
      when r.status ilike '%critical%' then 'critical'
      when r.status ilike '%attention%' or r.status ilike '%delay%' or r.status ilike '%risk%'
        then 'needs_attention'
      else 'on_track' end::public.daily_health;

    insert into public.daily_reports
      (report_date, department_id, health, work_completed, issues, remarks,
       reporter_name, status, reviewed_at, created_by)
    values (r.report_date, v_dept, v_health,
            nullif(trim(coalesce(r.highlights, '')), ''),
            null,                                    -- see below: blockers is the CCM's, not the department's
            nullif(trim(coalesce(r.remarks, '')), ''),
            nullif(trim(coalesce(r.reporter, '')), ''),
            case when nullif(trim(coalesce(r.analyzed_by, '')), '') is not null
                 then 'reviewed' else 'submitted' end::public.daily_report_status,
            case when nullif(trim(coalesce(r.analyzed_by, '')), '') is not null
                 then r.report_date + time '18:00' at time zone 'Asia/Kolkata' end,
            auth.uid())
    returning id into v_id;

    insert into public.daily_report_items (report_id, sort_order, label, value)
    select v_id, ord, m->>'label', coalesce(m->>'value', '')
    from jsonb_array_elements(coalesce(r.metrics, '[]'::jsonb)) with ordinality as t(m, ord)
    where nullif(trim(coalesce(m->>'label', '')), '') is not null;

    -- The old app has no field for a reviewer's comment, so the CCM types
    -- it into `blockers`. Every one of them reads as review commentary.
    v_ccm := nullif(trim(coalesce(r.blockers, '')), '');
    if v_ccm is not null then
      insert into public.review_actions (report_id, action, comment, reviewer_name, created_by)
      values (v_id, 'ccm_remark', v_ccm,
              nullif(trim(coalesce(r.analyzed_by, '')), ''), auth.uid());
      v_remarks := v_remarks + 1;
    end if;

    v_inserted := v_inserted + 1;
  end loop;

  -- Headline numbers and the founder's note for the day.
  for n in
    select nullif(x->>'date', '')::date as d, x->'metrics' as metrics, null::text as note
    from jsonb_array_elements(coalesce(p_payload->'headlines', '[]'::jsonb)) x
    union all
    select nullif(x->>'date', '')::date, null::jsonb, nullif(trim(coalesce(x->>'text', '')), '')
    from jsonb_array_elements(coalesce(p_payload->'notes', '[]'::jsonb)) x
  loop
    continue when n.d is null or (n.metrics is null and n.note is null);
    if p_dry_run then
      v_notes := v_notes + 1;
      continue;
    end if;
    insert into public.daily_headlines (headline_date, metrics, note)
    values (n.d, coalesce(n.metrics, '[]'::jsonb), n.note)
    on conflict (headline_date) do update
      set metrics = case when excluded.metrics <> '[]'::jsonb then excluded.metrics
                         else public.daily_headlines.metrics end,
          note    = coalesce(excluded.note, public.daily_headlines.note),
          updated_at = now();
    v_notes := v_notes + 1;
  end loop;

  if not p_dry_run then
    perform app.write_audit('import', 'daily.reports', 'daily_reports', null,
      format('Imported %s daily report(s) from the legacy Daily Review CRM', v_inserted),
      jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped,
                         'ignored', v_ignored, 'ccm_remarks', v_remarks, 'headlines', v_notes));
  end if;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'ignored', v_ignored,
                            'ccm_remarks', v_remarks, 'headlines', v_notes,
                            'unknown_departments', to_jsonb(v_unknown),
                            'dry_run', coalesce(p_dry_run, false));
end;
$$;
grant execute on function public.import_daily_reports(jsonb, boolean) to authenticated;
revoke execute on function public.import_daily_reports(jsonb, boolean) from anon, public;
