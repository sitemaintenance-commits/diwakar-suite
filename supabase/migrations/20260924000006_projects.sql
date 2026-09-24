-- =====================================================================
-- PHASE 3 — PROJECTS (the Project CRM)
--
-- Replaces diwakar-solar-project-crm tab for tab:
--
--   Dashboard                → get_project_dashboard()
--   Project Sites            → projects
--   Daily Updates            → project_updates (the site engineer's form)
--   Templates                → project_templates + template tasks
--   Tasks                    → project_tasks, created by applying a template
--   Approvals                → project_approvals (DISCOM, CEIG, net metering…)
--   Materials                → project_materials
--   Vendors                  → vendors
--   Vendor Payment Approval  → vendor_bills, with the two-step approval the
--                              legacy app describes (PM, then accounts)
--
-- Client money lives in client_payments so "Client Outstanding" on the
-- dashboard is a fact rather than a number someone types.
-- =====================================================================

create type public.project_stage    as enum ('design','approvals','procurement','installation','testing','commissioning','handover','closed');
create type public.project_segment  as enum ('residential','commercial','industrial','government');
create type public.project_type     as enum ('ground_mount','rooftop','carport','street_light','hybrid','other');
create type public.approval_status  as enum ('not_started','applied','under_review','approved','rejected');
create type public.material_status  as enum ('pending','ordered','dispatched','at_site','shortage','installed');
create type public.vendor_status    as enum ('active','inactive','blacklisted');
create type public.bill_status      as enum ('submitted','pm_approved','accounts_approved','paid','rejected');
create type public.client_pay_status as enum ('pending','invoiced','part_received','received');

-- ---------------------------------------------------------------------
-- Project master
-- ---------------------------------------------------------------------
create sequence public.project_code_seq start 1;

create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  project_code         text not null unique default ('PRJ-' || lpad(nextval('public.project_code_seq')::text, 4, '0')),
  name                 text not null,
  site_id              uuid references public.sites(id) on delete set null,
  tender_id            uuid references public.tenders(id) on delete set null,
  client_name          text,
  segment              public.project_segment not null default 'commercial',
  project_type         public.project_type not null default 'ground_mount',
  capacity_kwp         numeric(12,3) not null default 0 check (capacity_kwp >= 0),
  capacity_ac_kw       numeric(12,3) not null default 0 check (capacity_ac_kw >= 0),
  stage                public.project_stage not null default 'design',
  contract_value       numeric(14,2) not null default 0 check (contract_value >= 0),
  start_date           date,
  target_commissioning date,
  actual_commissioning date,
  project_manager_id   uuid references public.profiles(id) on delete set null,
  site_engineer_id     uuid references public.profiles(id) on delete set null,
  district             text,
  state                text,
  address              text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_by           uuid,
  deleted_at           timestamptz
);
create index projects_stage_idx on public.projects(stage) where deleted_at is null;
create index projects_site_idx on public.projects(site_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Reusable execution plans
-- ---------------------------------------------------------------------
create table public.project_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  segment     public.project_segment,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  deleted_at  timestamptz
);

create table public.project_template_tasks (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.project_templates(id) on delete cascade,
  sort_order  int not null default 1,
  title       text not null,
  stage       public.project_stage not null default 'design',
  day_offset  int not null default 0,          -- days after the project start date
  notes       text
);
create index project_template_tasks_parent_idx on public.project_template_tasks(template_id, sort_order);

create table public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  stage        public.project_stage not null default 'design',
  assigned_to  uuid references public.profiles(id) on delete set null,
  due_date     date,
  status       public.task_status not null default 'todo',
  completed_at timestamptz,
  notes        text,
  sort_order   int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index project_tasks_project_idx on public.project_tasks(project_id, sort_order) where deleted_at is null;
create index project_tasks_due_idx on public.project_tasks(due_date) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Statutory and utility approvals
-- ---------------------------------------------------------------------
create table public.project_approvals (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         text not null,                  -- DISCOM / CEIG / Net metering / Subsidy / Other
  authority    text,
  reference_no text,
  applied_on   date,
  expected_on  date,
  approved_on  date,
  status       public.approval_status not null default 'not_started',
  owner_id     uuid references public.profiles(id) on delete set null,
  remarks      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index project_approvals_project_idx on public.project_approvals(project_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Vendors, materials and bills
-- ---------------------------------------------------------------------
create table public.vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text,                          -- Installation / Modules / Inverters / Civil / Transport…
  gst_no         text,
  contact_person text,
  phone          text,
  email          citext,
  address        text,
  payment_terms  text,                          -- Milestone based / 30 days / Advance…
  status         public.vendor_status not null default 'active',
  rating         numeric(3,1) check (rating is null or rating between 0 and 5),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  deleted_at     timestamptz
);
create unique index vendors_name_idx on public.vendors(lower(name)) where deleted_at is null;

create table public.project_materials (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  vendor_id      uuid references public.vendors(id) on delete set null,
  item           text not null,
  uom            text not null default 'nos',
  qty_required   numeric(14,3) not null default 0,
  qty_dispatched numeric(14,3) not null default 0,
  qty_received   numeric(14,3) not null default 0,
  rate           numeric(14,2) not null default 0,
  amount         numeric(14,2) generated always as (round(qty_required * rate, 2)) stored,
  status         public.material_status not null default 'pending',
  po_no          text,
  expected_on    date,
  received_on    date,
  remarks        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  deleted_at     timestamptz
);
create index project_materials_project_idx on public.project_materials(project_id) where deleted_at is null;

create table public.vendor_bills (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  vendor_id           uuid not null references public.vendors(id) on delete restrict,
  bill_no             text not null,
  bill_date           date not null default (now() at time zone 'Asia/Kolkata')::date,
  description         text,
  amount              numeric(14,2) not null default 0 check (amount >= 0),
  deductions          numeric(14,2) not null default 0 check (deductions >= 0),
  net_amount          numeric(14,2) generated always as (amount - deductions) stored,
  status              public.bill_status not null default 'submitted',
  pm_approved_by      uuid references public.profiles(id) on delete set null,
  pm_approved_at      timestamptz,
  accounts_approved_by uuid references public.profiles(id) on delete set null,
  accounts_approved_at timestamptz,
  paid_on             date,
  utr_no              text,
  remarks             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_by          uuid,
  deleted_at          timestamptz
);
create unique index vendor_bills_no_idx on public.vendor_bills(vendor_id, lower(bill_no)) where deleted_at is null;
create index vendor_bills_project_idx on public.vendor_bills(project_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Client milestones and money in
-- ---------------------------------------------------------------------
create table public.client_payments (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  milestone       text not null,
  invoice_no      text,
  invoice_date    date,
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  received_amount numeric(14,2) not null default 0 check (received_amount >= 0),
  received_on     date,
  status          public.client_pay_status not null default 'pending',
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz
);
create index client_payments_project_idx on public.client_payments(project_id) where deleted_at is null;

-- ---------------------------------------------------------------------
-- The site engineer's day-wise update (the Google Form)
-- ---------------------------------------------------------------------
create table public.project_updates (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  update_date      date not null default (now() at time zone 'Asia/Kolkata')::date,
  engineer_id      uuid references public.profiles(id) on delete set null,
  engineer_name    text,
  tl_work          public.work_task_status not null default 'not_started',
  gss_bay          public.work_task_status not null default 'not_started',
  piling           public.work_task_status not null default 'not_started',
  panel            public.work_task_status not null default 'not_started',
  module_work      public.work_task_status not null default 'not_started',
  inverter         public.work_task_status not null default 'not_started',
  material         public.work_task_status not null default 'not_started',
  work_description text,
  challenges       text,
  remarks          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  deleted_at       timestamptz
);
create unique index project_updates_key_idx on public.project_updates(project_id, update_date) where deleted_at is null;
create index project_updates_date_idx on public.project_updates(update_date desc);

grant usage, select on all sequences in schema public to authenticated;

-- =====================================================================
-- RLS — every table through the standard generator, so Phase 3 adds no
-- new authorisation pattern.
-- =====================================================================
select app.apply_standard_policies('projects', 'projects.projects', 'site_id',
                                   array['created_by','project_manager_id','site_engineer_id'],
                                   array['project_manager_id','site_engineer_id']);
select app.apply_standard_policies('project_tasks', 'projects.milestones', null,
                                   array['created_by','assigned_to'], array['assigned_to']);
select app.apply_standard_policies('project_templates', 'projects.milestones', null, array['created_by']);
select app.apply_standard_policies('project_approvals', 'projects.approvals', null,
                                   array['created_by','owner_id'], array['owner_id']);
select app.apply_standard_policies('vendors', 'projects.vendors', null, array['created_by']);
select app.apply_standard_policies('project_materials', 'projects.materials', null, array['created_by']);
select app.apply_standard_policies('vendor_bills', 'projects.bills', null, array['created_by']);
select app.apply_standard_policies('client_payments', 'projects.payments', null, array['created_by']);
select app.apply_standard_policies('project_updates', 'projects.projects', null,
                                   array['created_by','engineer_id']);

-- Template tasks follow their template.
alter table public.project_template_tasks enable row level security;
grant select, insert, update, delete on public.project_template_tasks to authenticated;
create policy tt_select on public.project_template_tasks for select to authenticated
  using (exists (select 1 from public.project_templates t where t.id = template_id));
create policy tt_insert on public.project_template_tasks for insert to authenticated
  with check (exists (select 1 from public.project_templates t where t.id = template_id)
              and ((select app.has_perm('projects.milestones', 'create'))
                   or (select app.has_perm('projects.milestones', 'edit'))));
create policy tt_update on public.project_template_tasks for update to authenticated
  using (exists (select 1 from public.project_templates t where t.id = template_id)
         and (select app.has_perm('projects.milestones', 'edit'))) with check (true);
create policy tt_delete on public.project_template_tasks for delete to authenticated
  using (exists (select 1 from public.project_templates t where t.id = template_id)
         and (select app.has_perm('projects.milestones', 'edit')));

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------

/** A vendor bill moves one step at a time, and each step has an owner. */
create or replace function app.guard_vendor_bill()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'pm_approved' then
    if old.status <> 'submitted' then
      raise exception 'Only a submitted bill can be approved by the project manager.' using errcode = '22023';
    end if;
    if not app.has_perm('projects.bills', 'approve') then
      raise exception 'Approving a vendor bill requires the APPROVE permission.' using errcode = '42501';
    end if;
    new.pm_approved_by := auth.uid();
    new.pm_approved_at := now();

  elsif new.status = 'accounts_approved' then
    if old.status <> 'pm_approved' then
      raise exception 'The project manager must approve the bill before accounts can.' using errcode = '22023';
    end if;
    if not app.has_perm('projects.payments', 'approve') then
      raise exception 'The accounts approval requires the APPROVE permission on payments.' using errcode = '42501';
    end if;
    -- Two pairs of eyes on the money: whoever approved as project
    -- manager cannot also give the accounts approval.
    if auth.uid() = old.pm_approved_by and not app.is_super_admin() then
      raise exception 'The same person cannot give both approvals.' using errcode = '42501';
    end if;
    new.accounts_approved_by := auth.uid();
    new.accounts_approved_at := now();

  elsif new.status = 'paid' then
    if old.status <> 'accounts_approved' then
      raise exception 'A bill can only be paid after the accounts approval.' using errcode = '22023';
    end if;
    if not app.has_perm('projects.payments', 'approve') then
      raise exception 'Marking a bill paid requires the APPROVE permission on payments.' using errcode = '42501';
    end if;
    new.paid_on := coalesce(new.paid_on, (now() at time zone 'Asia/Kolkata')::date);

  elsif new.status = 'rejected' then
    if not app.has_perm('projects.bills', 'approve') then
      raise exception 'Rejecting a vendor bill requires the APPROVE permission.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_workflow before update on public.vendor_bills
  for each row execute function app.guard_vendor_bill();

/** Completing a project task stamps when, and the stage cannot go backwards silently. */
create or replace function app.guard_project_task()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) end;
  end if;
  return new;
end;
$$;

create trigger guard_task before insert or update on public.project_tasks
  for each row execute function app.guard_project_task();

/** Client money received cannot exceed what was invoiced. */
create or replace function app.guard_client_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.received_amount > new.amount then
    raise exception 'Received amount cannot be more than the invoiced amount.' using errcode = '22023';
  end if;
  new.status := case
    when new.received_amount >= new.amount and new.amount > 0 then 'received'
    when new.received_amount > 0 then 'part_received'
    when new.invoice_no is not null then 'invoiced'
    else 'pending'
  end::public.client_pay_status;
  return new;
end;
$$;

create trigger guard_amounts before insert or update on public.client_payments
  for each row execute function app.guard_client_payment();

-- =====================================================================
-- RPCs
-- =====================================================================

/**
 * Apply a template to a project: one task per template row, due
 * `day_offset` days after the project start date.
 */
create or replace function public.apply_project_template(p_project_id uuid, p_template_id uuid)
returns int
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_start date;
  v_n int;
begin
  select start_date into v_start from public.projects where id = p_project_id and deleted_at is null;
  if not found then
    raise exception 'Project not found.' using errcode = '42501';
  end if;
  v_start := coalesce(v_start, (now() at time zone 'Asia/Kolkata')::date);

  insert into public.project_tasks (project_id, title, stage, due_date, notes, sort_order, created_by)
  select p_project_id, t.title, t.stage, v_start + t.day_offset, t.notes, t.sort_order, auth.uid()
  from public.project_template_tasks t
  where t.template_id = p_template_id
  order by t.sort_order;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/** The dashboard: portfolio, progress, money and what is waiting. */
create or replace function public.get_project_dashboard()
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not app.has_perm('projects.projects', 'view') then
    return '{}'::jsonb;
  end if;

  with p as (
    select pr.*,
           (select count(*) from public.project_tasks t
            where t.project_id = pr.id and t.deleted_at is null) as task_total,
           (select count(*) from public.project_tasks t
            where t.project_id = pr.id and t.deleted_at is null and t.status = 'done') as task_done
    from public.projects pr where pr.deleted_at is null
  ),
  scored as (
    select p.*, case when task_total > 0 then round(100.0 * task_done / task_total, 0)
                     when stage in ('commissioning','handover','closed') then 100
                     else 0 end as progress
    from p
  )
  select jsonb_build_object(
    'project_count', (select count(*) from scored),
    'capacity_kwp', coalesce((select sum(capacity_kwp) from scored), 0),
    'capacity_ac_kw', coalesce((select sum(capacity_ac_kw) from scored), 0),
    'commissioned', (select count(*) from scored where stage in ('commissioning','handover','closed')),
    'contract_value', coalesce((select sum(contract_value) from scored), 0),
    'open_tasks', coalesce((select count(*) from public.project_tasks t
                            where t.deleted_at is null and t.status not in ('done','cancelled')), 0),
    'overdue_tasks', coalesce((select count(*) from public.project_tasks t
                               where t.deleted_at is null and t.status not in ('done','cancelled')
                                 and t.due_date < (now() at time zone 'Asia/Kolkata')::date), 0),
    'approvals_pending', coalesce((select count(*) from public.project_approvals a
                                   where a.deleted_at is null and a.status <> 'approved'), 0),
    'materials_open', coalesce((select count(*) from public.project_materials m
                                where m.deleted_at is null and m.status in ('pending','ordered','dispatched','shortage')), 0),
    'material_shortage', coalesce((select count(*) from public.project_materials m
                                   where m.deleted_at is null and m.status = 'shortage'), 0),
    'vendors_active', coalesce((select count(*) from public.vendors v
                                where v.deleted_at is null and v.status = 'active'), 0),
    'bills_waiting', coalesce((select count(*) from public.vendor_bills b
                               where b.deleted_at is null and b.status in ('submitted','pm_approved')), 0),
    'bills_waiting_value', coalesce((select sum(net_amount) from public.vendor_bills b
                                     where b.deleted_at is null and b.status in ('submitted','pm_approved')), 0),
    'client_invoiced', coalesce((select sum(amount) from public.client_payments c where c.deleted_at is null), 0),
    'client_received', coalesce((select sum(received_amount) from public.client_payments c where c.deleted_at is null), 0),
    'client_outstanding', coalesce((select sum(amount - received_amount) from public.client_payments c
                                    where c.deleted_at is null), 0),
    'average_progress', coalesce((select round(avg(progress), 0) from scored), 0),
    'projects', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
                 'id', s.id, 'code', s.project_code, 'name', s.name, 'client', s.client_name,
                 'segment', s.segment, 'project_type', s.project_type,
                 'capacity_kwp', s.capacity_kwp, 'capacity_ac_kw', s.capacity_ac_kw,
                 'stage', s.stage, 'progress', s.progress,
                 'contract_value', s.contract_value,
                 'task_total', s.task_total, 'task_done', s.task_done,
                 'target_commissioning', s.target_commissioning,
                 'manager', (select pf.full_name from public.profiles pf where pf.id = s.project_manager_id)) x
        from scored s
        order by s.capacity_kwp desc, s.name) q), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object('id', t.id, 'title', t.title, 'stage', t.stage,
                                  'project', pr.name, 'due_date', t.due_date, 'status', t.status) x
        from public.project_tasks t join public.projects pr on pr.id = t.project_id
        where t.deleted_at is null and t.status not in ('done','cancelled')
        order by t.due_date nulls last
        limit 12) q), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

/** The day-wise site update the engineer files. */
create or replace function public.save_project_update(
  p_project_id uuid,
  p_date date,
  p_stages jsonb,                      -- {tl_work, gss_bay, piling, panel, module_work, inverter, material}
  p_work_description text default null,
  p_challenges text default null,
  p_remarks text default null,
  p_engineer_name text default null)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_get text;
begin
  if p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot file a site update for a future date.' using errcode = '22023';
  end if;

  insert into public.project_updates
    (project_id, update_date, engineer_id, engineer_name,
     tl_work, gss_bay, piling, panel, module_work, inverter, material,
     work_description, challenges, remarks, created_by)
  values (
    p_project_id, p_date, auth.uid(), nullif(trim(coalesce(p_engineer_name, '')), ''),
    coalesce(nullif(p_stages->>'tl_work', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'gss_bay', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'piling', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'panel', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'module_work', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'inverter', '')::public.work_task_status, 'not_started'),
    coalesce(nullif(p_stages->>'material', '')::public.work_task_status, 'not_started'),
    nullif(trim(coalesce(p_work_description, '')), ''),
    nullif(trim(coalesce(p_challenges, '')), ''),
    nullif(trim(coalesce(p_remarks, '')), ''),
    auth.uid())
  on conflict (project_id, update_date) where deleted_at is null do update
    set tl_work = excluded.tl_work, gss_bay = excluded.gss_bay, piling = excluded.piling,
        panel = excluded.panel, module_work = excluded.module_work, inverter = excluded.inverter,
        material = excluded.material, work_description = excluded.work_description,
        challenges = excluded.challenges, remarks = excluded.remarks,
        engineer_name = coalesce(excluded.engineer_name, public.project_updates.engineer_name),
        updated_by = auth.uid()
  returning id into v_id;

  -- Keep the cached stage honest: the update is the site's own word.
  select case
    when p_stages->>'inverter' = 'completed' and p_stages->>'module_work' = 'completed' then 'commissioning'
    when p_stages->>'piling' = 'completed' or p_stages->>'panel' = 'in_progress' then 'installation'
    else null end into v_get;
  if v_get is not null then
    update public.projects
       set stage = greatest(stage, v_get::public.project_stage)
     where id = p_project_id and stage < v_get::public.project_stage;
  end if;

  return v_id;
end;
$$;

grant execute on function public.apply_project_template(uuid, uuid) to authenticated;
grant execute on function public.get_project_dashboard() to authenticated;
grant execute on function public.save_project_update(uuid, date, jsonb, text, text, text, text) to authenticated;
revoke execute on function public.apply_project_template(uuid, uuid),
                        public.save_project_update(uuid, date, jsonb, text, text, text, text) from anon, public;

-- =====================================================================
-- Modules: enable the two that were seeded for Phase 3, add the rest.
-- =====================================================================
-- The plan, approvals, materials, bills and client money are tabs of a
-- project rather than separate menu entries, so they carry no route and
-- stay out of the navigation. They are still real modules: permissions,
-- scope and the audit log all work on them exactly the same way.
update public.modules set is_enabled = true, label = 'Execution Plan',
       description = 'Templates, tasks and stage-wise progress', route = null,
       show_in_nav = false
where key = 'projects.milestones';
update public.modules set is_enabled = true, route = '/projects', show_in_nav = true
where key = 'projects.projects';

insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, m.key, m.label, m.description, m.route, m.icon, m.sort_order,
       m.actions::public.perm_action[], true, false, m.nav, true, 3
from public.module_groups g,
     (values
       ('projects.approvals', 'Approvals', 'DISCOM, CEIG, net metering and subsidy approvals',
        null, 'ShieldCheck', 12, '{view,create,edit,delete,export,approve}', false),
       ('projects.materials', 'Materials', 'Material lines, dispatch, receipt and shortages',
        null, 'Blocks', 13, '{view,create,edit,delete,export}', false),
       ('projects.vendors', 'Vendors', 'Vendor master with GST, terms and status',
        '/projects/vendors', 'Handshake', 14, '{view,create,edit,delete,export}', true),
       ('projects.bills', 'Vendor Bills', 'Vendor bills with project-manager approval',
        null, 'FileText', 15, '{view,create,edit,delete,export,approve}', false),
       ('projects.payments', 'Client Payments', 'Client milestones, invoices and receipts',
        null, 'Handshake', 16, '{view,create,edit,delete,export,approve}', false)
     ) as m(key, label, description, route, icon, sort_order, actions, nav)
where g.key = 'operations'
on conflict (key) do nothing;

do $$
declare
  v_all text[] := array['projects.projects','projects.milestones','projects.approvals',
                        'projects.materials','projects.vendors','projects.bills','projects.payments'];
begin
  -- Administrators: everything.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'all'
  from public.roles r, public.modules m,
       unnest(array['view','create','edit','delete','export','approve','assign']::public.perm_action[]) a
  where r.key = 'admin' and m.key = any (v_all) and a = any (m.supported_actions)
  on conflict do nothing;

  -- Management: read, export and the approvals.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'all'
  from public.roles r, public.modules m, unnest(array['view','export']::public.perm_action[]) a
  where r.key = 'management' and m.key = any (v_all)
  on conflict do nothing;
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'approve', 'all'
  from public.roles r, public.modules m
  where r.key = 'management' and m.key in ('projects.bills','projects.payments','projects.approvals')
  on conflict do nothing;

  -- Project Manager: runs the projects they manage, and approves bills.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'own'
  from public.roles r, public.modules m,
       unnest(array['view','create','edit','export']::public.perm_action[]) a
  where r.key = 'project_manager' and m.key = any (v_all)
  on conflict (role_id, module_id, action) do update set scope = excluded.scope;
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'approve', 'own'
  from public.roles r, public.modules m
  where r.key = 'project_manager' and m.key in ('projects.bills','projects.approvals')
  on conflict do nothing;
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'assign', 'own'
  from public.roles r, public.modules m
  where r.key = 'project_manager' and m.key in ('projects.projects','projects.milestones')
  on conflict do nothing;

  -- HR/accounts style roles get the money view only where it is theirs;
  -- the O&M manager reads the projects that become their plants.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'view', 'all'
  from public.roles r, public.modules m
  where r.key = 'om_manager' and m.key in ('projects.projects','projects.milestones','projects.materials')
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- The three execution plans the legacy app ships with.
-- ---------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_tpl record;
  v_task record;
begin
  for v_tpl in
    select * from (values
      ('Residential Rooftop (up to 10 kWp)', 'residential', 'A 37-day plan for a small rooftop system.',
       array[0, 3, 7, 14, 21, 30, 34, 37]),
      ('C&I Rooftop (above 50 kWp)', 'commercial', 'A 72-day plan for a commercial rooftop.',
       array[0, 7, 14, 30, 50, 62, 68, 72]),
      ('Ground-mount Plant (MW scale)', 'industrial', 'A 150-day plan for a utility scale plant.',
       array[0, 20, 45, 75, 110, 135, 145, 150])
    ) as t(name, segment, descr, offsets)
  loop
    insert into public.project_templates (name, segment, description)
    values (v_tpl.name, v_tpl.segment::public.project_segment, v_tpl.descr)
    returning id into v_id;

    for v_task in
      select * from unnest(
        array['Survey','Design','Approvals','Procurement','Installation','Testing','Handover','Closure'],
        array['design','design','approvals','procurement','installation','testing','handover','closed']
      ) with ordinality as x(title, stage, ord)
    loop
      insert into public.project_template_tasks (template_id, sort_order, title, stage, day_offset)
      values (v_id, v_task.ord, v_task.title, v_task.stage::public.project_stage,
              v_tpl.offsets[v_task.ord]);
    end loop;
  end loop;
end $$;
