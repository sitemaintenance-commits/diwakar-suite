-- =====================================================================
-- DAILY PROGRESS REPORT (DPR) FOR PROJECT SITES
--
-- The projects team reported each site's day on WhatsApp in a fixed
-- format: materials received, the running status of every activity
-- (survey, boundary wall, piling, ICR/IDT foundation, transmission line,
-- inverters, DC work, modules 936/5292, MMS tables...), today's work,
-- tomorrow's plan, notes, whether safety rules were followed, and photos.
-- The day-wise site update becomes that DPR:
--
--   * materials received (yes/no and the items)
--   * activities: the running work status, one line per activity with a
--     status, an optional done/total quantity and a note. A new DPR starts
--     from the site's previous one, or from the standard list
--     (setting dpr_activities) on a site's first day.
--   * tomorrow's plan, safety followed (yes/no and a note)
--   * photos: documents of the Site Updates module attached to the DPR.
--
-- Today's work stays work_description; notes stay remarks.
-- =====================================================================

alter table public.project_updates
  add column if not exists materials_received boolean,
  add column if not exists materials_items    text,
  add column if not exists activities         jsonb not null default '[]'::jsonb,
  add column if not exists tomorrow_plan      text,
  add column if not exists safety_followed    boolean,
  add column if not exists safety_note        text;

-- The standard activity list a site's first DPR starts from.
insert into public.app_settings (key, value)
values ('dpr_activities', '[
  {"name": "Topographical & contour survey"},
  {"name": "Ground clearance & levelling"},
  {"name": "Precast boundary wall"},
  {"name": "Main gate installation"},
  {"name": "Primary camera installation"},
  {"name": "Piling work"},
  {"name": "ICR foundation"},
  {"name": "IDT foundation"},
  {"name": "Transmission line"},
  {"name": "2 pole structure"},
  {"name": "4 pole structure"},
  {"name": "Inverter installation, earthing & termination"},
  {"name": "DC work"},
  {"name": "ICR & IDT (LT & HT)"},
  {"name": "Module installation", "unit": "Nos"},
  {"name": "MMS installation", "unit": "Tables"},
  {"name": "Fencing"},
  {"name": "Earthing"}
]'::jsonb)
on conflict (key) do nothing;

/** Clean an activity list: named lines only, a known status, numbers as numbers. */
create or replace function app.clean_dpr_activities(p jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'name', btrim(a->>'name'),
           'status', case when a->>'status' in ('not_started','in_progress','completed','on_hold') then a->>'status' else 'not_started' end,
           'done', case when (a->>'done') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (a->>'done')::numeric end,
           'total', case when (a->>'total') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then (a->>'total')::numeric end,
           'unit', nullif(btrim(coalesce(a->>'unit', '')), ''),
           'note', nullif(btrim(coalesce(a->>'note', '')), '')))
         order by ord), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as x(a, ord)
  where nullif(btrim(coalesce(a->>'name', '')), '') is not null;
$$;

-- ------------------------------------------------------- filing the DPR
drop function if exists public.save_project_update(uuid, date, jsonb, text, text, text, text);

create or replace function public.save_project_update(
  p_project_id uuid,
  p_date date,
  p_stages jsonb,                      -- the work fronts {tl_work, gss_bay, ...}
  p_work_description text default null,   -- today's work
  p_challenges text default null,
  p_remarks text default null,            -- general notes / observations
  p_engineer_name text default null,
  p_dpr jsonb default null)               -- {materials_received, materials_items, activities, tomorrow_plan, safety_followed, safety_note}
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_exists boolean;
  v_get text;
  v_dpr jsonb := coalesce(p_dpr, '{}'::jsonb);
begin
  if not app.is_active_user() then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot file a site update for a future date.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id and deleted_at is null) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select exists (select 1 from public.project_updates
                 where project_id = p_project_id and update_date = p_date and deleted_at is null)
    into v_exists;
  if v_exists then
    if not (app.has_perm('projects.updates', 'edit') or app.has_perm('projects.projects', 'edit')) then
      raise exception 'You do not have permission to change a filed site update.' using errcode = '42501';
    end if;
  elsif not (app.has_perm('projects.updates', 'create') or app.has_perm('projects.projects', 'create')) then
    raise exception 'You do not have permission to file site updates.' using errcode = '42501';
  end if;

  insert into public.project_updates
    (project_id, update_date, engineer_id, engineer_name,
     tl_work, gss_bay, piling, icr_civil, panel, module_work, inverter, material, cabling, electrical,
     work_description, challenges, remarks,
     materials_received, materials_items, activities, tomorrow_plan, safety_followed, safety_note, created_by)
  values (
    p_project_id, p_date, auth.uid(), nullif(trim(coalesce(p_engineer_name, '')), ''),
    coalesce(nullif(p_stages->>'tl_work', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'gss_bay', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'piling', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'icr_civil', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'panel', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'module_work', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'inverter', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'material', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'cabling', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'electrical', '')::public.work_task_status, 'not_started'),
    nullif(trim(coalesce(p_work_description, '')), ''),
    nullif(trim(coalesce(p_challenges, '')), ''),
    nullif(trim(coalesce(p_remarks, '')), ''),
    (v_dpr->>'materials_received')::boolean,
    nullif(trim(coalesce(v_dpr->>'materials_items', '')), ''),
    app.clean_dpr_activities(v_dpr->'activities'),
    nullif(trim(coalesce(v_dpr->>'tomorrow_plan', '')), ''),
    (v_dpr->>'safety_followed')::boolean,
    nullif(trim(coalesce(v_dpr->>'safety_note', '')), ''),
    auth.uid())
  on conflict (project_id, update_date) where deleted_at is null do update
    set tl_work = excluded.tl_work, gss_bay = excluded.gss_bay, piling = excluded.piling,
        icr_civil = excluded.icr_civil, panel = excluded.panel, module_work = excluded.module_work,
        inverter = excluded.inverter, material = excluded.material, cabling = excluded.cabling,
        electrical = excluded.electrical, work_description = excluded.work_description,
        challenges = excluded.challenges, remarks = excluded.remarks,
        materials_received = excluded.materials_received, materials_items = excluded.materials_items,
        activities = excluded.activities, tomorrow_plan = excluded.tomorrow_plan,
        safety_followed = excluded.safety_followed, safety_note = excluded.safety_note,
        engineer_name = coalesce(excluded.engineer_name, public.project_updates.engineer_name),
        updated_by = auth.uid(), updated_at = now()
  returning id into v_id;

  -- Keep the cached stage honest: the update is the site's own word.
  select case
    when p_stages->>'inverter' = 'completed' and p_stages->>'module_work' = 'completed' then 'commissioning'
    when p_stages->>'piling' = 'completed' or p_stages->>'panel' = 'in_progress' then 'installation'
    else null end into v_get;
  if v_get is not null then
    update public.projects
       set stage = v_get::public.project_stage
     where id = p_project_id and stage < v_get::public.project_stage;
  end if;

  return v_id;
end;
$$;

-- ------------------------------------------------------ reading the DPRs
create or replace function public.list_site_updates(
  p_from date default null,
  p_to date default null,
  p_project uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date := coalesce(p_to, v_today);
  v_from date := coalesce(p_from, v_to - 30);
begin
  if not app.is_active_user()
     or not (app.has_perm('projects.updates', 'view') or app.has_perm('projects.projects', 'view')) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_file', app.has_perm('projects.updates', 'create') or app.has_perm('projects.projects', 'create'),
    'can_edit', app.has_perm('projects.updates', 'edit') or app.has_perm('projects.projects', 'edit'),
    'activity_template', coalesce((select value from public.app_settings where key = 'dpr_activities'), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'stage', p.stage,
                                          'capacity_kwp', p.capacity_kwp, 'site', s.name)
                       order by (p.stage in ('commissioning','handover','closed')), p.name)
      from public.projects p left join public.sites s on s.id = p.site_id
      where p.deleted_at is null), '[]'::jsonb),
    -- Sites still being built that have no DPR for today.
    'missing_today', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name)
      from public.projects p
      where p.deleted_at is null and p.stage not in ('commissioning','handover','closed')
        and not exists (select 1 from public.project_updates u
                        where u.project_id = p.id and u.update_date = v_today and u.deleted_at is null)), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'project_id', u.project_id, 'project', p.name, 'update_date', u.update_date,
               'engineer_name', coalesce(u.engineer_name, (select f.full_name from public.profiles f where f.id = u.engineer_id)),
               'tl_work', u.tl_work, 'gss_bay', u.gss_bay, 'piling', u.piling, 'icr_civil', u.icr_civil,
               'panel', u.panel, 'module_work', u.module_work, 'inverter', u.inverter, 'material', u.material,
               'cabling', u.cabling, 'electrical', u.electrical,
               'work_description', u.work_description, 'challenges', u.challenges, 'remarks', u.remarks,
               'materials_received', u.materials_received, 'materials_items', u.materials_items,
               'activities', u.activities, 'tomorrow_plan', u.tomorrow_plan,
               'safety_followed', u.safety_followed, 'safety_note', u.safety_note,
               'photos', (select count(*) from public.documents d
                          where d.entity_type = 'project_update' and d.entity_id = u.id and d.deleted_at is null),
               'updated_at', u.updated_at)
             order by u.update_date desc, p.name)
      from public.project_updates u join public.projects p on p.id = u.project_id and p.deleted_at is null
      where u.deleted_at is null and u.update_date between v_from and v_to
        and (p_project is null or u.project_id = p_project)), '[]'::jsonb));
end;
$$;

grant execute on function public.list_site_updates(date, date, uuid) to authenticated;
revoke execute on function public.list_site_updates(date, date, uuid) from anon, public;
grant execute on function public.save_project_update(uuid, date, jsonb, text, text, text, text, jsonb) to authenticated;
revoke execute on function public.save_project_update(uuid, date, jsonb, text, text, text, text, jsonb) from anon, public;
