-- =====================================================================
-- DEPARTMENT REVIEW IN THE LEGACY WORKBOOK'S SHAPE
--
-- The old site kept "Daily Review Update Tracker.xlsx": one row per
-- department and day --
--   Review date | Department | Reported by | Status | Department updates |
--   Today Key Remarks Updates (Jitendra Sharma) | CCM Remarks |
--   Founder Remarks (Sunil Bansal)
-- Management Review can now import that sheet (and the suite's own
-- download, which has the same columns). The browser reads the workbook;
-- import_review_excel() previews, then writes:
--   * a department-day not in the suite becomes a submitted report, with
--     its "label: value" department updates as the report's numbers;
--   * one already here only has its empty parts filled -- nothing typed in
--     the suite is overwritten;
--   * CCM and Founder remarks are added unless the same remark is there.
-- Founder remarks carry the founder's name (setting founder_name, Sunil
-- Bansal by default), CCM remarks just "CCM".
-- =====================================================================

insert into public.app_settings (key, value)
values ('founder_name', to_jsonb('Sunil Bansal'::text))
on conflict (key) do nothing;

create or replace function public.import_review_excel(p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_date date;
  v_dept uuid;
  v_name text;
  v_report public.daily_reports;
  v_metrics jsonb;
  v_updates text; v_issues text; v_plan text; v_reporter text; v_ccm text; v_founder text;
  v_founder_name text := coalesce((select value #>> '{}' from public.app_settings where key = 'founder_name'), 'Sunil Bansal');
  v_fields text[];
  v_added jsonb := '[]'; v_filled jsonb := '[]'; v_unknown text[] := '{}';
  v_unchanged int := 0; v_remarks int := 0; v_bad int := 0;
begin
  if not app.has_perm('daily.reports', 'create') then
    raise exception 'Access denied: daily.reports CREATE permission required to import reports.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Rows must be a list.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_date := nullif(r->>'date', '')::date;
    exception when others then
      v_date := null;
    end;
    v_name := nullif(btrim(coalesce(r->>'department', '')), '');
    if v_date is null or v_name is null or v_date > (now() at time zone 'Asia/Kolkata')::date then
      v_bad := v_bad + 1;
      continue;
    end if;
    select id into v_dept from public.departments where lower(name) = lower(v_name) limit 1;
    if v_dept is null then
      if not (v_name = any (v_unknown)) then v_unknown := v_unknown || v_name; end if;
      continue;
    end if;

    v_updates := nullif(btrim(coalesce(r->>'updates', '')), '');
    v_issues := nullif(btrim(coalesce(r->>'issues', '')), '');
    v_plan := nullif(btrim(coalesce(r->>'plan', '')), '');
    v_reporter := nullif(btrim(coalesce(r->>'reporter', '')), '');
    v_ccm := nullif(btrim(coalesce(r->>'ccm', '')), '');
    v_founder := nullif(btrim(coalesce(r->>'founder', '')), '');
    select coalesce(jsonb_agg(m), '[]'::jsonb) into v_metrics
    from jsonb_array_elements(coalesce(r->'metrics', '[]'::jsonb)) m
    where nullif(btrim(coalesce(m->>'label', '')), '') is not null;

    select * into v_report from public.daily_reports
    where department_id = v_dept and report_date = v_date and deleted_at is null;

    if v_report.id is null then
      -- --------------------------------------------------------- new
      if p_apply then
        insert into public.daily_reports
          (report_date, department_id, health, work_completed, issues, next_day_plan,
           reporter_name, status, submitted_at, created_by)
        values (v_date, v_dept,
                case when r->>'status' ilike '%critical%' then 'critical'
                     when r->>'status' ilike '%attention%' or r->>'status' ilike '%delay%' or r->>'status' ilike '%risk%'
                       then 'needs_attention'
                     else 'on_track' end::public.daily_health,
                v_updates, v_issues, v_plan, v_reporter,
                'submitted', v_date + time '18:00' at time zone 'Asia/Kolkata', auth.uid())
        returning * into v_report;
        insert into public.daily_report_items (report_id, sort_order, label, value)
        select v_report.id, ord, btrim(m->>'label'), coalesce(m->>'value', '')
        from jsonb_array_elements(v_metrics) with ordinality as t(m, ord);
      end if;
      v_added := v_added || jsonb_build_object('date', v_date, 'department', v_name,
        'remarks', (v_ccm is not null)::int + (v_founder is not null)::int);
      if v_ccm is not null then v_remarks := v_remarks + 1; end if;
      if v_founder is not null then v_remarks := v_remarks + 1; end if;
      if p_apply then
        if v_ccm is not null then
          insert into public.review_actions (report_id, action, comment, reviewer_name, created_by)
          values (v_report.id, 'ccm_remark', v_ccm, 'CCM', auth.uid());
        end if;
        if v_founder is not null then
          insert into public.review_actions (report_id, action, comment, reviewer_name, created_by)
          values (v_report.id, 'founder_remark', v_founder, v_founder_name, auth.uid());
        end if;
      end if;
      v_report := null;
      continue;
    end if;

    -- -------------------------------------------------- already here
    v_fields := '{}';
    if v_report.work_completed is null and v_updates is not null then v_fields := array_append(v_fields, 'today''s key remarks'); end if;
    if v_report.issues is null and v_issues is not null then v_fields := array_append(v_fields, 'issues'); end if;
    if v_report.next_day_plan is null and v_plan is not null then v_fields := array_append(v_fields, 'plan'); end if;
    if v_report.reporter_name is null and v_report.reporter_id is null and v_reporter is not null then v_fields := array_append(v_fields, 'reported by'); end if;
    if jsonb_array_length(v_metrics) > 0
       and not exists (select 1 from public.daily_report_items i where i.report_id = v_report.id) then
      v_fields := array_append(v_fields, 'department updates');
    end if;
    if v_ccm is not null and not exists (select 1 from public.review_actions a where a.report_id = v_report.id
                                           and a.action = 'ccm_remark' and btrim(coalesce(a.comment, '')) = v_ccm) then
      v_fields := array_append(v_fields, 'CCM remark');
      v_remarks := v_remarks + 1;
    end if;
    if v_founder is not null and not exists (select 1 from public.review_actions a where a.report_id = v_report.id
                                               and a.action = 'founder_remark' and btrim(coalesce(a.comment, '')) = v_founder) then
      v_fields := array_append(v_fields, 'Founder remark');
      v_remarks := v_remarks + 1;
    end if;

    if cardinality(v_fields) = 0 then
      v_unchanged := v_unchanged + 1;
    else
      v_filled := v_filled || jsonb_build_object('date', v_date, 'department', v_name, 'fields', to_jsonb(v_fields));
      if p_apply then
        update public.daily_reports d set
          work_completed = coalesce(d.work_completed, v_updates),
          issues = coalesce(d.issues, v_issues),
          next_day_plan = coalesce(d.next_day_plan, v_plan),
          reporter_name = case when d.reporter_name is null and d.reporter_id is null then v_reporter else d.reporter_name end,
          updated_at = now()
        where d.id = v_report.id;
        if 'department updates' = any (v_fields) then
          insert into public.daily_report_items (report_id, sort_order, label, value)
          select v_report.id, ord, btrim(m->>'label'), coalesce(m->>'value', '')
          from jsonb_array_elements(v_metrics) with ordinality as t(m, ord);
        end if;
        if 'CCM remark' = any (v_fields) then
          insert into public.review_actions (report_id, action, comment, reviewer_name, created_by)
          values (v_report.id, 'ccm_remark', v_ccm, 'CCM', auth.uid());
        end if;
        if 'Founder remark' = any (v_fields) then
          insert into public.review_actions (report_id, action, comment, reviewer_name, created_by)
          values (v_report.id, 'founder_remark', v_founder, v_founder_name, auth.uid());
        end if;
      end if;
    end if;
    v_report := null;
  end loop;

  return jsonb_build_object(
    'applied', p_apply,
    'total', jsonb_array_length(p_rows),
    'added', v_added,
    'filled', v_filled,
    'unchanged', v_unchanged,
    'remarks', v_remarks,
    'unknown_departments', to_jsonb(v_unknown),
    'unreadable', v_bad);
end;
$$;

grant execute on function public.import_review_excel(jsonb, boolean) to authenticated;
revoke execute on function public.import_review_excel(jsonb, boolean) from anon, public;
