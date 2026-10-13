-- =====================================================================
-- OTHER SPELLINGS OF A TECHNICIAN'S NAME
--
-- Technicians type their names in the daily form in many ways ("RAMJAN",
-- "Ramjan HUSAN" for Ramjan Hussain; "Onkarjot" for Onkar Jot Singh). Each
-- site team member can now carry the other spellings in use, and the form
-- sync matches them, so one person keeps one line in Team Performance.
-- =====================================================================

create table if not exists public.om_member_aliases (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.om_team_members(id) on delete cascade,
  alias      text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index if not exists om_member_aliases_alias_idx on public.om_member_aliases (lower(btrim(alias)));

alter table public.om_member_aliases enable row level security;
grant select, insert, delete on public.om_member_aliases to authenticated;
drop policy if exists aliases_read on public.om_member_aliases;
create policy aliases_read on public.om_member_aliases for select to authenticated
  using ((select app.has_perm('om.team', 'view')) or (select app.has_perm('om.performance', 'view')));
drop policy if exists aliases_write on public.om_member_aliases;
create policy aliases_write on public.om_member_aliases for insert to authenticated
  with check ((select app.has_perm('om.team', 'edit')));
drop policy if exists aliases_delete on public.om_member_aliases;
create policy aliases_delete on public.om_member_aliases for delete to authenticated
  using ((select app.has_perm('om.team', 'edit')));

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
    -- by the member's name, or by another spelling recorded for them (om_member_aliases)
    select tm.id, tm.user_id, tm.full_name into m
    from public.om_team_members tm
    where tm.deleted_at is null
      and (lower(btrim(tm.full_name)) = lower(v_name)
           or exists (select 1 from public.om_member_aliases al
                      where al.member_id = tm.id and lower(btrim(al.alias)) = lower(v_name)))
    order by (tm.site_id = v_site) desc, (lower(btrim(tm.full_name)) = lower(v_name)) desc, tm.is_active desc
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

