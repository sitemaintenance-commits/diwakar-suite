-- =====================================================================
-- PROJECT SITE UPDATES -- replaces the Project CRM's Google Form
--
-- The old Project CRM collected the site engineer's day-wise update with a
-- Google Form and listed every site's answers on a Daily Updates tab. The
-- suite already keeps those updates per project; this adds what the form
-- had and the suite lacked:
--
--   * Three more work fronts the form asked about: ICR civil, cabling and
--     electrical connection.
--   * Site Updates, a page under Projects: file the day's update for any
--     site, and read every site's updates by date.
--   * A Site Engineer role that files and reads site updates only.
--   * The Project Manager role reaches every project. Its plan, materials,
--     approvals and bills were "own" -- rows the person created -- so a
--     project manager could not see work the team or an import recorded.
-- =====================================================================

alter table public.project_updates
  add column if not exists icr_civil  public.work_task_status not null default 'not_started',
  add column if not exists cabling    public.work_task_status not null default 'not_started',
  add column if not exists electrical public.work_task_status not null default 'not_started';

-- ------------------------------------------------------------- the page
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select m.group_id, 'projects.updates', 'Site Updates',
       'The site engineer''s day-wise update: where each work front stands, the work done and the challenges',
       '/projects/updates', 'ClipboardCheck', 10, '{view,create,edit,export}', false, false, true, true, m.phase
from public.modules m where m.key = 'projects.projects'
on conflict (key) do nothing;
-- Projects first, Site Updates right after it.
update public.modules set sort_order = 9 where key = 'projects.projects';

insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, g.action::public.perm_action, 'all'
from public.roles r
join (values
  ('admin', 'view'), ('admin', 'create'), ('admin', 'edit'), ('admin', 'export'),
  ('management', 'view'), ('management', 'export'),
  ('project_manager', 'view'), ('project_manager', 'create'), ('project_manager', 'edit'), ('project_manager', 'export')
) as g(role, action) on g.role = r.key
cross join public.modules m
where m.key = 'projects.updates'
on conflict (role_id, module_id, action) do nothing;

-- -------------------------------------------------- the Site Engineer role
insert into public.roles (key, name, description, is_system)
values ('site_engineer', 'Site Engineer',
        'Files the day-wise site update for project sites and reads every site''s updates.', false)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, g.action::public.perm_action, g.scope::public.perm_scope
from public.roles r
cross join (values
  ('dashboard', 'view', 'all'), ('documents', 'view', 'all'),
  ('projects.updates', 'view', 'all'), ('projects.updates', 'create', 'all'),
  ('projects.updates', 'edit', 'all'), ('projects.updates', 'export', 'all'),
  ('approvals', 'view', 'own'), ('approvals', 'create', 'own')
) as g(module, action, scope)
join public.modules m on m.key = g.module and g.action::public.perm_action = any (m.supported_actions)
where r.key = 'site_engineer'
on conflict (role_id, module_id, action) do nothing;

-- ------------------------------------- the Project Manager reaches every project
update public.role_permissions rp
   set scope = 'all'
  from public.roles r, public.modules m
 where rp.role_id = r.id and rp.module_id = m.id
   and r.key = 'project_manager' and m.key like 'projects.%' and rp.scope <> 'all';

-- ------------------------------------------------------- filing an update
create or replace function public.save_project_update(
  p_project_id uuid,
  p_date date,
  p_stages jsonb,                      -- {tl_work, gss_bay, piling, icr_civil, panel, module_work, inverter, material, cabling, electrical}
  p_work_description text default null,
  p_challenges text default null,
  p_remarks text default null,
  p_engineer_name text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_exists boolean;
  v_get text;
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
     work_description, challenges, remarks, created_by)
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
    auth.uid())
  on conflict (project_id, update_date) where deleted_at is null do update
    set tl_work = excluded.tl_work, gss_bay = excluded.gss_bay, piling = excluded.piling,
        icr_civil = excluded.icr_civil, panel = excluded.panel, module_work = excluded.module_work,
        inverter = excluded.inverter, material = excluded.material, cabling = excluded.cabling,
        electrical = excluded.electrical, work_description = excluded.work_description,
        challenges = excluded.challenges, remarks = excluded.remarks,
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

-- ------------------------------------------------------ reading updates
/** Every site's updates for a period (optionally one project), and the
 *  projects an update can be filed for. */
create or replace function public.list_site_updates(
  p_from date default null,
  p_to date default null,
  p_project uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, v_to - 30);
begin
  if not app.is_active_user()
     or not (app.has_perm('projects.updates', 'view') or app.has_perm('projects.projects', 'view')) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_file', app.has_perm('projects.updates', 'create') or app.has_perm('projects.projects', 'create'),
    'can_edit', app.has_perm('projects.updates', 'edit') or app.has_perm('projects.projects', 'edit'),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'stage', p.stage,
                                          'capacity_kwp', p.capacity_kwp, 'site', s.name)
                       order by (p.stage in ('commissioning','handover','closed')), p.name)
      from public.projects p left join public.sites s on s.id = p.site_id
      where p.deleted_at is null), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'project_id', u.project_id, 'project', p.name, 'update_date', u.update_date,
               'engineer_name', coalesce(u.engineer_name, (select f.full_name from public.profiles f where f.id = u.engineer_id)),
               'tl_work', u.tl_work, 'gss_bay', u.gss_bay, 'piling', u.piling, 'icr_civil', u.icr_civil,
               'panel', u.panel, 'module_work', u.module_work, 'inverter', u.inverter, 'material', u.material,
               'cabling', u.cabling, 'electrical', u.electrical,
               'work_description', u.work_description, 'challenges', u.challenges, 'remarks', u.remarks,
               'updated_at', u.updated_at)
             order by u.update_date desc, p.name)
      from public.project_updates u join public.projects p on p.id = u.project_id and p.deleted_at is null
      where u.deleted_at is null and u.update_date between v_from and v_to
        and (p_project is null or u.project_id = p_project)), '[]'::jsonb));
end;
$$;

grant execute on function public.list_site_updates(date, date, uuid) to authenticated;
revoke execute on function public.list_site_updates(date, date, uuid) from anon, public;
grant execute on function public.save_project_update(uuid, date, jsonb, text, text, text, text) to authenticated;
revoke execute on function public.save_project_update(uuid, date, jsonb, text, text, text, text) from anon, public;
