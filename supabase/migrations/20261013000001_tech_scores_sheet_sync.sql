-- =====================================================================
-- TEAM PERFORMANCE FROM THE TECHNICIANS' GOOGLE FORM
--
-- The O&M technicians fill a daily Google Form ("Daily Solar Site
-- Technician Work Tracker") whose answers land in a sheet: technician,
-- date, site, attendance, daily work, task assigned and its status, form
-- submitted, remarks. The sheet-sync function reads it every 30 minutes
-- with the other sheets and scores each answer the way the O&M CRM did:
--
--   Attendance  20  Present (a half day 10)
--   Daily Work  25  any work written
--   Task        10  task assigned "Yes"
--   Form        25  form submitted "Yes"
--   Monthly     20  from the sheet if filled there; otherwise the
--                   reviewers enter it in the suite (kept, never cleared)
--
--   * One score per technician, site and day; the latest answer wins.
--   * The technician is matched to the site team (om_team_members) by name,
--     so the same person keeps one line even when the name's case varies.
--   * A score entered by hand in the suite (source 'manual') is kept.
-- The sheet's address lives in setting tech_scores_sheet.
-- =====================================================================

alter table public.om_tech_scores add column if not exists sheet_submitted_at timestamptz;

insert into public.app_settings (key, value)
values ('tech_scores_sheet', '{"sheet_id": null, "gid": null}'::jsonb)
on conflict (key) do nothing;

/**
 * Row: {site, date, submitted_at, technician, attendance, daily_work,
 * task_assigned, task_status, form_submit, monthly_review, remarks}
 * (marks already worked out by the sheet-sync function). Service key only.
 */
create or replace function public.sync_tech_scores(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_site uuid;
  v_date date;
  v_at timestamptz;
  v_name text;
  m record;
  v_old record;
  v_key text;
  v_added int := 0; v_updated int := 0; v_kept int := 0; v_same int := 0;
  v_unmatched text[] := '{}';
begin
  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
           order by (x->>'submitted_at')::timestamptz nulls first loop
    v_date := nullif(r->>'date', '')::date;
    v_at := nullif(r->>'submitted_at', '')::timestamptz;
    v_name := btrim(regexp_replace(coalesce(r->>'technician', ''), '\s+', ' ', 'g'));
    continue when v_date is null or v_name = '' or v_date > (now() at time zone 'Asia/Kolkata')::date;
    select s.id into v_site from public.sites s where lower(s.name) = lower(btrim(r->>'site')) limit 1;
    if v_site is null then
      if not (r->>'site' = any (v_unmatched)) then v_unmatched := array_append(v_unmatched, r->>'site'); end if;
      continue;
    end if;

    -- The site team member of that name (the site's own first, then anyone).
    select tm.id, tm.user_id, tm.full_name into m
    from public.om_team_members tm
    where tm.deleted_at is null and lower(btrim(tm.full_name)) = lower(v_name)
    order by (tm.site_id = v_site) desc, tm.is_active desc
    limit 1;
    v_key := coalesce(m.id::text, m.user_id::text, lower(v_name));

    select t.id, t.source, t.sheet_submitted_at, t.monthly_review into v_old
    from public.om_tech_scores t
    where t.site_id = v_site and t.score_date = v_date and t.subject_key = v_key and t.deleted_at is null;
    if v_old.id is not null and v_old.source = 'manual' then
      v_kept := v_kept + 1;
      continue;
    end if;
    if v_old.id is not null and v_old.sheet_submitted_at is not null and v_at is not null and v_old.sheet_submitted_at >= v_at then
      v_same := v_same + 1;
      continue;
    end if;

    if v_old.id is null then
      insert into public.om_tech_scores
        (site_id, score_date, member_id, technician_id, technician_name, attendance, daily_work, task_assigned,
         task_status, form_submit, monthly_review, remarks, source, sheet_submitted_at)
      values (v_site, v_date, m.id, m.user_id, coalesce(m.full_name, v_name),
              least(greatest(coalesce((r->>'attendance')::int, 0), 0), 20),
              least(greatest(coalesce((r->>'daily_work')::int, 0), 0), 25),
              least(greatest(coalesce((r->>'task_assigned')::int, 0), 0), 10),
              nullif(btrim(coalesce(r->>'task_status', '')), ''),
              least(greatest(coalesce((r->>'form_submit')::int, 0), 0), 25),
              case when (r->>'monthly_review') ~ '^\d+$' then least((r->>'monthly_review')::int, 20) end,
              nullif(btrim(coalesce(r->>'remarks', '')), ''), 'sheet', v_at);
      v_added := v_added + 1;
    else
      update public.om_tech_scores set
        attendance = least(greatest(coalesce((r->>'attendance')::int, 0), 0), 20),
        daily_work = least(greatest(coalesce((r->>'daily_work')::int, 0), 0), 25),
        task_assigned = least(greatest(coalesce((r->>'task_assigned')::int, 0), 0), 10),
        task_status = nullif(btrim(coalesce(r->>'task_status', '')), ''),
        form_submit = least(greatest(coalesce((r->>'form_submit')::int, 0), 0), 25),
        -- the reviewers' monthly marks are never cleared by the sheet
        monthly_review = coalesce(v_old.monthly_review,
                                  case when (r->>'monthly_review') ~ '^\d+$' then least((r->>'monthly_review')::int, 20) end),
        remarks = nullif(btrim(coalesce(r->>'remarks', '')), ''),
        source = 'sheet', sheet_submitted_at = v_at, updated_at = now()
      where id = v_old.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'kept_manual', v_kept,
                            'unchanged', v_same, 'unknown_sites', to_jsonb(v_unmatched));
end;
$$;

create or replace function public.tech_scores_sheet_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'tech_scores_sheet'), '{}'::jsonb);
$$;

revoke execute on function public.sync_tech_scores(jsonb), public.tech_scores_sheet_config() from public, anon, authenticated;
grant execute on function public.sync_tech_scores(jsonb), public.tech_scores_sheet_config() to service_role;
