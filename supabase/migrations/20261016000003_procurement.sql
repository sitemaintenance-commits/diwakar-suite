-- =====================================================================
-- PROCUREMENT — ITS OWN SECTION
--
-- What existed was scattered: a vendor master under Projects, material
-- lines per project with a typed-in PO number, vendor bills with no link to
-- an order, and "Purchase" / "Procurement" request types in Approvals. Now
-- there is one section for the whole buying cycle:
--
--   Purchase requisition (a site, project or department asks)
--     -> approved in the Approvals section (linked request)
--   Purchase order to a vendor (lines, GST, totals)
--     -> approved in the Approvals section (linked request)
--   Goods receipt against the order (accepted / rejected quantities)
--     -> updates what the order has received, and the stock
--   Stores & inventory: item master, stock by store or site, issues to a
--     project, site or ticket, and the ledger of every movement.
--   Vendors move here from Projects; vendor bills can name their order.
--
-- Every table uses the standard RLS generator and the audit log.
-- =====================================================================

-- ------------------------------------------------------------------ section
insert into public.module_groups (key, label, icon, sort_order)
values ('procurement', 'Procurement', 'ShoppingCart', 27)
on conflict (key) do update set label = excluded.label, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, m.key, m.label, m.descr, m.route, m.icon, m.ord, m.actions::public.perm_action[], true, false, true, true, 4
from public.module_groups g,
     (values
       ('proc.dashboard',    'Overview',               'Open requisitions and orders, overdue deliveries, spend and low stock',
        '/procurement',              'LayoutDashboard', 1, '{view}'),
       ('proc.requisitions', 'Purchase Requisitions',  'Requests for material from sites, projects and departments',
        '/procurement/requisitions', 'ClipboardList',   2, '{view,create,edit,delete,export,approve}'),
       ('proc.orders',       'Purchase Orders',        'Orders to vendors with lines, GST, delivery and status',
        '/procurement/orders',       'FileText',        3, '{view,create,edit,delete,export,approve}'),
       ('proc.receipts',     'Goods Receipts',         'Material received against orders: accepted and rejected quantities',
        '/procurement/receipts',     'PackageCheck',    4, '{view,create,edit,delete,export}'),
       ('proc.inventory',    'Stores & Inventory',     'Item master, stock by store and site, issues and the movement ledger',
        '/procurement/inventory',    'Warehouse',       5, '{view,create,edit,delete,export}')
     ) as m(key, label, descr, route, icon, ord, actions)
where g.key = 'procurement'
on conflict (key) do update
  set group_id = excluded.group_id, label = excluded.label, description = excluded.description,
      route = excluded.route, icon = excluded.icon, sort_order = excluded.sort_order,
      show_in_nav = true, is_enabled = true, updated_at = now();

-- The vendor master belongs to procurement.
update public.modules m
   set group_id = g.id, route = '/procurement/vendors', sort_order = 6, updated_at = now()
  from public.module_groups g
 where g.key = 'procurement' and m.key = 'projects.vendors';

-- ------------------------------------------------------------------ the role
insert into public.roles (key, name, description, is_system)
values ('procurement', 'Procurement & Stores', 'Buys and stores material: requisitions, orders, receipts, stock and vendors', false)
on conflict (key) do nothing;

do $$
declare
  v_mods text[] := array['proc.dashboard','proc.requisitions','proc.orders','proc.receipts','proc.inventory','projects.vendors'];
begin
  -- Administrators and the procurement team: everything.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'all'
  from public.roles r, public.modules m,
       unnest(array['view','create','edit','delete','export','approve']::public.perm_action[]) a
  where r.key in ('admin', 'procurement') and m.key = any (v_mods) and a = any (m.supported_actions)
  on conflict do nothing;
  -- Management, Director, Finance: see it all and approve.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'all'
  from public.roles r, public.modules m, unnest(array['view','export','approve']::public.perm_action[]) a
  where r.key in ('management', 'director', 'finance') and m.key = any (v_mods) and a = any (m.supported_actions)
  on conflict do nothing;
  -- Project managers, site engineers and the O&M manager raise requisitions
  -- (their own) and follow orders, receipts and stock.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, case when m.key = 'proc.requisitions' then 'own'::public.perm_scope else 'all'::public.perm_scope end
  from public.roles r, public.modules m,
       unnest(array['view','create','edit']::public.perm_action[]) a
  where r.key in ('project_manager', 'site_engineer', 'om_manager')
    and m.key = 'proc.requisitions'
  on conflict do nothing;
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'view', 'all'
  from public.roles r, public.modules m
  where r.key in ('project_manager', 'site_engineer', 'om_manager')
    and m.key in ('proc.dashboard', 'proc.orders', 'proc.receipts', 'proc.inventory')
  on conflict do nothing;
  -- Site people record what arrived at their site.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, 'create', 'all'
  from public.roles r, public.modules m
  where r.key in ('project_manager', 'site_engineer') and m.key = 'proc.receipts'
  on conflict do nothing;
end $$;

-- ------------------------------------------------------------------ numbers
create sequence if not exists public.proc_item_seq;
create sequence if not exists public.proc_req_seq;
create sequence if not exists public.proc_po_seq;
create sequence if not exists public.proc_grn_seq;
grant usage, select on sequence public.proc_item_seq, public.proc_req_seq, public.proc_po_seq, public.proc_grn_seq to authenticated;

-- ------------------------------------------------------------------ items
create table public.proc_items (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default ('ITM-' || lpad(nextval('public.proc_item_seq')::text, 4, '0')),
  name        text not null check (length(btrim(name)) between 2 and 200),
  category    text not null default 'Other',
  uom         text not null default 'nos',
  hsn_code    text,
  gst_rate    numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  spec        text,
  min_stock   numeric(14,3) not null default 0 check (min_stock >= 0),
  last_rate   numeric(14,2),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  deleted_at  timestamptz
);
create unique index proc_items_name_idx on public.proc_items(lower(name)) where deleted_at is null;

-- ------------------------------------------------------------------ requisitions
create table public.proc_requisitions (
  id            uuid primary key default gen_random_uuid(),
  req_no        text not null unique default ('PR-' || lpad(nextval('public.proc_req_seq')::text, 4, '0')),
  title         text not null check (length(btrim(title)) between 3 and 200),
  project_id    uuid references public.projects(id) on delete set null,
  site_id       uuid references public.sites(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  required_by   date,
  priority      text not null default 'normal' check (priority in ('normal', 'urgent')),
  status        text not null default 'draft'
                check (status in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'closed', 'cancelled')),
  notes         text,
  requested_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  deleted_at    timestamptz
);
create index proc_requisitions_status_idx on public.proc_requisitions(status, created_at desc) where deleted_at is null;

create table public.proc_requisition_lines (
  id             uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.proc_requisitions(id) on delete cascade,
  sort_order     int not null default 1,
  item_id        uuid references public.proc_items(id) on delete set null,
  description    text not null check (length(btrim(description)) > 0),
  qty            numeric(14,3) not null default 1 check (qty > 0),
  uom            text not null default 'nos',
  est_rate       numeric(14,2) not null default 0 check (est_rate >= 0),
  amount         numeric(14,2) generated always as (round(qty * est_rate, 2)) stored,
  remarks        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid
);
create index proc_requisition_lines_parent_idx on public.proc_requisition_lines(requisition_id);

-- ------------------------------------------------------------------ orders
create table public.proc_purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  po_no            text not null unique default ('PO-' || lpad(nextval('public.proc_po_seq')::text, 4, '0')),
  vendor_id        uuid not null references public.vendors(id) on delete restrict,
  requisition_id   uuid references public.proc_requisitions(id) on delete set null,
  project_id       uuid references public.projects(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  po_date          date not null default (now() at time zone 'Asia/Kolkata')::date,
  delivery_date    date,
  delivery_address text,
  payment_terms    text,
  freight          numeric(14,2) not null default 0 check (freight >= 0),
  status           text not null default 'draft'
                   check (status in ('draft', 'approved', 'issued', 'partially_received', 'received', 'closed', 'cancelled')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  deleted_at       timestamptz
);
create index proc_po_status_idx on public.proc_purchase_orders(status, po_date desc) where deleted_at is null;
create index proc_po_vendor_idx on public.proc_purchase_orders(vendor_id) where deleted_at is null;

create table public.proc_po_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references public.proc_purchase_orders(id) on delete cascade,
  sort_order   int not null default 1,
  item_id      uuid references public.proc_items(id) on delete set null,
  description  text not null check (length(btrim(description)) > 0),
  qty          numeric(14,3) not null check (qty > 0),
  uom          text not null default 'nos',
  rate         numeric(14,2) not null default 0 check (rate >= 0),
  gst_rate     numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  amount       numeric(14,2) generated always as (round(qty * rate, 2)) stored,
  tax          numeric(14,2) generated always as (round(qty * rate * gst_rate / 100, 2)) stored,
  received_qty numeric(14,3) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid
);
create index proc_po_lines_parent_idx on public.proc_po_lines(po_id);

-- Vendor bills can name the order they are for.
alter table public.vendor_bills add column if not exists po_id uuid references public.proc_purchase_orders(id) on delete set null;
alter table public.vendor_bills alter column project_id drop not null;

-- ------------------------------------------------------------------ receipts
create table public.proc_receipts (
  id            uuid primary key default gen_random_uuid(),
  grn_no        text not null unique default ('GRN-' || lpad(nextval('public.proc_grn_seq')::text, 4, '0')),
  po_id         uuid not null references public.proc_purchase_orders(id) on delete restrict,
  receipt_date  date not null default (now() at time zone 'Asia/Kolkata')::date,
  site_id       uuid references public.sites(id) on delete set null,   -- null = the main store
  challan_no    text,
  invoice_no    text,
  vehicle_no    text,
  received_by   text,
  remarks       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  deleted_at    timestamptz
);
create index proc_receipts_po_idx on public.proc_receipts(po_id);

create table public.proc_receipt_lines (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references public.proc_receipts(id) on delete cascade,
  po_line_id   uuid not null references public.proc_po_lines(id) on delete restrict,
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  qty_accepted numeric(14,3) not null default 0 check (qty_accepted >= 0),
  qty_rejected numeric(14,3) generated always as (qty_received - qty_accepted) stored,
  remarks      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_by   uuid,
  check (qty_accepted <= qty_received)
);
create index proc_receipt_lines_parent_idx on public.proc_receipt_lines(receipt_id);

-- ------------------------------------------------------------------ stock ledger
create table public.proc_stock_moves (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.proc_items(id) on delete restrict,
  move_date   date not null default (now() at time zone 'Asia/Kolkata')::date,
  kind        text not null check (kind in ('receipt', 'issue', 'transfer', 'adjustment', 'return', 'opening')),
  qty         numeric(14,3) not null check (qty <> 0),          -- + in, - out
  site_id     uuid references public.sites(id) on delete set null,     -- where; null = main store
  project_id  uuid references public.projects(id) on delete set null,  -- issued to / for
  ticket_id   uuid references public.maintenance_tickets(id) on delete set null,
  receipt_id  uuid references public.proc_receipts(id) on delete cascade,
  rate        numeric(14,2),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid
);
create index proc_stock_moves_item_idx on public.proc_stock_moves(item_id, site_id);

-- ------------------------------------------------------------------ RLS
select app.apply_standard_policies('proc_items', 'proc.inventory', null, array['created_by']);
select app.apply_standard_policies('proc_requisitions', 'proc.requisitions', null, array['created_by', 'requested_by']);
select app.apply_standard_policies('proc_requisition_lines', 'proc.requisitions', null, array['created_by']);
select app.apply_standard_policies('proc_purchase_orders', 'proc.orders', null, array['created_by']);
select app.apply_standard_policies('proc_po_lines', 'proc.orders', null, array['created_by']);
select app.apply_standard_policies('proc_receipts', 'proc.receipts', null, array['created_by']);
select app.apply_standard_policies('proc_receipt_lines', 'proc.receipts', null, array['created_by']);
select app.apply_standard_policies('proc_stock_moves', 'proc.inventory', null, array['created_by']);

-- Lines are removed with their parent's edit right (they carry no deleted_at).
grant delete on public.proc_requisition_lines, public.proc_po_lines to authenticated;
create policy lines_delete on public.proc_requisition_lines for delete to authenticated
  using ((select app.has_perm('proc.requisitions', 'edit'))
         and exists (select 1 from public.proc_requisitions r where r.id = requisition_id and r.status in ('draft', 'rejected')));
create policy lines_delete on public.proc_po_lines for delete to authenticated
  using ((select app.has_perm('proc.orders', 'edit'))
         and exists (select 1 from public.proc_purchase_orders p where p.id = po_id and p.status = 'draft'));

-- ------------------------------------------------------------------ receipts move stock
/** A receipt line adds what was accepted to the order line, to stock, and moves the order's status. */
create or replace function app.proc_receipt_line_posted()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  l public.proc_po_lines;
  r public.proc_receipts;
  v_open numeric;
begin
  select * into l from public.proc_po_lines where id = new.po_line_id;
  select * into r from public.proc_receipts where id = new.receipt_id;
  if l.po_id is distinct from r.po_id then
    raise exception 'That line is not on this order.' using errcode = '22023';
  end if;
  if new.qty_accepted > 0 and l.received_qty + new.qty_accepted > l.qty * 1.1 then
    raise exception 'More than the ordered quantity (plus 10%%) would be received for %.', l.description using errcode = '22023';
  end if;

  update public.proc_po_lines set received_qty = received_qty + new.qty_accepted where id = l.id;
  if l.item_id is not null and new.qty_accepted > 0 then
    insert into public.proc_stock_moves (item_id, move_date, kind, qty, site_id, project_id, receipt_id, rate, notes)
    select l.item_id, r.receipt_date, 'receipt', new.qty_accepted, r.site_id, po.project_id, r.id, l.rate, r.grn_no || ' against ' || po.po_no
    from public.proc_purchase_orders po where po.id = r.po_id;
    update public.proc_items set last_rate = l.rate where id = l.item_id;
  end if;

  select sum(greatest(qty - received_qty, 0)) into v_open from public.proc_po_lines where po_id = r.po_id;
  update public.proc_purchase_orders
     set status = case when v_open <= 0 then 'received' else 'partially_received' end
   where id = r.po_id and status in ('approved', 'issued', 'partially_received');
  return new;
end;
$$;
create trigger posted after insert on public.proc_receipt_lines
  for each row execute function app.proc_receipt_line_posted();
-- A posted receipt line is a fact: correct it with a stock adjustment, not an edit.
create or replace function app.proc_receipt_line_frozen()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.qty_received, new.qty_accepted, new.po_line_id) is distinct from (old.qty_received, old.qty_accepted, old.po_line_id) then
    raise exception 'A posted receipt cannot be changed; record a stock adjustment instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger frozen before update on public.proc_receipt_lines
  for each row execute function app.proc_receipt_line_frozen();

-- An order's lines are fixed once it leaves draft.
create or replace function app.proc_po_line_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.proc_purchase_orders where id = coalesce(new.po_id, old.po_id);
  if tg_op = 'UPDATE' and (new.received_qty is distinct from old.received_qty)
     and (new.qty, new.rate, new.gst_rate, new.description) is not distinct from (old.qty, old.rate, old.gst_rate, old.description) then
    return new;   -- receipts update this
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'The order is %; its lines cannot change.', v_status using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger guard before insert or update or delete on public.proc_po_lines
  for each row execute function app.proc_po_line_guard();

-- ------------------------------------------------------------------ stock
/** Stock on hand per item and place (null place = the main store), for the caller. */
create or replace function public.proc_stock()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', s.item_id, 'site_id', s.site_id, 'site', st.name, 'qty', s.qty) order by s.item_id), '[]'::jsonb)
  from (select item_id, site_id, sum(qty) as qty from public.proc_stock_moves group by item_id, site_id) s
  left join public.sites st on st.id = s.site_id
  where s.qty <> 0
$$;
grant execute on function public.proc_stock() to authenticated;

/** Issues stock to a project, site or ticket; refuses to go below zero at the place it comes from. */
create or replace function public.proc_issue_stock(p_item uuid, p_qty numeric, p_from_site uuid default null,
                                                   p_project uuid default null, p_to_site uuid default null,
                                                   p_ticket uuid default null, p_notes text default null)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_have numeric;
begin
  if not app.has_perm('proc.inventory', 'create') then
    raise exception 'Issuing stock requires CREATE on Stores & Inventory.' using errcode = '42501';
  end if;
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'Give a quantity above zero.' using errcode = '22023';
  end if;
  select coalesce(sum(qty), 0) into v_have from public.proc_stock_moves
   where item_id = p_item and site_id is not distinct from p_from_site;
  if v_have < p_qty then
    raise exception 'Only % in stock there.', v_have using errcode = '22023';
  end if;
  insert into public.proc_stock_moves (item_id, kind, qty, site_id, project_id, ticket_id, notes)
  values (p_item, case when p_to_site is not null then 'transfer' else 'issue' end, -p_qty, p_from_site, p_project, p_ticket, p_notes);
  if p_to_site is not null then
    insert into public.proc_stock_moves (item_id, kind, qty, site_id, project_id, notes)
    values (p_item, 'transfer', p_qty, p_to_site, p_project, coalesce(p_notes, 'Transfer in'));
  end if;
end;
$$;
grant execute on function public.proc_issue_stock(uuid, numeric, uuid, uuid, uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------ overview
create or replace function public.proc_dashboard()
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', v_today)::date;
begin
  if not app.has_perm('proc.dashboard', 'view') then
    raise exception 'Access denied: procurement overview.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'requisitions_waiting', (select count(*) from public.proc_requisitions where status = 'submitted'),
    'requisitions_to_order', (select count(*) from public.proc_requisitions where status = 'approved'),
    'orders_open', (select count(*) from public.proc_purchase_orders where status in ('approved', 'issued', 'partially_received')),
    'orders_draft', (select count(*) from public.proc_purchase_orders where status = 'draft'),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'po_no', po.po_no, 'vendor', v.name,
                                  'delivery_date', po.delivery_date, 'status', po.status) order by po.delivery_date)
                         from public.proc_purchase_orders po join public.vendors v on v.id = po.vendor_id
                         where po.status in ('approved', 'issued', 'partially_received') and po.delivery_date < v_today), '[]'::jsonb),
    'spend_month', (select coalesce(sum(l.amount + l.tax), 0) + coalesce((select sum(freight) from public.proc_purchase_orders
                                                                          where po_date >= v_month and status not in ('draft', 'cancelled')), 0)
                    from public.proc_po_lines l join public.proc_purchase_orders po on po.id = l.po_id
                    where po.po_date >= v_month and po.status not in ('draft', 'cancelled')),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'name', i.name, 'uom', i.uom,
                                  'stock', coalesce(s.qty, 0), 'min_stock', i.min_stock) order by i.name)
                           from public.proc_items i
                           left join (select item_id, sum(qty) qty from public.proc_stock_moves group by item_id) s on s.item_id = i.id
                           where i.is_active and i.min_stock > 0 and coalesce(s.qty, 0) < i.min_stock), '[]'::jsonb),
    'top_vendors', coalesce((select jsonb_agg(x order by (x->>'spend')::numeric desc) from (
                               select jsonb_build_object('vendor', v.name, 'orders', count(distinct po.id),
                                                         'spend', sum(l.amount + l.tax)) x
                               from public.proc_purchase_orders po
                               join public.vendors v on v.id = po.vendor_id
                               join public.proc_po_lines l on l.po_id = po.id
                               where po.status not in ('draft', 'cancelled') and po.po_date >= v_today - 365
                               group by v.name order by sum(l.amount + l.tax) desc limit 5) t), '[]'::jsonb),
    'recent_receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'grn_no', r.grn_no, 'po_no', po.po_no,
                                       'vendor', v.name, 'receipt_date', r.receipt_date) order by r.receipt_date desc, r.created_at desc)
                                 from (select * from public.proc_receipts order by receipt_date desc, created_at desc limit 5) r
                                 join public.proc_purchase_orders po on po.id = r.po_id
                                 join public.vendors v on v.id = po.vendor_id), '[]'::jsonb));
end;
$$;
grant execute on function public.proc_dashboard() to authenticated;

-- ------------------------------------------------------------------ approvals link
alter table public.approval_requests drop constraint if exists approval_requests_source_type_check;
alter table public.approval_requests add constraint approval_requests_source_type_check
  check (source_type in ('project_approval', 'vendor_bill', 'requisition', 'purchase_order'));

/** The project of a linked item, and whether the caller can see it at all (runs as the caller). */
create or replace function app.approval_source_info(p_type text, p_id uuid, out visible boolean, out project uuid)
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  visible := false;
  if p_type = 'project_approval' then
    select true, project_id into visible, project from public.project_approvals where id = p_id and deleted_at is null;
  elsif p_type = 'vendor_bill' then
    select true, project_id into visible, project from public.vendor_bills where id = p_id and deleted_at is null;
  elsif p_type = 'requisition' then
    select true, project_id into visible, project from public.proc_requisitions where id = p_id and deleted_at is null;
  elsif p_type = 'purchase_order' then
    select true, project_id into visible, project from public.proc_purchase_orders where id = p_id and deleted_at is null;
  end if;
  visible := coalesce(visible, false);
end;
$$;
grant execute on function app.approval_source_info(text, uuid) to authenticated;

create or replace function public.approval_link_source(p_request uuid, p_type text, p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  info record;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_request;
  if a.id is null or a.requested_by is distinct from auth.uid() then
    raise exception 'Only the requester can link this request.' using errcode = '42501';
  end if;
  if a.status in ('cancelled', 'completed', 'rejected') then
    raise exception 'This request is closed.' using errcode = '22023';
  end if;
  if p_type not in ('project_approval', 'vendor_bill', 'requisition', 'purchase_order') then
    raise exception 'Unknown item type.' using errcode = '22023';
  end if;
  select * into info from app.approval_source_info(p_type, p_id);
  if not info.visible then
    raise exception 'That item was not found, or you cannot see it.' using errcode = '42501';
  end if;
  update public.approval_requests
     set source_type = p_type, source_id = p_id, project_id = coalesce(info.project, project_id), updated_by = auth.uid()
   where id = p_request;
  -- A requisition sent for approval is "submitted" until it is decided.
  if p_type = 'requisition' then
    perform set_config('app.approval_sync', 'on', true);
    update public.proc_requisitions set status = 'submitted' where id = p_id and status in ('draft', 'rejected');
    perform set_config('app.approval_sync', 'off', true);
  end if;
  perform app.approval_log(p_request, 'edited', null, null, null, null, 'Requester',
    jsonb_build_object('changes', jsonb_build_object('linked to', jsonb_build_object('from', null,
      'to', replace(p_type, '_', ' ')))));
end;
$$;

/** Requests linked to procurement items the caller can see, newest first. */
create or replace function public.proc_approval_requests()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'request_no', a.request_no, 'title', a.title, 'category', a.category,
           'status', a.status, 'amount', a.amount, 'project_id', a.project_id,
           'source_type', a.source_type, 'source_id', a.source_id,
           'requester', app.user_name(a.requested_by), 'created_at', a.created_at,
           'current_approver', (select app.step_approver_label(s.id) from public.approval_steps s
                                where s.request_id = a.id and s.round = a.round and s.status = 'pending'
                                order by s.level_no limit 1))
         order by a.created_at desc), '[]'::jsonb)
  from public.approval_requests a
  where a.source_type in ('requisition', 'purchase_order')
    and (a.status <> 'draft' or a.requested_by = auth.uid())
    and app.can_see_approval(a.id)
$$;
revoke all on function public.proc_approval_requests() from public, anon;
grant execute on function public.proc_approval_requests() to authenticated;

/** A decision on a linked request moves its vendor bill, requisition or order. */
create or replace function app.sync_approval_source()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.source_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  perform set_config('app.approval_sync', 'on', true);
  if new.source_type = 'vendor_bill' then
    if new.status = 'approved' then
      update public.vendor_bills
         set status = 'accounts_approved',
             pm_approved_by = coalesce(pm_approved_by, auth.uid()),
             pm_approved_at = coalesce(pm_approved_at, now()),
             accounts_approved_by = auth.uid(),
             accounts_approved_at = now()
       where id = new.source_id and status in ('submitted', 'pm_approved');
    elsif new.status = 'rejected' then
      update public.vendor_bills set status = 'rejected'
       where id = new.source_id and status in ('submitted', 'pm_approved');
    end if;
  elsif new.source_type = 'requisition' then
    update public.proc_requisitions
       set status = case new.status when 'approved' then 'approved' when 'rejected' then 'rejected'
                                     when 'returned' then 'draft' when 'cancelled' then 'draft' else status end
     where id = new.source_id and status in ('draft', 'submitted');
  elsif new.source_type = 'purchase_order' then
    if new.status = 'approved' then
      update public.proc_purchase_orders set status = 'approved' where id = new.source_id and status = 'draft';
    end if;
  end if;
  perform set_config('app.approval_sync', 'off', true);
  return new;
end;
$$;

-- A requisition's decision belongs to the approval chain when it has one.
create or replace function app.proc_requisition_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status or coalesce(current_setting('app.approval_sync', true), '') = 'on' then
    return new;
  end if;
  if new.status in ('approved', 'rejected') and not app.has_perm('proc.requisitions', 'approve') then
    raise exception 'Approving a requisition needs APPROVE, or send it through the Approvals section.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_status before update on public.proc_requisitions
  for each row execute function app.proc_requisition_guard();

create or replace function app.proc_po_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status or coalesce(current_setting('app.approval_sync', true), '') = 'on' then
    return new;
  end if;
  if new.status = 'approved' and not app.has_perm('proc.orders', 'approve') then
    raise exception 'Approving an order needs APPROVE, or send it through the Approvals section.' using errcode = '42501';
  end if;
  if new.status = 'issued' and old.status <> 'approved' then
    raise exception 'An order is issued to the vendor once it is approved.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger guard_status before update on public.proc_purchase_orders
  for each row execute function app.proc_po_guard();
