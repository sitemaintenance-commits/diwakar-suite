-- =====================================================================
-- PHASE 4 — O&M / SOLAR
--   solar_sites        technical extension of a site (D1)
--   equipment          inverters, modules, transformers … per site
--   generation_records one row per site per day
--   maintenance_tickets breakdowns and complaints
--   maintenance_records preventive / corrective maintenance
--
-- Everything here is SITE SCOPED: a user only ever sees rows for the
-- sites assigned to them (or all sites, if they hold that flag).
-- No generation data is invented — the monitor shows empty states until
-- real readings are entered or ingested.
-- =====================================================================

create type public.equipment_type as enum (
  'inverter', 'module', 'transformer', 'scb', 'acdb', 'dcdb', 'ups', 'meter', 'cctv', 'structure', 'other'
);
create type public.maintenance_type as enum ('preventive', 'corrective', 'cleaning', 'inspection', 'calibration');

-- ---------------------------------------------------------------------
-- Solar site (1:1 with sites)
-- ---------------------------------------------------------------------
create table public.solar_sites (
  site_id             uuid primary key references public.sites(id) on delete cascade,
  capacity_dc_kwp     numeric(12,3) not null default 0,
  capacity_ac_kw      numeric(12,3) not null default 0,
  commissioning_date  date,
  module_make         text,
  module_count        int,
  inverter_make       text,
  inverter_count      int,
  grid_connection     text,                        -- LT / 11 kV / 33 kV
  discom              text,
  consumer_no         text,
  tariff_per_kwh      numeric(8,3),
  expected_yield      numeric(8,3),                -- kWh per kWp per day (CUF baseline)
  monitoring_source   text not null default 'manual',   -- manual / api / scada / excel
  om_lead_id          uuid references public.profiles(id) on delete set null,
  om_start_date       date,
  om_end_date         date,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_by          uuid
);

-- ---------------------------------------------------------------------
-- Equipment register
-- ---------------------------------------------------------------------
create table public.equipment (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  type           public.equipment_type not null default 'inverter',
  name           text not null,
  make           text,
  model          text,
  serial_no      text,
  capacity_kw    numeric(12,3),
  installed_on   date,
  warranty_until date,
  status         public.record_status not null default 'active',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  deleted_at     timestamptz
);
create index equipment_site_idx on public.equipment(site_id);

-- ---------------------------------------------------------------------
-- Daily generation
-- ---------------------------------------------------------------------
create table public.generation_records (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.sites(id) on delete cascade,
  gen_date          date not null,
  generation_kwh    numeric(14,3) not null default 0 check (generation_kwh >= 0),
  expected_kwh      numeric(14,3),
  irradiation_kwh_m2 numeric(8,3),                 -- needed for a real PR; optional
  grid_outage_hrs   numeric(6,2) not null default 0 check (grid_outage_hrs >= 0),
  plant_outage_hrs  numeric(6,2) not null default 0 check (plant_outage_hrs >= 0),
  export_kwh        numeric(14,3),
  import_kwh        numeric(14,3),
  source            text not null default 'manual',
  remarks           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid,
  deleted_at        timestamptz,
  unique (site_id, gen_date)
);
create index generation_site_date_idx on public.generation_records(site_id, gen_date desc);
create index generation_date_idx on public.generation_records(gen_date desc);

-- ---------------------------------------------------------------------
-- Tickets (breakdowns / complaints)
-- ---------------------------------------------------------------------
create sequence public.ticket_code_seq start 1;

create table public.maintenance_tickets (
  id              uuid primary key default gen_random_uuid(),
  ticket_no       text not null unique default ('TK-' || lpad(nextval('public.ticket_code_seq')::text, 5, '0')),
  site_id         uuid not null references public.sites(id) on delete cascade,
  equipment_id    uuid references public.equipment(id) on delete set null,
  title           text not null,
  issue           text,
  category        text,                            -- inverter fault, module damage, grid, cleaning …
  priority        public.priority not null default 'medium',
  status          public.ticket_status not null default 'open',
  reported_by     uuid references public.profiles(id) on delete set null,
  reported_at     timestamptz not null default now(),
  assigned_to     uuid references public.profiles(id) on delete set null,
  started_at      timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  downtime_hours  numeric(8,2),
  generation_loss_kwh numeric(14,3),
  root_cause      text,
  resolution      text,
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz
);
create index tickets_site_status_idx on public.maintenance_tickets(site_id, status);
create index tickets_assigned_idx on public.maintenance_tickets(assigned_to, status);
create index tickets_open_idx on public.maintenance_tickets(reported_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------
-- Preventive / corrective maintenance
-- ---------------------------------------------------------------------
create table public.maintenance_records (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  equipment_id   uuid references public.equipment(id) on delete set null,
  ticket_id      uuid references public.maintenance_tickets(id) on delete set null,
  type           public.maintenance_type not null default 'preventive',
  title          text not null,
  scheduled_date date,
  done_date      date,
  performed_by   uuid references public.profiles(id) on delete set null,
  assigned_to    uuid references public.profiles(id) on delete set null,
  checklist      jsonb not null default '[]'::jsonb,
  findings       text,
  status         public.task_status not null default 'todo',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  deleted_at     timestamptz
);
create index maintenance_site_idx on public.maintenance_records(site_id, scheduled_date);
create index maintenance_status_idx on public.maintenance_records(status);

-- ---------------------------------------------------------------------
-- RLS — every O&M table is site scoped
-- ---------------------------------------------------------------------
select app.apply_standard_policies('equipment',           'om.equipment',    'site_id', array['created_by']);
select app.apply_standard_policies('generation_records',  'om.generation',   'site_id', array['created_by']);
select app.apply_standard_policies('maintenance_tickets', 'om.tickets',      'site_id', array['created_by','assigned_to','reported_by'], array['assigned_to']);
select app.apply_standard_policies('maintenance_records', 'om.maintenance',  'site_id', array['created_by','assigned_to','performed_by'], array['assigned_to']);

-- solar_sites has no deleted_at / owner columns: plain site-scoped policies.
alter table public.solar_sites enable row level security;
grant select, insert, update on public.solar_sites to authenticated;
create policy solar_sites_select on public.solar_sites for select to authenticated
  using ((select app.has_perm('om.sites', 'view')) and site_id = any ((select app.my_site_ids())::uuid[]));
create policy solar_sites_insert on public.solar_sites for insert to authenticated
  with check ((select app.has_perm('om.sites', 'create')) and site_id = any ((select app.my_site_ids())::uuid[]));
create policy solar_sites_update on public.solar_sites for update to authenticated
  using ((select app.has_perm('om.sites', 'edit')) and site_id = any ((select app.my_site_ids())::uuid[]))
  with check (site_id = any ((select app.my_site_ids())::uuid[]));
create trigger touch_row before update on public.solar_sites for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.solar_sites
  for each row execute function app.audit_row_change('om.sites');

-- ---------------------------------------------------------------------
-- Ticket workflow guard: closing a ticket needs APPROVE; timestamps are
-- stamped server-side so the history cannot be back-dated by a client.
-- ---------------------------------------------------------------------
create or replace function app.guard_ticket_workflow()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status = 'closed' and old.status <> 'closed' and not app.has_perm('om.tickets', 'approve') then
    raise exception 'Closing a ticket requires the APPROVE permission.' using errcode = '42501';
  end if;
  if new.status = 'in_progress' and old.status <> 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
    if new.downtime_hours is null and new.started_at is not null then
      new.downtime_hours := round(extract(epoch from (new.resolved_at - new.started_at)) / 3600.0, 2);
    end if;
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if new.assigned_to is not null and old.assigned_to is null and new.status = 'open' then
    new.status := 'assigned';
  end if;
  return new;
end;
$$;

create trigger guard_workflow before update on public.maintenance_tickets
  for each row execute function app.guard_ticket_workflow();

-- ---------------------------------------------------------------------
-- Enable the O&M modules
-- ---------------------------------------------------------------------
update public.modules set is_enabled = true
where key in ('om.sites', 'om.monitor', 'om.generation', 'om.maintenance', 'om.tickets', 'om.equipment');

-- ---------------------------------------------------------------------
-- Monitoring figures.
-- SECURITY INVOKER: only the caller's sites are included. Ratios that
-- need data we do not have (PR without irradiation) are returned as NULL
-- so the UI can say "no data source" instead of inventing a number.
-- ---------------------------------------------------------------------
create or replace function public.get_generation_summary(p_from date default null, p_to date default null, p_site uuid default null)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from date := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to date := coalesce(p_to, v_today);
  v jsonb;
begin
  if not public.has_permission('om.monitor', 'view') and not public.has_permission('om.generation', 'view') then
    return '{}'::jsonb;
  end if;

  with sites as (
    select s.id, s.name, s.capacity_kwp,
           coalesce(ss.capacity_ac_kw, s.capacity_kwp) as capacity_ac,
           coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as capacity_dc,
           ss.expected_yield
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and (p_site is null or s.id = p_site)
  ),
  gen as (
    select g.site_id, g.gen_date, g.generation_kwh, g.expected_kwh, g.irradiation_kwh_m2,
           g.grid_outage_hrs, g.plant_outage_hrs
    from public.generation_records g
    where (p_site is null or g.site_id = p_site)
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'has_data', exists (select 1 from gen),
    'today',       coalesce((select sum(generation_kwh) from gen where gen_date = v_today), 0),
    'yesterday',   coalesce((select sum(generation_kwh) from gen where gen_date = v_today - 1), 0),
    'month',       coalesce((select sum(generation_kwh) from gen where gen_date >= date_trunc('month', v_today)::date and gen_date <= v_today), 0),
    'year',        coalesce((select sum(generation_kwh) from gen where gen_date >= date_trunc('year', v_today)::date and gen_date <= v_today), 0),
    'period',      coalesce((select sum(generation_kwh) from gen where gen_date between v_from and v_to), 0),
    'expected_period', (select sum(expected_kwh) from gen where gen_date between v_from and v_to),
    'capacity_kwp', coalesce((select sum(capacity_dc) from sites), 0),
    'site_count',   coalesce((select count(*) from sites), 0),
    -- CUF = energy / (DC capacity x hours in the period).
    -- Capacity is summed over SITES and energy over READINGS, separately:
    -- summing both in one join would multiply the capacity by the number of days.
    'cuf', (
      select case when x.cap > 0 and x.days > 0 and x.energy > 0
                  then round(100 * x.energy / (x.cap * x.days * 24), 2) end
      from (select coalesce((select sum(capacity_dc) from sites), 0) as cap,
                   (v_to - v_from + 1) as days,
                   coalesce((select sum(generation_kwh) from gen where gen_date between v_from and v_to), 0) as energy) x),
    -- PR needs irradiation; NULL when it was never recorded
    'pr', (
      select case when sum(g.irradiation_kwh_m2 * s.capacity_dc) > 0
                  then round(100 * sum(g.generation_kwh) / sum(g.irradiation_kwh_m2 * s.capacity_dc), 2) end
      from gen g join sites s on s.id = g.site_id
      where g.gen_date between v_from and v_to and g.irradiation_kwh_m2 is not null),
    'plant_availability', (
      select case when count(*) > 0 then round(100 * (1 - sum(plant_outage_hrs) / (count(*) * 24.0)), 2) end
      from gen where gen_date between v_from and v_to),
    'grid_availability', (
      select case when count(*) > 0 then round(100 * (1 - sum(grid_outage_hrs) / (count(*) * 24.0)), 2) end
      from gen where gen_date between v_from and v_to),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'site_id', s.id, 'name', s.name, 'capacity_kwp', s.capacity_dc,
        'today', coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date = v_today), 0),
        'month', coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date >= date_trunc('month', v_today)::date), 0),
        'period', coalesce((select sum(generation_kwh) from gen where site_id = s.id and gen_date between v_from and v_to), 0),
        'expected_period', (select sum(expected_kwh) from gen where site_id = s.id and gen_date between v_from and v_to),
        'last_reading', (select max(gen_date) from gen where site_id = s.id),
        'open_tickets', coalesce((select count(*) from public.maintenance_tickets t
                                  where t.site_id = s.id and t.status not in ('resolved','closed') and t.deleted_at is null), 0))
        order by s.name)
      from sites s), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.gen_date, 'kwh', d.kwh, 'expected', d.expected) order by d.gen_date)
      from (select gen_date, sum(generation_kwh) as kwh, sum(expected_kwh) as expected
            from gen where gen_date between v_from and v_to group by gen_date) d), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

grant execute on function public.get_generation_summary(date, date, uuid) to authenticated;
revoke execute on function public.get_generation_summary(date, date, uuid) from anon, public;

-- Bulk entry: one row per site for a date (upsert), used by the Generation page.
create or replace function public.save_generation(p_rows jsonb)
returns int
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  with rows as (
    select (r->>'site_id')::uuid as site_id,
           (r->>'gen_date')::date as gen_date,
           coalesce((r->>'generation_kwh')::numeric, 0) as generation_kwh,
           nullif(r->>'expected_kwh', '')::numeric as expected_kwh,
           nullif(r->>'irradiation_kwh_m2', '')::numeric as irradiation,
           coalesce((r->>'grid_outage_hrs')::numeric, 0) as grid_outage_hrs,
           coalesce((r->>'plant_outage_hrs')::numeric, 0) as plant_outage_hrs,
           nullif(r->>'remarks', '') as remarks
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  ), ins as (
    insert into public.generation_records
      (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2, grid_outage_hrs, plant_outage_hrs, remarks)
    select site_id, gen_date, generation_kwh, expected_kwh, irradiation, grid_outage_hrs, plant_outage_hrs, remarks
    from rows
    on conflict (site_id, gen_date) do update
      set generation_kwh = excluded.generation_kwh,
          expected_kwh = excluded.expected_kwh,
          irradiation_kwh_m2 = excluded.irradiation_kwh_m2,
          grid_outage_hrs = excluded.grid_outage_hrs,
          plant_outage_hrs = excluded.plant_outage_hrs,
          remarks = excluded.remarks
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

grant execute on function public.save_generation(jsonb) to authenticated;
revoke execute on function public.save_generation(jsonb) from anon, public;

-- ---------------------------------------------------------------------
-- Dashboard: add the O&M section
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard_summary()
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_day_start timestamptz := v_today::timestamp at time zone 'Asia/Kolkata';
begin
  if not public.has_permission('dashboard', 'view') then
    return v;
  end if;

  v := v || jsonb_build_object('sites', jsonb_build_object(
    'total',        coalesce((select count(*) from public.sites), 0),
    'active',       coalesce((select count(*) from public.sites where status = 'active'), 0),
    'capacity_kwp', coalesce((select sum(capacity_kwp) from public.sites where status = 'active'), 0)));

  if public.has_permission('admin.users', 'view') then
    v := v || jsonb_build_object('users', jsonb_build_object(
      'total',    coalesce((select count(*) from public.profiles), 0),
      'active',   coalesce((select count(*) from public.profiles where status = 'active'), 0),
      'invited',  coalesce((select count(*) from public.profiles where status = 'invited'), 0),
      'inactive', coalesce((select count(*) from public.profiles where status = 'inactive'), 0)));
  end if;

  if public.has_permission('admin.roles', 'view') then
    v := v || jsonb_build_object('roles', jsonb_build_object(
      'total',  coalesce((select count(*) from public.roles), 0),
      'custom', coalesce((select count(*) from public.roles where not is_system), 0)));
  end if;

  if public.has_permission('admin.audit', 'view') then
    v := v || jsonb_build_object('audit', jsonb_build_object(
      'today',        coalesce((select count(*) from public.audit_logs where occurred_at >= v_day_start), 0),
      'logins_today', coalesce((select count(*) from public.audit_logs where action = 'login' and occurred_at >= v_day_start), 0)));
  end if;

  if public.has_permission('hr.employees', 'view') or public.has_permission('admin.users', 'view') then
    v := v || jsonb_build_object('employees', jsonb_build_object(
      'total',  coalesce((select count(*) from public.employees), 0),
      'active', coalesce((select count(*) from public.employees where status = 'active'), 0)));
  end if;

  if public.has_permission('crm.leads', 'view') then
    v := v || jsonb_build_object('leads', (
      select jsonb_build_object(
        'total',      coalesce(count(*), 0),
        'open',       coalesce(count(*) filter (where status not in ('converted', 'lost')), 0),
        'value',      coalesce(sum(lead_value) filter (where status not in ('converted', 'lost')), 0),
        'new',        coalesce(count(*) filter (where status = 'new'), 0),
        'contacted',  coalesce(count(*) filter (where status = 'contacted'), 0),
        'interested', coalesce(count(*) filter (where status = 'interested'), 0),
        'quoted',     coalesce(count(*) filter (where status = 'quoted'), 0),
        'converted',  coalesce(count(*) filter (where status = 'converted'), 0),
        'lost',       coalesce(count(*) filter (where status = 'lost'), 0))
      from public.leads));
  end if;

  if public.has_permission('crm.tenders', 'view') then
    v := v || jsonb_build_object('tenders', (
      select jsonb_build_object(
        'total',          coalesce(count(*), 0),
        'live',           coalesce(count(*) filter (where status in ('identified','evaluating','preparing')), 0),
        'submitted',      coalesce(count(*) filter (where status in ('submitted','technical_qualified','financial_opened')), 0),
        'won',            coalesce(count(*) filter (where status = 'won'), 0),
        'lost',           coalesce(count(*) filter (where status in ('lost','technical_disqualified')), 0),
        'closing_7_days', coalesce(count(*) filter (where status in ('identified','evaluating','preparing')
                                                      and submission_due_at >= now()
                                                      and submission_due_at < now() + interval '7 days'), 0),
        'overdue',        coalesce(count(*) filter (where status in ('identified','evaluating','preparing')
                                                      and submission_due_at < now()), 0),
        'pipeline_value', coalesce(sum(estimated_value) filter (where status in ('identified','evaluating','preparing','submitted','technical_qualified','financial_opened')), 0),
        'won_value',      coalesce(sum(coalesce(contract_value, our_bid_value, estimated_value)) filter (where status = 'won'), 0),
        'emd_blocked',    coalesce(sum(emd_amount) filter (where emd_status in ('submitted','refund_requested')), 0),
        'emd_refund_due', coalesce(count(*) filter (where emd_status = 'refund_requested'
                                                      or (emd_status = 'submitted' and status in ('lost','technical_disqualified','cancelled'))), 0))
      from public.tenders));
  end if;

  if public.has_permission('crm.quotations', 'view') then
    v := v || jsonb_build_object('quotations', (
      select jsonb_build_object(
        'total',            coalesce(count(*), 0),
        'draft',            coalesce(count(*) filter (where status = 'draft'), 0),
        'sent',             coalesce(count(*) filter (where status in ('sent','under_discussion')), 0),
        'pending_approval', coalesce(count(*) filter (where status = 'draft' and grand_total > 0), 0),
        'approved',         coalesce(count(*) filter (where status = 'approved'), 0),
        'value',            coalesce(sum(grand_total) filter (where status in ('sent','under_discussion','approved')), 0))
      from public.quotations));
  end if;

  if public.has_permission('crm.followups', 'view') then
    v := v || jsonb_build_object('followups', (
      select jsonb_build_object(
        'open',    coalesce(count(*) filter (where status = 'scheduled'), 0),
        'today',   coalesce(count(*) filter (where status = 'scheduled'
                                               and (follow_up_at at time zone 'Asia/Kolkata')::date = v_today), 0),
        'overdue', coalesce(count(*) filter (where status = 'scheduled' and follow_up_at < now()), 0))
      from public.follow_ups));
  end if;

  -- O&M
  if public.has_permission('om.generation', 'view') or public.has_permission('om.monitor', 'view') then
    v := v || jsonb_build_object('generation', (
      select jsonb_build_object(
        'today',      coalesce(sum(generation_kwh) filter (where gen_date = v_today), 0),
        'yesterday',  coalesce(sum(generation_kwh) filter (where gen_date = v_today - 1), 0),
        'month',      coalesce(sum(generation_kwh) filter (where gen_date >= date_trunc('month', v_today)::date), 0),
        'year',       coalesce(sum(generation_kwh) filter (where gen_date >= date_trunc('year', v_today)::date), 0),
        'has_data',   count(*) > 0,
        'last_date',  max(gen_date))
      from public.generation_records));
  end if;

  if public.has_permission('om.tickets', 'view') then
    v := v || jsonb_build_object('tickets', (
      select jsonb_build_object(
        'open',        coalesce(count(*) filter (where status in ('open','assigned','in_progress')), 0),
        'critical',    coalesce(count(*) filter (where status in ('open','assigned','in_progress') and priority = 'critical'), 0),
        'unassigned',  coalesce(count(*) filter (where status = 'open' and assigned_to is null), 0),
        'resolved_today', coalesce(count(*) filter (where resolved_at >= v_day_start), 0))
      from public.maintenance_tickets));
  end if;

  if public.has_permission('om.maintenance', 'view') then
    v := v || jsonb_build_object('maintenance', (
      select jsonb_build_object(
        'pending', coalesce(count(*) filter (where status in ('todo','in_progress')), 0),
        'overdue', coalesce(count(*) filter (where status in ('todo','in_progress') and scheduled_date < v_today), 0))
      from public.maintenance_records));
  end if;

  return v;
end;
$$;

grant execute on function public.get_dashboard_summary() to authenticated;
grant usage, select on all sequences in schema public to authenticated;
