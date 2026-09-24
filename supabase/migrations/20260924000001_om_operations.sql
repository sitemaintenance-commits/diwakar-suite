-- =====================================================================
-- O&M SITE OPERATIONS
--
-- Replaces the "Site Operations" tab of the O&M CRM: the daily site
-- register a technician fills in at the plant — an administration
-- checklist, a patrol register by time slot, and a security checklist —
-- with the shift, urgency and a readiness percentage.
--
-- The three checklists are DATA (om_checklist_items), not code, so the
-- O&M head can add or retire a check point without a release. The 28
-- rows seeded below are exactly the ones the legacy tool asks for.
-- =====================================================================

create type public.ops_section as enum ('administration','patrol','security');
create type public.ops_shift   as enum ('day','night');
create type public.ops_urgency as enum ('normal','urgent','critical');
create type public.ops_check   as enum ('pending','ok','not_ok','na');

-- ---------------------------------------------------------------------
-- The checklist catalogue
-- ---------------------------------------------------------------------
create table public.om_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  section      public.ops_section not null,
  sort_order   int not null default 1,
  title        text not null,
  frequency    text,                    -- Daily / Weekly / Monthly / As Per Schedule
  scope_points text,                    -- what to look at
  responsible  text not null default 'Site Engineer',
  slot         text,                    -- patrol time, e.g. 08:00
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid
);
create index om_checklist_items_section_idx on public.om_checklist_items(section, sort_order);

-- ---------------------------------------------------------------------
-- The site O&M team (the legacy contact register and technician list)
-- ---------------------------------------------------------------------
create table public.om_team_members (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  full_name  text not null,
  role_title text not null default 'O&M Technician',
  mobile     text,
  email      text,
  is_lead    boolean not null default false,
  is_active  boolean not null default true,
  joined_on  date,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz
);
create index om_team_members_site_idx on public.om_team_members(site_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- One register per site, per day, per shift
-- ---------------------------------------------------------------------
create table public.om_site_logs (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites(id) on delete cascade,
  log_date        date not null default (now() at time zone 'Asia/Kolkata')::date,
  shift           public.ops_shift not null default 'day',
  technician_id   uuid references public.profiles(id) on delete set null,
  member_id       uuid references public.om_team_members(id) on delete set null,
  technician_name text,
  urgency         public.ops_urgency not null default 'normal',
  status          public.daily_report_status not null default 'draft',
  admin_done      int not null default 0,
  admin_total     int not null default 0,
  patrol_done     int not null default 0,
  patrol_total    int not null default 0,
  security_done   int not null default 0,
  security_total  int not null default 0,
  readiness       numeric(5,2) not null default 0,
  remarks         text,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz
);
create unique index om_site_logs_key_idx on public.om_site_logs(site_id, log_date, shift) where deleted_at is null;
create index om_site_logs_date_idx on public.om_site_logs(log_date desc);

create table public.om_site_log_entries (
  id         uuid primary key default gen_random_uuid(),
  log_id     uuid not null references public.om_site_logs(id) on delete cascade,
  item_id    uuid not null references public.om_checklist_items(id) on delete cascade,
  section    public.ops_section not null,
  status     public.ops_check not null default 'pending',
  remarks    text,
  checked_at timestamptz,
  unique (log_id, item_id)
);
create index om_site_log_entries_log_idx on public.om_site_log_entries(log_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select app.apply_standard_policies('om_site_logs', 'om.operations', 'site_id',
                                   array['created_by','technician_id']);
select app.apply_standard_policies('om_team_members', 'om.team', 'site_id', array['created_by']);

-- The catalogue is reference data: readable by anyone who may see the
-- register, changed only by someone who may edit the module.
alter table public.om_checklist_items enable row level security;
grant select, insert, update, delete on public.om_checklist_items to authenticated;
create policy checklist_select on public.om_checklist_items for select to authenticated
  using ((select app.has_any_perm(array['om.operations','om.team'], 'view')));
create policy checklist_insert on public.om_checklist_items for insert to authenticated
  with check ((select app.has_perm('om.operations', 'create')));
create policy checklist_update on public.om_checklist_items for update to authenticated
  using ((select app.has_perm('om.operations', 'edit'))) with check (true);
create policy checklist_delete on public.om_checklist_items for delete to authenticated
  using ((select app.has_perm('om.operations', 'delete')));
create trigger touch_row before update on public.om_checklist_items for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.om_checklist_items
  for each row execute function app.audit_row_change('om.operations');

-- Entries follow their register.
alter table public.om_site_log_entries enable row level security;
grant select, insert, update, delete on public.om_site_log_entries to authenticated;
create policy entries_select on public.om_site_log_entries for select to authenticated
  using (exists (select 1 from public.om_site_logs l where l.id = log_id));
create policy entries_insert on public.om_site_log_entries for insert to authenticated
  with check (exists (select 1 from public.om_site_logs l where l.id = log_id)
              and ((select app.has_perm('om.operations', 'create')) or (select app.has_perm('om.operations', 'edit'))));
create policy entries_update on public.om_site_log_entries for update to authenticated
  using (exists (select 1 from public.om_site_logs l where l.id = log_id)
         and (select app.has_perm('om.operations', 'edit'))) with check (true);
create policy entries_delete on public.om_site_log_entries for delete to authenticated
  using (exists (select 1 from public.om_site_logs l where l.id = log_id)
         and (select app.has_perm('om.operations', 'edit')));

-- ---------------------------------------------------------------------
-- A submitted register is the day's evidence: only someone who may
-- APPROVE the module can reopen or review it.
-- ---------------------------------------------------------------------
create or replace function app.guard_site_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status = 'submitted' and new.status = 'draft'
       and not app.has_perm('om.operations', 'approve') then
      raise exception 'A submitted site register can only be reopened by a supervisor.' using errcode = '42501';
    end if;
    if new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;
    if new.status in ('reviewed', 'returned') and not app.has_perm('om.operations', 'approve') then
      raise exception 'Reviewing a site register requires the APPROVE permission.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_workflow before insert or update on public.om_site_logs
  for each row execute function app.guard_site_log();

-- =====================================================================
-- The register, self-authorising (same pattern as the daily field form):
-- a technician needs om.operations and the site, nothing wider.
-- =====================================================================
create or replace function public.get_site_ops(
  p_date date default null,
  p_site_id uuid default null,
  p_shift public.ops_shift default 'day')
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_sites uuid[] := app.my_site_ids();
  v_site uuid := p_site_id;
  v_log public.om_site_logs;
begin
  if not app.has_perm('om.operations', 'view') then
    raise exception 'Access denied: om.operations VIEW permission required.' using errcode = '42501';
  end if;
  if v_site is not null and not (v_site = any (v_sites)) then
    raise exception 'You are not assigned to this site.' using errcode = '42501';
  end if;

  select * into v_log from public.om_site_logs
  where site_id = v_site and log_date = v_date and shift = p_shift and deleted_at is null;

  return jsonb_build_object(
    'date', v_date,
    'shift', p_shift,
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object('site_id', s.id, 'name', s.name,
                                          'location', coalesce(s.district, s.location))
                       order by s.name)
      from public.sites s where s.status = 'active' and s.id = any (v_sites)), '[]'::jsonb),
    'technicians', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.full_name, 'site_id', t.site_id,
                                          'role', t.role_title, 'mobile', t.mobile)
                       order by t.full_name)
      from public.om_team_members t
      where t.deleted_at is null and t.is_active
        and (v_site is null or t.site_id = v_site)
        and t.site_id = any (v_sites)), '[]'::jsonb),
    'checklist', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'section', i.section, 'sort_order', i.sort_order, 'title', i.title,
               'frequency', i.frequency, 'scope_points', i.scope_points,
               'responsible', i.responsible, 'slot', i.slot)
             order by i.section, i.sort_order)
      from public.om_checklist_items i where i.is_active), '[]'::jsonb),
    'log', case when v_log.id is null then null else jsonb_build_object(
             'id', v_log.id, 'status', v_log.status, 'urgency', v_log.urgency,
             'technician_name', v_log.technician_name, 'member_id', v_log.member_id,
             'readiness', v_log.readiness, 'remarks', v_log.remarks,
             'submitted_at', v_log.submitted_at,
             'admin_done', v_log.admin_done, 'patrol_done', v_log.patrol_done,
             'security_done', v_log.security_done) end,
    'entries', coalesce((
      select jsonb_object_agg(e.item_id::text, jsonb_build_object('status', e.status, 'remarks', e.remarks))
      from public.om_site_log_entries e where e.log_id = v_log.id), '{}'::jsonb));
end;
$$;

create or replace function public.save_site_ops(
  p_site_id uuid,
  p_date date,
  p_shift public.ops_shift,
  p_entries jsonb,                                  -- [{item_id, status, remarks}]
  p_technician_name text default null,
  p_member_id uuid default null,
  p_urgency public.ops_urgency default 'normal',
  p_remarks text default null,
  p_submit boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.daily_report_status;
  v_counts record;
  v_ready numeric(5,2);
begin
  if p_site_id is null or p_date is null then
    raise exception 'Site and date are required.' using errcode = '22023';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot fill the register for a future date.' using errcode = '22023';
  end if;
  if not app.can_access_site(p_site_id) then
    raise exception 'You are not assigned to this site.' using errcode = '42501';
  end if;

  select id, status into v_id, v_status from public.om_site_logs
  where site_id = p_site_id and log_date = p_date and shift = p_shift and deleted_at is null;

  if v_id is null then
    if not app.has_perm('om.operations', 'create') then
      raise exception 'You do not have permission to fill the site register.' using errcode = '42501';
    end if;
    insert into public.om_site_logs (site_id, log_date, shift, technician_id, member_id,
                                     technician_name, urgency, remarks, created_by)
    values (p_site_id, p_date, p_shift, auth.uid(), p_member_id,
            nullif(trim(coalesce(p_technician_name, '')), ''), coalesce(p_urgency, 'normal'),
            nullif(trim(coalesce(p_remarks, '')), ''), auth.uid())
    returning id into v_id;
  else
    if not app.has_perm('om.operations', 'edit') then
      raise exception 'You do not have permission to change a saved register.' using errcode = '42501';
    end if;
    if v_status = 'submitted' and not app.has_perm('om.operations', 'approve') then
      raise exception 'This register is already submitted. Ask a supervisor to reopen it.' using errcode = '42501';
    end if;
    update public.om_site_logs
       set member_id = coalesce(p_member_id, member_id),
           technician_name = coalesce(nullif(trim(coalesce(p_technician_name, '')), ''), technician_name),
           urgency = coalesce(p_urgency, urgency),
           remarks = nullif(trim(coalesce(p_remarks, '')), ''),
           updated_by = auth.uid()
     where id = v_id;
  end if;

  -- Record the answers we were given; points not sent keep their value.
  insert into public.om_site_log_entries (log_id, item_id, section, status, remarks, checked_at)
  select v_id, i.id, i.section,
         coalesce(nullif(e.status, '')::public.ops_check, 'pending'),
         nullif(trim(coalesce(e.remarks, '')), ''), now()
  from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) e(item_id uuid, status text, remarks text)
  join public.om_checklist_items i on i.id = e.item_id and i.is_active
  on conflict (log_id, item_id) do update
    set status = excluded.status, remarks = excluded.remarks, checked_at = now();

  select count(*) filter (where section = 'administration') as at,
         count(*) filter (where section = 'administration' and status = 'ok') as ad,
         count(*) filter (where section = 'patrol') as pt,
         count(*) filter (where section = 'patrol' and status = 'ok') as pd,
         count(*) filter (where section = 'security') as st,
         count(*) filter (where section = 'security' and status = 'ok') as sd,
         count(*) as total,
         count(*) filter (where status = 'ok') as done
    into v_counts
  from public.om_site_log_entries where log_id = v_id;

  v_ready := case when v_counts.total = 0 then 0
                  else round((v_counts.done::numeric / v_counts.total) * 100, 2) end;

  update public.om_site_logs
     set admin_done = v_counts.ad, admin_total = v_counts.at,
         patrol_done = v_counts.pd, patrol_total = v_counts.pt,
         security_done = v_counts.sd, security_total = v_counts.st,
         readiness = v_ready,
         status = case when p_submit then 'submitted'::public.daily_report_status else status end
   where id = v_id;

  return jsonb_build_object('id', v_id, 'readiness', v_ready,
                            'admin_done', v_counts.ad, 'patrol_done', v_counts.pd,
                            'security_done', v_counts.sd, 'submitted', coalesce(p_submit, false));
end;
$$;

-- The supervisor view: who filled what, and every point still not OK.
create or replace function public.get_site_ops_summary(
  p_from date default null,
  p_to date default null,
  p_site_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from date := coalesce(p_from, v_to - 6);
  v_sites uuid[] := app.my_site_ids();
  -- SECURITY DEFINER bypasses RLS, so the data scope of the permission
  -- (own / team / all) has to be applied here by hand.
  v_scope public.perm_scope := app.perm_scope('om.operations', 'view');
  v_me uuid := auth.uid();
  v_team uuid[] := app.my_team_ids();
begin
  if not app.has_perm('om.operations', 'view') then
    raise exception 'Access denied: om.operations VIEW permission required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'submitted', (select count(*) from public.om_site_logs l
                  where l.deleted_at is null and l.log_date between v_from and v_to
                    and l.site_id = any (v_sites) and (p_site_id is null or l.site_id = p_site_id)
                    and l.status <> 'draft'
                    and app.in_scope(v_scope, array[l.created_by, l.technician_id]::uuid[], v_me, v_team)),
    'avg_readiness', coalesce((select round(avg(l.readiness), 1) from public.om_site_logs l
                  where l.deleted_at is null and l.log_date between v_from and v_to
                    and l.site_id = any (v_sites) and (p_site_id is null or l.site_id = p_site_id)
                    and l.status <> 'draft'), 0),
    'open_points', (select count(*) from public.om_site_log_entries e
                    join public.om_site_logs l on l.id = e.log_id
                    where l.deleted_at is null and l.log_date between v_from and v_to
                      and l.site_id = any (v_sites) and (p_site_id is null or l.site_id = p_site_id)
                      and e.status = 'not_ok'
                      and app.in_scope(v_scope, array[l.created_by, l.technician_id]::uuid[], v_me, v_team)),
    'logs', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'id', l.id, 'log_date', l.log_date, 'site', s.name, 'site_id', l.site_id,
                 'shift', l.shift, 'technician', coalesce(l.technician_name, p.full_name),
                 'urgency', l.urgency, 'status', l.status, 'readiness', l.readiness,
                 'admin', l.admin_done || '/' || l.admin_total,
                 'patrol', l.patrol_done || '/' || l.patrol_total,
                 'security', l.security_done || '/' || l.security_total,
                 'remarks', l.remarks,
                 'issues', coalesce((select jsonb_agg(i.title order by i.section, i.sort_order)
                                     from public.om_site_log_entries e
                                     join public.om_checklist_items i on i.id = e.item_id
                                     where e.log_id = l.id and e.status = 'not_ok'), '[]'::jsonb)) x
        from public.om_site_logs l
        join public.sites s on s.id = l.site_id
        left join public.profiles p on p.id = l.technician_id
        where l.deleted_at is null and l.log_date between v_from and v_to
          and l.site_id = any (v_sites) and (p_site_id is null or l.site_id = p_site_id)
          and app.in_scope(v_scope, array[l.created_by, l.technician_id]::uuid[], v_me, v_team)
        order by l.log_date desc, s.name
        limit 400) q), '[]'::jsonb));
end;
$$;

grant execute on function public.get_site_ops(date, uuid, public.ops_shift) to authenticated;
grant execute on function public.save_site_ops(uuid, date, public.ops_shift, jsonb, text, uuid,
                                               public.ops_urgency, text, boolean) to authenticated;
grant execute on function public.get_site_ops_summary(date, date, uuid) to authenticated;
revoke execute on function public.get_site_ops(date, uuid, public.ops_shift),
                        public.save_site_ops(uuid, date, public.ops_shift, jsonb, text, uuid,
                                             public.ops_urgency, text, boolean),
                        public.get_site_ops_summary(date, date, uuid) from anon, public;

-- ---------------------------------------------------------------------
-- The 28 check points, exactly as the site register asks for them.
-- ---------------------------------------------------------------------
insert into public.om_checklist_items (section, sort_order, title, frequency, scope_points, responsible) values
  ('administration', 1, 'Site Administration',        'Daily',                 'Site office, records, attendance, housekeeping',              'Site Engineer'),
  ('administration', 2, 'Housekeeping',               'Daily',                 'Office, control room, toilets, stores and common areas',      'Site Engineer'),
  ('administration', 3, 'Vegetation & Site Cleaning', 'Monthly / As Required', 'Grass, bushes, drains, roads and module-area housekeeping',   'Site Engineer'),
  ('administration', 4, 'Module Cleaning Coordination','As Per Schedule',      'Coordinate manpower, water, equipment and cleaning records',  'Site Engineer'),
  ('administration', 5, 'Labour & Attendance',        'Daily',                 'Contract labour attendance, deployment and overtime',         'Site Engineer'),
  ('administration', 6, 'Backup Systems',             'Weekly',                'Fuel, running hours, service records and readiness',          'Site Engineer'),
  ('administration', 7, 'Roads, Fencing & Civil Works','Monthly',              'Fencing, gates, roads, drains, foundations and minor repairs','Site Engineer'),
  ('administration', 8, 'Office & Communication',     'Weekly',                'Internet, phones, camera, radios and office equipment',       'Site Engineer');

insert into public.om_checklist_items (section, sort_order, title, slot, frequency, scope_points, responsible) values
  ('patrol', 1, 'Boundary',         '08:00', 'Daily', 'Walk the perimeter, fencing and approach road', 'Technician'),
  ('patrol', 2, 'Panel Area',       '10:00', 'Daily', 'Module rows, structures, string cabling',       'Technician'),
  ('patrol', 3, 'Cable Route',      '12:00', 'Daily', 'Trenches, covers, joints and markers',          'Technician'),
  ('patrol', 4, 'Transformer Area', '14:00', 'Daily', 'Transformer yard, oil level, earthing',         'Technician'),
  ('patrol', 5, 'Boundary',         '16:00', 'Daily', 'Walk the perimeter, fencing and approach road', 'Technician'),
  ('patrol', 6, 'Main Gate',        '18:00', 'Daily', 'Gate, lock, visitor entries and lighting',      'Technician'),
  ('patrol', 7, 'Panel Area',       '20:00', 'Daily', 'Module rows, structures, string cabling',       'Technician'),
  ('patrol', 8, 'Boundary',         '22:00', 'Daily', 'Walk the perimeter, fencing and approach road', 'Technician');

insert into public.om_checklist_items (section, sort_order, title, frequency, scope_points, responsible) values
  ('security',  1, 'Boundary Fencing', 'Daily', 'Daily check point', 'Technician'),
  ('security',  2, 'Gate / Lock',      'Daily', 'Daily check point', 'Technician'),
  ('security',  3, 'CCTV Working',     'Daily', 'Daily check point', 'Technician'),
  ('security',  4, 'CCTV Recording',   'Daily', 'Daily check point', 'Technician'),
  ('security',  5, 'Security Lights',  'Daily', 'Daily check point', 'Technician'),
  ('security',  6, 'Panel Condition',  'Daily', 'Daily check point', 'Technician'),
  ('security',  7, 'Cable Route',      'Daily', 'Daily check point', 'Technician'),
  ('security',  8, 'Transformer Area', 'Daily', 'Daily check point', 'Technician'),
  ('security',  9, 'Inverter Room',    'Daily', 'Daily check point', 'Technician'),
  ('security', 10, 'Store Security',   'Daily', 'Daily check point', 'Technician'),
  ('security', 11, 'Fire Equipment',   'Daily', 'Daily check point', 'Technician'),
  ('security', 12, 'Visitor Register', 'Daily', 'Daily check point', 'Technician');

-- ---------------------------------------------------------------------
-- The O&M team at each site, from the existing contact register.
-- Phone numbers are the ones already published in the O&M CRM.
-- ---------------------------------------------------------------------
insert into public.om_team_members (site_id, full_name, mobile)
select s.id, t.full_name, t.mobile
from (values
  ('Bassi',       'Sandeep Choudhary',      '9799751668'),
  ('Bassi',       'Govind Saini',           '8094985817'),
  ('Budhwara',    'Mahendra Singh Meena',   '9636092459'),
  ('Budhwara',    'Hemraj Chouhan',         '9929243127'),
  ('Sadas',       'Ramjan Hussain',         '9001329103'),
  ('Sadas',       'Komal',                  '8905754528'),
  ('Jerthi',      'Pramod Kumar',           '9314456962'),
  ('Jerthi',      'Mukesh Kajala',          '8905095866'),
  ('Kadel',       'Nandkishor Kumawat',     '8005760738'),
  ('Kadel',       'Chetan Singh',           '8905543083'),
  ('Budsu',       'Nirmal Kumar',           '7851837003'),
  ('Budsu',       'Sandeep Ghotiya',        '7023559814'),
  ('Suaap',       'Sajan Upadhyay',         '9829821991'),
  ('Suaap',       'Surendra Singh',         '8696492412'),
  ('Niwai',       'Shiv Kushwah',           '9887389688'),
  ('Niwai',       'Pankaj Kumar',           '7014928940'),
  ('Ganeshgarh',  'Manoj Kumar Rai',        '9509239209'),
  ('Ganeshgarh',  'Onkar Jot Singh',        '7014928940'),
  ('Thikariya',   'Mahendra Singh Kantava', '7688828317'),
  ('Thikariya',   'Sanwar Yadav',           '9024182663'),
  ('Indo Ka Bas', 'Sona Ram',               '8209660747')
) as t(site_name, full_name, mobile)
join public.sites s on s.name = t.site_name;

-- ---------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, m.key, m.label, m.description, m.route, m.icon, m.sort_order,
       m.actions::public.perm_action[], m.scope, true, true, true, 4
from public.module_groups g,
     (values
       ('om.operations', 'Site Operations', 'Daily site administration, patrol and security register',
        '/operations/site-operations', 'ShieldCheck', 55, '{view,create,edit,delete,export,approve}', true),
       ('om.team', 'Site Teams', 'O&M team members and the site contact register',
        '/operations/site-teams', 'Users', 75, '{view,create,edit,delete,export}', true)
     ) as m(key, label, description, route, icon, sort_order, actions, scope)
where g.key = 'operations'
on conflict (key) do nothing;

do $$
declare
  v_ops  uuid := (select id from public.modules where key = 'om.operations');
  v_team uuid := (select id from public.modules where key = 'om.team');
begin
  -- Technicians fill the register for their own site. They get no
  -- om.team permission: get_site_ops() hands the form the roster for
  -- their site, so the menu stays down to the jobs they actually do.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_ops, a, 'all'                 -- "all" still means their sites only
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key = 'technician'
  on conflict do nothing;

  -- The O&M head and administrators run both modules.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m, a, 'all'
  from public.roles r,
       unnest(array[v_ops, v_team]) m,
       unnest(array['view','create','edit','delete','export']::public.perm_action[]) a
  where r.key in ('om_manager', 'admin')
  on conflict do nothing;

  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_ops, 'approve', 'all' from public.roles r where r.key in ('om_manager', 'admin')
  on conflict do nothing;

  -- Management reads and exports.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m, a, 'all'
  from public.roles r, unnest(array[v_ops, v_team]) m,
       unnest(array['view','export']::public.perm_action[]) a
  where r.key = 'management'
  on conflict do nothing;
end $$;
