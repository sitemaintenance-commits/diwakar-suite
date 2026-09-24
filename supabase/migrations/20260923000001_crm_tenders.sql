-- =====================================================================
-- PHASE 2 — CRM: Leads, Tenders (government bidding), Quotations,
-- Follow-ups and document attachments.
--
-- Diwakar Solar sells mainly by bidding for government tenders, so the
-- "Customers" module of the original plan is replaced by "Tenders":
-- the full bid lifecycle from a published tender to award, including
-- EMD/tender-fee money tracking, deadlines and bid results.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.tender_status as enum (
  'identified',              -- found on a portal, not yet reviewed
  'evaluating',              -- go / no-go review
  'preparing',               -- approved to bid, documents in preparation
  'submitted',               -- bid submitted on the portal
  'technical_qualified',
  'technical_disqualified',
  'financial_opened',
  'won',
  'lost',
  'cancelled'                -- cancelled / retendered by the authority
);

create type public.emd_status as enum (
  'not_required', 'pending', 'submitted', 'refund_requested', 'refunded', 'forfeited'
);

create type public.followup_entity as enum ('lead', 'tender', 'quotation');

-- ---------------------------------------------------------------------
-- Leads (private / direct enquiries)
-- ---------------------------------------------------------------------
create sequence public.lead_code_seq start 1;

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  lead_code       text not null unique default ('LD-' || lpad(nextval('public.lead_code_seq')::text, 5, '0')),
  company         text,
  contact_person  text not null,
  phone           text,
  email           citext,
  location        text,
  district        text,
  state           text,
  source          text,                                   -- referral, website, site visit, exhibition …
  status          public.lead_status not null default 'new',
  requirement     text,
  capacity_kwp    numeric(12,3),
  lead_value      numeric(14,2) not null default 0,
  assigned_to     uuid references public.profiles(id) on delete set null,
  next_follow_up  date,
  lost_reason     text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz
);
create index leads_status_idx on public.leads(status) where deleted_at is null;
create index leads_assigned_idx on public.leads(assigned_to);
create index leads_followup_idx on public.leads(next_follow_up);
create index leads_search_idx on public.leads using gin ((coalesce(company, '') || ' ' || contact_person) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Tenders — the government bidding pipeline
-- ---------------------------------------------------------------------
create sequence public.tender_code_seq start 1;

create table public.tenders (
  id                uuid primary key default gen_random_uuid(),
  tender_code       text not null unique default ('TN-' || lpad(nextval('public.tender_code_seq')::text, 5, '0')),
  reference_no      text,                                  -- the authority's own tender / NIT number
  title             text not null,
  authority         text,                                  -- e.g. RVPN, JJM, PWD, Nagar Nigam, DISCOM
  portal            text,                                  -- GeM, CPPP, state e-Proc, IREPS …
  portal_url        text,
  tender_type       text not null default 'open',          -- open / limited / GeM bid / EOI / RFP / RFQ
  work_type         text,                                  -- rooftop, ground mount, solar pump, street light, O&M …
  state             text,
  district          text,
  location          text,
  site_id           uuid references public.sites(id) on delete set null,
  capacity_kwp      numeric(12,3),
  estimated_value   numeric(14,2) not null default 0,

  -- money the company puts at risk to bid
  tender_fee        numeric(12,2) not null default 0,
  tender_fee_paid   boolean not null default false,
  emd_amount        numeric(14,2) not null default 0,
  emd_mode          text,                                  -- online / BG / DD / exempt
  emd_status        public.emd_status not null default 'not_required',
  emd_submitted_on  date,
  emd_valid_until   date,
  emd_refunded_on   date,

  -- key dates
  published_on          date,
  prebid_at             timestamptz,
  clarification_due     date,
  submission_due_at     timestamptz,                       -- the deadline that matters
  technical_opening_at  timestamptz,
  financial_opening_at  timestamptz,

  status            public.tender_status not null default 'identified',
  -- go / no-go decision (needs the APPROVE permission)
  bid_decision      text,                                  -- 'go' | 'no_go'
  bid_decision_note text,
  bid_approved_by   uuid references public.profiles(id) on delete set null,
  bid_approved_at   timestamptz,

  -- submission + result
  submitted_at      timestamptz,
  our_bid_value     numeric(14,2),
  our_rank          int check (our_rank is null or our_rank > 0),
  l1_value          numeric(14,2),
  l1_bidder         text,
  total_bidders     int check (total_bidders is null or total_bidders >= 0),
  result_declared_on date,
  lost_reason       text,

  -- award
  loa_no            text,
  loa_date          date,
  work_order_no     text,
  contract_value    numeric(14,2),
  completion_days   int,

  assigned_to       uuid references public.profiles(id) on delete set null,   -- bid manager
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid,
  deleted_at        timestamptz
);
create index tenders_status_idx on public.tenders(status) where deleted_at is null;
create index tenders_due_idx on public.tenders(submission_due_at);
create index tenders_assigned_idx on public.tenders(assigned_to);
create index tenders_site_idx on public.tenders(site_id);
create index tenders_emd_idx on public.tenders(emd_status) where emd_status in ('submitted', 'refund_requested');
create index tenders_search_idx on public.tenders using gin ((title || ' ' || coalesce(authority, '') || ' ' || coalesce(reference_no, '')) gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Quotations / bid pricing (for a tender or a lead)
-- ---------------------------------------------------------------------
create sequence public.quotation_code_seq start 1;

create table public.quotations (
  id             uuid primary key default gen_random_uuid(),
  quotation_no   text not null unique default ('QT-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-'
                                                || lpad(nextval('public.quotation_code_seq')::text, 4, '0')),
  tender_id      uuid references public.tenders(id) on delete set null,
  lead_id        uuid references public.leads(id) on delete set null,
  client_name    text,                                     -- authority / customer name on the document
  client_address text,
  subject        text,
  quote_date     date not null default (now() at time zone 'Asia/Kolkata')::date,
  valid_until    date,
  status         public.quotation_status not null default 'draft',
  currency       text not null default 'INR',
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  grand_total    numeric(14,2) not null default 0,
  terms          text,
  notes          text,
  revision       int not null default 1,
  parent_quotation_id uuid references public.quotations(id) on delete set null,
  approved_by    uuid references public.profiles(id) on delete set null,
  approved_at    timestamptz,
  sent_at        timestamptz,
  assigned_to    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  deleted_at     timestamptz
);
create index quotations_tender_idx on public.quotations(tender_id);
create index quotations_lead_idx on public.quotations(lead_id);
create index quotations_status_idx on public.quotations(status) where deleted_at is null;

create table public.quotation_items (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  line_no       int not null default 1,
  description   text not null,
  hsn_sac       text,
  unit          text default 'Nos',
  quantity      numeric(14,3) not null default 1 check (quantity >= 0),
  rate          numeric(14,2) not null default 0 check (rate >= 0),
  tax_rate      numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  amount        numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  created_at    timestamptz not null default now()
);
create index quotation_items_parent_idx on public.quotation_items(quotation_id);

-- Totals are always derived from the lines, never trusted from the client.
create or replace function app.recalc_quotation_totals()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  update public.quotations q
     set subtotal    = t.sub,
         tax_total   = t.tax,
         grand_total = t.sub + t.tax
  from (
    select coalesce(sum(round(quantity * rate, 2)), 0) as sub,
           coalesce(sum(round(round(quantity * rate, 2) * tax_rate / 100, 2)), 0) as tax
    from public.quotation_items where quotation_id = v_id
  ) t
  where q.id = v_id;
  return null;
end;
$$;

create trigger recalc_totals
  after insert or update or delete on public.quotation_items
  for each row execute function app.recalc_quotation_totals();

-- ---------------------------------------------------------------------
-- Follow-ups (against a lead, tender or quotation)
-- ---------------------------------------------------------------------
create table public.follow_ups (
  id              uuid primary key default gen_random_uuid(),
  entity_type     public.followup_entity not null,
  lead_id         uuid references public.leads(id) on delete cascade,
  tender_id       uuid references public.tenders(id) on delete cascade,
  quotation_id    uuid references public.quotations(id) on delete cascade,
  follow_up_at    timestamptz not null default now(),
  type            text not null default 'call',            -- call / visit / email / portal / meeting
  subject         text,
  notes           text,
  outcome         text,
  status          public.followup_status not null default 'scheduled',
  next_follow_up_at timestamptz,
  assigned_to     uuid references public.profiles(id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz,
  constraint follow_ups_parent_check check (
    (entity_type = 'lead'      and lead_id is not null) or
    (entity_type = 'tender'    and tender_id is not null) or
    (entity_type = 'quotation' and quotation_id is not null))
);
create index follow_ups_due_idx on public.follow_ups(follow_up_at) where deleted_at is null;
create index follow_ups_assigned_idx on public.follow_ups(assigned_to, status);
create index follow_ups_lead_idx on public.follow_ups(lead_id);
create index follow_ups_tender_idx on public.follow_ups(tender_id);

-- ---------------------------------------------------------------------
-- Documents — one table for attachments of every module (D3).
-- Each row carries the module that owns it, so access follows that
-- module's permission and (when set) the site restriction.
-- ---------------------------------------------------------------------
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  module_key   text not null references public.modules(key) on update cascade,
  entity_type  text not null,                              -- 'tender' | 'lead' | 'quotation' | …
  entity_id    uuid not null,
  category     text,                                       -- NIT, BOQ, EMD receipt, LOA, technical bid …
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  site_id      uuid references public.sites(id) on delete set null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index documents_entity_idx on public.documents(entity_type, entity_id);
create index documents_module_idx on public.documents(module_key);

-- ---------------------------------------------------------------------
-- Module catalogue: Tenders replaces Customers; enable the CRM modules.
-- ---------------------------------------------------------------------
delete from public.modules where key = 'crm.customers';

insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'crm.tenders', 'Tenders',
       'Government tender bidding: deadlines, EMD, bids and results',
       '/crm/tenders', 'Gavel', 20,
       '{view,create,edit,delete,export,approve,assign}'::public.perm_action[],
       true, false, true, true, 2
from public.module_groups g where g.key = 'crm';

update public.modules set is_enabled = true where key in ('crm.leads', 'crm.quotations', 'crm.followups');
update public.module_groups set label = 'CRM & Tenders' where key = 'crm';

-- Default grants for the new module (roles remain fully editable afterwards).
do $$
declare
  v_module uuid := (select id from public.modules where key = 'crm.tenders');
begin
  -- Admin: everything
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_module, a, 'all'
  from public.roles r, unnest(enum_range(null::public.perm_action)) a
  where r.key = 'admin'
  on conflict do nothing;

  -- Management: see everything, approve the go / no-go decision
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_module, a, 'all'
  from public.roles r, unnest(array['view','export','approve']::public.perm_action[]) a
  where r.key = 'management'
  on conflict do nothing;

  -- Sales Executive: works their own tenders
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_module, a, 'own'
  from public.roles r, unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key = 'sales_executive'
  on conflict do nothing;

  -- Project Manager / O&M Manager: read-only visibility of won work
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, v_module, 'view', 'all'
  from public.roles r where r.key in ('project_manager', 'om_manager')
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security (the standard generator used by every module)
-- ---------------------------------------------------------------------
select app.apply_standard_policies('leads',      'crm.leads',      null,      array['created_by','assigned_to'], array['assigned_to']);
select app.apply_standard_policies('tenders',    'crm.tenders',    'site_id', array['created_by','assigned_to'], array['assigned_to']);
select app.apply_standard_policies('quotations', 'crm.quotations', null,      array['created_by','assigned_to'], array['assigned_to']);
select app.apply_standard_policies('follow_ups', 'crm.followups',  null,      array['created_by','assigned_to'], array['assigned_to']);

-- Tenders may be linked to a site, but most are not; a NULL site must stay
-- visible to users who hold the permission. The generator always requires a
-- site match, so relax exactly that part here.
drop policy std_select on public.tenders;
create policy std_select on public.tenders for select to authenticated
  using (deleted_at is null
     and (select app.has_perm('crm.tenders', 'view'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('crm.tenders', 'view')), array[created_by, assigned_to]::uuid[],
                      (select auth.uid()), (select app.my_team_ids())));
drop policy std_insert on public.tenders;
create policy std_insert on public.tenders for insert to authenticated
  with check ((select app.has_perm('crm.tenders', 'create'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));
drop policy std_update on public.tenders;
create policy std_update on public.tenders for update to authenticated
  using (deleted_at is null
     and (select app.has_perm('crm.tenders', 'edit'))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and app.in_scope((select app.perm_scope('crm.tenders', 'edit')), array[created_by, assigned_to]::uuid[],
                      (select auth.uid()), (select app.my_team_ids())))
  with check (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]));

-- Quotation lines follow their quotation.
alter table public.quotation_items enable row level security;
grant select, insert, update, delete on public.quotation_items to authenticated;

create policy quotation_items_select on public.quotation_items for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy quotation_items_write on public.quotation_items for insert to authenticated
  with check ((select app.has_perm('crm.quotations', 'create')) or (select app.has_perm('crm.quotations', 'edit')));
create policy quotation_items_update on public.quotation_items for update to authenticated
  using ((select app.has_perm('crm.quotations', 'edit'))) with check (true);
create policy quotation_items_delete on public.quotation_items for delete to authenticated
  using ((select app.has_perm('crm.quotations', 'edit')));

-- Documents: access follows the owning module (and its site, when set).
alter table public.documents enable row level security;
grant select, insert, update, delete on public.documents to authenticated;

create policy documents_select on public.documents for select to authenticated
  using (deleted_at is null
     and (select app.is_active_user())
     and app.has_perm(module_key, 'view')
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));
create policy documents_insert on public.documents for insert to authenticated
  with check (created_by = (select auth.uid())
     and (app.has_perm(module_key, 'create') or app.has_perm(module_key, 'edit')));
create policy documents_update on public.documents for update to authenticated
  using (deleted_at is null and app.has_perm(module_key, 'edit')) with check (true);
create policy documents_delete on public.documents for delete to authenticated
  using (app.has_perm(module_key, 'delete') or (created_by = (select auth.uid()) and app.has_perm(module_key, 'edit')));

create trigger touch_row before update on public.documents for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.documents
  for each row execute function app.audit_row_change('crm.tenders');

-- ---------------------------------------------------------------------
-- APPROVE guards: decisions that need the APPROVE permission.
-- ---------------------------------------------------------------------
create or replace function app.guard_quotation_approval()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'rejected')
     and not app.has_perm('crm.quotations', 'approve') then
    raise exception 'Approving or rejecting a quotation requires the APPROVE permission.' using errcode = '42501';
  end if;
  -- Stamp the approver server-side; never trust the client for this.
  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status <> 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  if new.status = 'sent' and old.status <> 'sent' and new.sent_at is null then
    new.sent_at := now();
  end if;
  return new;
end;
$$;

create trigger guard_approval before update on public.quotations
  for each row execute function app.guard_quotation_approval();

create or replace function app.guard_tender_decision()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.bid_decision is distinct from old.bid_decision and new.bid_decision is not null
     and not app.has_perm('crm.tenders', 'approve') then
    raise exception 'The go / no-go decision requires the APPROVE permission.' using errcode = '42501';
  end if;
  if new.bid_decision is distinct from old.bid_decision then
    new.bid_approved_by := case when new.bid_decision is null then null else auth.uid() end;
    new.bid_approved_at := case when new.bid_decision is null then null else now() end;
  end if;
  if new.status = 'submitted' and old.status <> 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

create trigger guard_decision before update on public.tenders
  for each row execute function app.guard_tender_decision();

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------

-- Save a quotation and all of its lines in one transaction.
create or replace function public.save_quotation(p_quotation jsonb, p_items jsonb, p_id uuid default null)
returns uuid
language plpgsql security invoker          -- RLS decides whether this is allowed
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if v_id is null then
    insert into public.quotations (tender_id, lead_id, client_name, client_address, subject, quote_date,
                                   valid_until, terms, notes, assigned_to)
    select nullif(p_quotation->>'tender_id', '')::uuid, nullif(p_quotation->>'lead_id', '')::uuid,
           p_quotation->>'client_name', p_quotation->>'client_address', p_quotation->>'subject',
           coalesce(nullif(p_quotation->>'quote_date', '')::date, (now() at time zone 'Asia/Kolkata')::date),
           nullif(p_quotation->>'valid_until', '')::date, p_quotation->>'terms', p_quotation->>'notes',
           coalesce(nullif(p_quotation->>'assigned_to', '')::uuid, auth.uid())
    returning id into v_id;
  else
    update public.quotations
       set tender_id      = nullif(p_quotation->>'tender_id', '')::uuid,
           lead_id        = nullif(p_quotation->>'lead_id', '')::uuid,
           client_name    = p_quotation->>'client_name',
           client_address = p_quotation->>'client_address',
           subject        = p_quotation->>'subject',
           quote_date     = coalesce(nullif(p_quotation->>'quote_date', '')::date, quote_date),
           valid_until    = nullif(p_quotation->>'valid_until', '')::date,
           terms          = p_quotation->>'terms',
           notes          = p_quotation->>'notes',
           assigned_to    = coalesce(nullif(p_quotation->>'assigned_to', '')::uuid, assigned_to)
     where id = v_id;
    if not found then
      raise exception 'Quotation not found or not permitted.' using errcode = '42501';
    end if;
  end if;

  delete from public.quotation_items where quotation_id = v_id;
  insert into public.quotation_items (quotation_id, line_no, description, hsn_sac, unit, quantity, rate, tax_rate)
  select v_id, row_number() over (), i.description, i.hsn_sac, coalesce(i.unit, 'Nos'),
         coalesce(i.quantity, 0), coalesce(i.rate, 0), coalesce(i.tax_rate, 0)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
       i(description text, hsn_sac text, unit text, quantity numeric, rate numeric, tax_rate numeric)
  where coalesce(trim(i.description), '') <> '';

  -- Totals come from the recalc trigger; make sure an empty quotation is zeroed.
  update public.quotations q set subtotal = 0, tax_total = 0, grand_total = 0
  where q.id = v_id and not exists (select 1 from public.quotation_items where quotation_id = v_id);

  return v_id;
end;
$$;

-- Convert a won lead into a tender record (rare, but keeps the chain).
create or replace function public.log_followup_done(p_id uuid, p_outcome text, p_next timestamptz default null)
returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  update public.follow_ups
     set status = 'done', outcome = p_outcome, completed_at = now(), next_follow_up_at = p_next
   where id = p_id;
  if not found then
    raise exception 'Follow-up not found or not permitted.' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.save_quotation(jsonb, jsonb, uuid), public.log_followup_done(uuid, text, timestamptz) to authenticated;
revoke execute on function public.save_quotation(jsonb, jsonb, uuid), public.log_followup_done(uuid, text, timestamptz) from anon, public;

-- ---------------------------------------------------------------------
-- Dashboard: add the CRM sections (each guarded by its own permission).
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

  -- Leads pipeline
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

  -- Tender pipeline + money at risk
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
        'total',          coalesce(count(*), 0),
        'draft',          coalesce(count(*) filter (where status = 'draft'), 0),
        'sent',           coalesce(count(*) filter (where status in ('sent','under_discussion')), 0),
        'pending_approval', coalesce(count(*) filter (where status = 'draft' and grand_total > 0), 0),
        'approved',       coalesce(count(*) filter (where status = 'approved'), 0),
        'value',          coalesce(sum(grand_total) filter (where status in ('sent','under_discussion','approved')), 0))
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

  return v;
end;
$$;

grant execute on function public.get_dashboard_summary() to authenticated;

-- ---------------------------------------------------------------------
-- Audit: for tables that carry their own module_key (documents), take the
-- module from the row instead of the trigger argument.
-- ---------------------------------------------------------------------
create or replace function app.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_module text := coalesce(nullif(tg_argv[0], ''), v_row->>'module_key');
  v_redact boolean := coalesce(tg_argv[1], '') = 'redact';
  v_id  text  := coalesce(v_row->>'id', v_row->>'employee_id', v_row->>'key');
  v_label text := coalesce(v_row->>'name', v_row->>'full_name', v_row->>'title', v_row->>'label',
                           v_row->>'quotation_no', v_row->>'file_name', v_row->>'key', v_id);
  v_diff jsonb := '{}'::jsonb;
  v_action text;
  k text;
  noisy text[] := array['updated_at','updated_by','created_at','created_by','last_login_at'];
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if not (k = any(noisy)) and (v_new->k) is distinct from (v_old->k) then
        v_diff := v_diff || jsonb_build_object(k,
          case when v_redact then jsonb_build_object('changed', true)
               else jsonb_build_object('from', v_old->k, 'to', v_new->k) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return new;
    end if;
    v_action := case
      when v_diff ? 'deleted_at' and (v_new->>'deleted_at') is not null then 'delete'
      else 'update' end;
  elsif tg_op = 'INSERT' then
    v_action := 'create';
    v_diff := case when v_redact then null else v_new - noisy end;
  else
    v_action := 'delete';
    v_diff := case when v_redact then null else v_old - noisy end;
  end if;

  perform app.write_audit(v_action, v_module, tg_table_name, v_id,
                          initcap(replace(tg_table_name, '_', ' ')) || ' ' || v_action || 'd: ' || coalesce(v_label, ''),
                          v_diff);
  return coalesce(new, old);
end;
$$;

drop trigger audit_row on public.documents;
create trigger audit_row after insert or update or delete on public.documents
  for each row execute function app.audit_row_change('');

-- ---------------------------------------------------------------------
-- Storage: private "documents" bucket.
-- Path convention: <module key>/<entity id>/<uuid>-<file name>, so the
-- first folder decides which module permission is required.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, null)
on conflict (id) do nothing;

create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents'
     and exists (select 1 from public.documents d where d.storage_path = name));

create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
     and (app.has_perm((storage.foldername(name))[1], 'create')
          or app.has_perm((storage.foldername(name))[1], 'edit')));

create policy documents_remove on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
     and (app.has_perm((storage.foldername(name))[1], 'delete')
          or app.has_perm((storage.foldername(name))[1], 'edit')));

-- New sequences (record codes) must be usable by the app role.
grant usage, select on all sequences in schema public to authenticated;
