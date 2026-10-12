-- =====================================================================
-- PROJECT SITE UPDATES FROM THE ENGINEERS' GOOGLE FORM
--
-- The site engineers fill a Google Form whose answers land in a sheet
-- (date, site, engineer, the status of each work front, today's work,
-- challenges, remarks). The sheet-sync function reads it every 30 minutes
-- with the O&M sheets and saves each project's day as its site update
-- (DPR), so it shows in Projects -> Site Updates, the project page, the
-- dashboard and the reports.
--
--   * One update per project and day; the latest answer for a day wins.
--   * A work front left blank keeps the project's last reported status.
--   * A day filed or edited in the suite (source 'app') is never
--     overwritten; a day from the sheet (source 'sheet') follows later
--     answers. Any change made outside the sync marks the day 'app'.
--   * An answer whose work description is just "test" is ignored.
-- The sheet's address lives in setting project_updates_sheet.
-- =====================================================================

alter table public.project_updates
  add column if not exists source text,
  add column if not exists sheet_submitted_at timestamptz;

insert into public.app_settings (key, value)
values ('project_updates_sheet', '{"sheet_id": null, "gid": null}'::jsonb)
on conflict (key) do nothing;

/** A day written by anything but the sheet sync belongs to the suite. */
create or replace function app.mark_project_update_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.sheet_sync', true), '') <> 'on' then
    new.source := 'app';
  end if;
  return new;
end;
$$;

drop trigger if exists mark_source on public.project_updates;
create trigger mark_source before insert or update on public.project_updates
  for each row execute function app.mark_project_update_source();

/**
 * Row: {site, date, submitted_at, engineer, fronts: {tl_work, gss_bay, piling,
 * icr_civil, panel, module_work, inverter, material, cabling, electrical},
 * work, challenges, remarks}. Called with the service key only.
 */
create or replace function public.sync_project_updates(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_project uuid;
  v_date date;
  v_at timestamptz;
  v_old record;
  v_prev record;
  v_fronts jsonb;
  k text;
  v_added int := 0; v_updated int := 0; v_kept int := 0; v_same int := 0; v_skipped int := 0;
  v_unmatched text[] := '{}';
begin
  perform set_config('app.sheet_sync', 'on', true);

  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
           order by (x->>'date')::date, (x->>'submitted_at')::timestamptz nulls first loop
    v_date := nullif(r->>'date', '')::date;
    v_at := nullif(r->>'submitted_at', '')::timestamptz;
    if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date
       or lower(btrim(coalesce(r->>'work', ''))) in ('test', 'testing') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- The project: by its plant (sites.name) or by the start of its own name.
    select p.id into v_project
    from public.projects p left join public.sites s on s.id = p.site_id
    where p.deleted_at is null
      and (lower(s.name) = lower(btrim(r->>'site')) or lower(p.name) like lower(btrim(r->>'site')) || '%')
    order by (lower(s.name) = lower(btrim(r->>'site'))) desc nulls last, p.created_at
    limit 1;
    if v_project is null then
      if not (r->>'site' = any (v_unmatched)) then v_unmatched := array_append(v_unmatched, r->>'site'); end if;
      continue;
    end if;

    select u.id, u.source, u.sheet_submitted_at into v_old
    from public.project_updates u where u.project_id = v_project and u.update_date = v_date and u.deleted_at is null;
    if v_old.id is not null and coalesce(v_old.source, 'app') <> 'sheet' then
      v_kept := v_kept + 1;
      continue;
    end if;
    if v_old.id is not null and v_old.sheet_submitted_at is not null and v_at is not null and v_old.sheet_submitted_at >= v_at then
      v_same := v_same + 1;
      continue;
    end if;

    -- A front left blank keeps the project's last reported status.
    select * into v_prev from public.project_updates u
    where u.project_id = v_project and u.update_date < v_date and u.deleted_at is null
    order by u.update_date desc limit 1;
    v_fronts := '{}'::jsonb;
    foreach k in array array['tl_work','gss_bay','piling','icr_civil','panel','module_work','inverter','material','cabling','electrical'] loop
      v_fronts := v_fronts || jsonb_build_object(k, coalesce(
        nullif(r->'fronts'->>k, ''),
        case when v_prev.id is not null then to_jsonb(v_prev)->>k end,
        'not_started'));
    end loop;

    insert into public.project_updates
      (project_id, update_date, engineer_name,
       tl_work, gss_bay, piling, icr_civil, panel, module_work, inverter, material, cabling, electrical,
       work_description, challenges, remarks, source, sheet_submitted_at)
    values (v_project, v_date, nullif(btrim(coalesce(r->>'engineer', '')), ''),
       (v_fronts->>'tl_work')::public.work_task_status, (v_fronts->>'gss_bay')::public.work_task_status,
       (v_fronts->>'piling')::public.work_task_status, (v_fronts->>'icr_civil')::public.work_task_status,
       (v_fronts->>'panel')::public.work_task_status, (v_fronts->>'module_work')::public.work_task_status,
       (v_fronts->>'inverter')::public.work_task_status, (v_fronts->>'material')::public.work_task_status,
       (v_fronts->>'cabling')::public.work_task_status, (v_fronts->>'electrical')::public.work_task_status,
       nullif(btrim(coalesce(r->>'work', '')), ''), nullif(btrim(coalesce(r->>'challenges', '')), ''),
       nullif(btrim(coalesce(r->>'remarks', '')), ''), 'sheet', v_at)
    on conflict (project_id, update_date) where deleted_at is null do update
      set engineer_name = excluded.engineer_name,
          tl_work = excluded.tl_work, gss_bay = excluded.gss_bay, piling = excluded.piling, icr_civil = excluded.icr_civil,
          panel = excluded.panel, module_work = excluded.module_work, inverter = excluded.inverter,
          material = excluded.material, cabling = excluded.cabling, electrical = excluded.electrical,
          work_description = excluded.work_description, challenges = excluded.challenges, remarks = excluded.remarks,
          source = 'sheet', sheet_submitted_at = excluded.sheet_submitted_at, updated_at = now()
      where public.project_updates.source = 'sheet';
    if v_old.id is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'kept_suite_version', v_kept,
                            'unchanged', v_same, 'skipped', v_skipped, 'unknown_sites', to_jsonb(v_unmatched));
end;
$$;

create or replace function public.project_updates_sheet_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'project_updates_sheet'), '{}'::jsonb);
$$;

revoke execute on function public.sync_project_updates(jsonb), public.project_updates_sheet_config() from public, anon, authenticated;
grant execute on function public.sync_project_updates(jsonb), public.project_updates_sheet_config() to service_role;
