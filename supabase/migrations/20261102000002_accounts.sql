-- =====================================================================
-- ACCOUNTS — ITS OWN SECTION
--
-- One place for the company's money:
--
--   Bank & Cash         every bank account, cash box, UPI wallet or card,
--                       its opening balance and its running balance.
--   Income & Expenses   money in and out, by date, account, category, party,
--                       mode (cash / bank / UPI / cheque / card), GST part,
--                       reference, project and site. Transfers between
--                       accounts too.
--   Invoices &          customer invoices with lines and GST, due dates,
--   Receivables         part payments received against them, and what is
--                       outstanding or overdue.
--   Bills & Payables    the vendor bills that already exist (with their
--                       project-manager and accounts approvals); payments
--                       against an approved bill are recorded here and a
--                       bill paid in full is marked paid.
--   Overview            this month's income, expenses and net, money to
--                       receive and to pay, balances, overdue invoices.
--
-- "Today in the company" on the Dashboard gains an Accounts card.
-- Access: Super Admin and Admin, the new Accountant role, and Finance.
-- Every table uses the standard RLS generator and the audit log.
-- =====================================================================

-- ------------------------------------------------------------------ section
insert into public.module_groups (key, label, icon, sort_order)
values ('accounts', 'Accounts', 'Wallet', 28)
on conflict (key) do update set label = excluded.label, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions,
   supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, m.key, m.label, m.descr, m.route, m.icon, m.ord, m.actions::public.perm_action[], true, false, true, true, 4
from public.module_groups g,
     (values
       ('acc.overview',     'Overview',               'Income, expenses, money to receive and to pay, balances',
        '/accounts',                'LayoutDashboard', 1, '{view}'),
       ('acc.transactions', 'Income & Expenses',      'Money in and out: account, category, party, mode, GST, project and site',
        '/accounts/transactions',   'ArrowLeftRight',  2, '{view,create,edit,delete,export}'),
       ('acc.invoices',     'Invoices & Receivables', 'Customer invoices with GST, due dates, payments received and what is outstanding',
        '/accounts/invoices',       'ReceiptText',     3, '{view,create,edit,delete,export}'),
       ('acc.bills',        'Bills & Payables',       'Vendor bills, their approvals, payments made and what is still due',
        '/accounts/bills',          'HandCoins',       4, '{view,create,edit,delete,export}'),
       ('acc.banks',        'Bank & Cash',            'Bank accounts and cash: opening balance, running balance, transfers',
        '/accounts/banks',          'Landmark',        5, '{view,create,edit,delete,export}')
     ) as m(key, label, descr, route, icon, ord, actions)
where g.key = 'accounts'
on conflict (key) do update
  set group_id = excluded.group_id, label = excluded.label, description = excluded.description,
      route = excluded.route, icon = excluded.icon, sort_order = excluded.sort_order,
      show_in_nav = true, is_enabled = true, updated_at = now();

-- ------------------------------------------------------------------ the role
insert into public.roles (key, name, description, is_system)
values ('accountant', 'Accountant', 'Keeps the books: income and expenses, invoices, vendor bills and payments, bank and cash', false)
on conflict (key) do nothing;

do $$
declare
  v_mods text[] := array['acc.overview','acc.transactions','acc.invoices','acc.bills','acc.banks'];
begin
  -- Administrators, accountants and finance: everything in Accounts.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a, 'all'
  from public.roles r, public.modules m,
       unnest(array['view','create','edit','delete','export','approve']::public.perm_action[]) a
  where r.key in ('admin', 'accountant', 'finance') and m.key = any (v_mods) and a = any (m.supported_actions)
  on conflict do nothing;
  -- Accountants and finance work the vendor bills: see the vendors, record
  -- bills, give the accounts approval and mark bills paid.
  insert into public.role_permissions (role_id, module_id, action, scope)
  select r.id, m.id, a::public.perm_action, 'all'
  from public.roles r,
       (values ('projects.vendors', 'view'),
               ('projects.bills', 'view'), ('projects.bills', 'create'), ('projects.bills', 'edit'), ('projects.bills', 'export'),
               ('projects.payments', 'view'), ('projects.payments', 'approve'), ('projects.payments', 'export')) p(module, a)
  join public.modules m on m.key = p.module
  where r.key in ('accountant', 'finance') and a::public.perm_action = any (m.supported_actions)
  on conflict do nothing;
end $$;

-- ------------------------------------------------------------------ numbers
create sequence if not exists public.acc_txn_seq;
create sequence if not exists public.acc_invoice_seq;
grant usage, select on sequence public.acc_txn_seq, public.acc_invoice_seq to authenticated;

-- ------------------------------------------------------------------ bank & cash
create table public.acc_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 2 and 120),
  kind            text not null default 'bank' check (kind in ('bank', 'cash', 'upi', 'card', 'other')),
  bank_name       text,
  account_no      text,
  ifsc            text,
  branch          text,
  opening_balance numeric(14,2) not null default 0,
  opening_date    date not null default (now() at time zone 'Asia/Kolkata')::date,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_by      uuid,
  deleted_at      timestamptz
);
create unique index acc_accounts_name_idx on public.acc_accounts(lower(name)) where deleted_at is null;

insert into public.acc_accounts (name, kind, notes) values ('Cash in hand', 'cash', 'Office cash');

-- ------------------------------------------------------------------ invoices
create table public.acc_invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_no       text not null default ('INV-' || lpad(nextval('public.acc_invoice_seq')::text, 4, '0'))
                   check (length(btrim(invoice_no)) between 1 and 40),
  invoice_date     date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_date         date,
  customer_name    text not null check (length(btrim(customer_name)) between 2 and 200),
  customer_gstin   text,
  customer_address text,
  customer_phone   text,
  customer_email   text,
  place_of_supply  text,
  project_id       uuid references public.projects(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  status           text not null default 'sent' check (status in ('draft', 'sent', 'cancelled')),
  notes            text,
  terms            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  deleted_at       timestamptz,
  check (due_date is null or due_date >= invoice_date)
);
create unique index acc_invoices_no_idx on public.acc_invoices(lower(invoice_no)) where deleted_at is null;
create index acc_invoices_date_idx on public.acc_invoices(invoice_date desc) where deleted_at is null;

create table public.acc_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.acc_invoices(id) on delete cascade,
  sort_order  int not null default 1,
  description text not null check (length(btrim(description)) > 0),
  hsn_code    text,
  qty         numeric(14,3) not null default 1 check (qty > 0),
  uom         text not null default 'nos',
  rate        numeric(14,2) not null default 0 check (rate >= 0),
  gst_rate    numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  amount      numeric(14,2) generated always as (round(qty * rate, 2)) stored,
  tax         numeric(14,2) generated always as (round(qty * rate * gst_rate / 100, 2)) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid
);
create index acc_invoice_lines_parent_idx on public.acc_invoice_lines(invoice_id);

-- ------------------------------------------------------------------ transactions
create table public.acc_transactions (
  id            uuid primary key default gen_random_uuid(),
  txn_no        text not null unique default ('TXN-' || lpad(nextval('public.acc_txn_seq')::text, 5, '0')),
  txn_date      date not null default (now() at time zone 'Asia/Kolkata')::date,
  kind          text not null check (kind in ('income', 'expense', 'transfer')),
  account_id    uuid not null references public.acc_accounts(id) on delete restrict,
  to_account_id uuid references public.acc_accounts(id) on delete restrict,
  amount        numeric(14,2) not null check (amount > 0),
  gst_amount    numeric(14,2) not null default 0 check (gst_amount >= 0),
  tds_amount    numeric(14,2) not null default 0 check (tds_amount >= 0),
  category      text,
  party         text,
  mode          text not null default 'bank_transfer'
                check (mode in ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other')),
  reference     text,
  description   text,
  project_id    uuid references public.projects(id) on delete set null,
  site_id       uuid references public.sites(id) on delete set null,
  invoice_id    uuid references public.acc_invoices(id) on delete restrict,
  bill_id       uuid references public.vendor_bills(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  deleted_at    timestamptz,
  check (gst_amount <= amount),
  check ((kind = 'transfer') = (to_account_id is not null)),
  check (to_account_id is distinct from account_id),
  check (invoice_id is null or kind = 'income'),
  check (bill_id is null or kind = 'expense'),
  check (invoice_id is null or bill_id is null)
);
create index acc_txn_date_idx on public.acc_transactions(txn_date desc, created_at desc) where deleted_at is null;
create index acc_txn_account_idx on public.acc_transactions(account_id) where deleted_at is null;
create index acc_txn_invoice_idx on public.acc_transactions(invoice_id) where invoice_id is not null;
create index acc_txn_bill_idx on public.acc_transactions(bill_id) where bill_id is not null;

-- ------------------------------------------------------------------ RLS
select app.apply_standard_policies('acc_accounts', 'acc.banks', null, array['created_by']);
select app.apply_standard_policies('acc_invoices', 'acc.invoices', null, array['created_by']);
select app.apply_standard_policies('acc_invoice_lines', 'acc.invoices', null, array['created_by']);
select app.apply_standard_policies('acc_transactions', 'acc.transactions', null, array['created_by']);

-- Invoice lines are replaced with the invoice's edit right (they carry no deleted_at).
grant delete on public.acc_invoice_lines to authenticated;
create policy lines_delete on public.acc_invoice_lines for delete to authenticated
  using ((select app.has_perm('acc.invoices', 'edit')));

-- ------------------------------------------------------------------ money rules
/** What an invoice is worth: lines plus GST. */
create or replace function app.acc_invoice_total(p_invoice uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(amount + tax), 0) from public.acc_invoice_lines where invoice_id = p_invoice
$$;

/** Received against an invoice; TDS the customer kept counts as settled. */
create or replace function app.acc_invoice_received(p_invoice uuid, p_except uuid default null)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(amount + tds_amount), 0) from public.acc_transactions
  where invoice_id = p_invoice and deleted_at is null and id is distinct from p_except
$$;

/** Paid against a vendor bill. */
create or replace function app.acc_bill_paid(p_bill uuid, p_except uuid default null)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(amount + tds_amount), 0) from public.acc_transactions
  where bill_id = p_bill and deleted_at is null and id is distinct from p_except
$$;

/**
 * Before a transaction is saved: an invoice receipt cannot exceed what is due
 * on a live invoice; a bill payment needs the accounts approval and cannot
 * exceed the bill; the accounts must be live.
 */
create or replace function app.acc_txn_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  inv public.acc_invoices;
  bill public.vendor_bills;
  v_due numeric;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if not exists (select 1 from public.acc_accounts where id = new.account_id and deleted_at is null)
     or (new.to_account_id is not null
         and not exists (select 1 from public.acc_accounts where id = new.to_account_id and deleted_at is null)) then
    raise exception 'Choose a bank or cash account that exists.' using errcode = '22023';
  end if;

  if new.invoice_id is not null then
    select * into inv from public.acc_invoices where id = new.invoice_id and deleted_at is null;
    if inv.id is null then
      raise exception 'That invoice was not found.' using errcode = '22023';
    end if;
    if inv.status <> 'sent' then
      raise exception 'Payments can only be received against a sent invoice (this one is %).', inv.status using errcode = '22023';
    end if;
    v_due := app.acc_invoice_total(inv.id) - app.acc_invoice_received(inv.id, new.id);
    if new.amount + new.tds_amount > v_due + 0.005 then
      raise exception 'Only ₹% is due on invoice %.', round(v_due, 2), inv.invoice_no using errcode = '22023';
    end if;
  end if;

  if new.bill_id is not null then
    select * into bill from public.vendor_bills where id = new.bill_id and deleted_at is null;
    if bill.id is null then
      raise exception 'That vendor bill was not found.' using errcode = '22023';
    end if;
    if bill.status::text not in ('accounts_approved', 'paid') then
      raise exception 'A vendor bill is paid once it has the accounts approval (this one is %).',
        replace(bill.status::text, '_', ' ') using errcode = '22023';
    end if;
    if bill.status = 'paid' and tg_op = 'INSERT' then
      raise exception 'Bill % is already marked paid.', bill.bill_no using errcode = '22023';
    end if;
    v_due := bill.net_amount - app.acc_bill_paid(bill.id, new.id);
    if new.amount + new.tds_amount > v_due + 0.005 then
      raise exception 'Only ₹% is still to pay on bill %.', round(greatest(v_due, 0), 2), bill.bill_no using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger acc_guard before insert or update on public.acc_transactions
  for each row execute function app.acc_txn_guard();

/**
 * After a bill payment is saved or removed: paid in full -> the bill is paid.
 * A bill paid through Accounts whose payments fall short again goes back to
 * approved. (A bill marked paid in Projects, with no payments here, stays paid.)
 */
create or replace function app.acc_txn_sync_bill()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_bill uuid;
  b public.vendor_bills;
  v_paid numeric;
  v_last public.acc_transactions;
begin
  foreach v_bill in array array_remove(array[new.bill_id, case when tg_op = 'UPDATE' then old.bill_id end], null) loop
    select * into b from public.vendor_bills where id = v_bill;
    v_paid := app.acc_bill_paid(v_bill);
    select * into v_last from public.acc_transactions
     where bill_id = v_bill and deleted_at is null order by txn_date desc, created_at desc limit 1;
    perform set_config('app.approval_sync', 'on', true);
    if b.status = 'accounts_approved' and v_paid >= b.net_amount - 0.005 then
      update public.vendor_bills set status = 'paid', paid_on = v_last.txn_date,
             utr_no = coalesce(v_last.reference, utr_no) where id = v_bill;
    elsif b.status = 'paid' and v_paid < b.net_amount - 0.005 then
      update public.vendor_bills set status = 'accounts_approved', paid_on = null where id = v_bill;
    end if;
    perform set_config('app.approval_sync', 'off', true);
  end loop;
  return null;
end;
$$;
create trigger acc_sync_bill after insert or update on public.acc_transactions
  for each row execute function app.acc_txn_sync_bill();

-- An invoice with money received against it is not deleted or turned back into a draft.
create or replace function app.acc_invoice_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.acc_transactions where invoice_id = new.id and deleted_at is null)
     and (new.deleted_at is not null or new.status <> 'sent') then
    raise exception 'Payments are recorded against this invoice; remove them first.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger acc_guard before update on public.acc_invoices
  for each row when (new.deleted_at is distinct from old.deleted_at or new.status is distinct from old.status)
  execute function app.acc_invoice_guard();

-- An account that money moved through is closed (made inactive), not deleted.
create or replace function app.acc_account_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and exists (
       select 1 from public.acc_transactions
       where (account_id = new.id or to_account_id = new.id) and deleted_at is null) then
    raise exception 'Money has moved through this account; mark it inactive instead of deleting it.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger acc_guard before update on public.acc_accounts
  for each row when (new.deleted_at is distinct from old.deleted_at)
  execute function app.acc_account_guard();

-- ------------------------------------------------------------------ balances
/** Every account the caller can see with its balance today (opening + in - out). */
create or replace function public.acc_balances()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', a.id, 'name', a.name, 'kind', a.kind, 'is_active', a.is_active,
           'opening_balance', a.opening_balance,
           'money_in', coalesce(m.money_in, 0), 'money_out', coalesce(m.money_out, 0),
           'balance', a.opening_balance + coalesce(m.money_in, 0) - coalesce(m.money_out, 0))
         order by a.is_active desc, a.name), '[]'::jsonb)
  from public.acc_accounts a
  left join (
    select acc, sum(inn) money_in, sum(outt) money_out from (
      select account_id acc, case when kind = 'income' then amount else 0 end inn,
             case when kind in ('expense', 'transfer') then amount else 0 end outt
      from public.acc_transactions
      union all
      select to_account_id, amount, 0 from public.acc_transactions where kind = 'transfer'
    ) x group by acc
  ) m on m.acc = a.id
$$;
grant execute on function public.acc_balances() to authenticated;

-- ------------------------------------------------------------------ overview
/** The Accounts overview, from what the caller may see. */
create or replace function public.acc_overview()
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', v_today)::date;
begin
  if not app.has_perm('acc.overview', 'view') then
    raise exception 'Access denied: accounts overview.' using errcode = '42501';
  end if;
  return (
    with inv as (
      select i.id, i.invoice_no, i.customer_name, i.invoice_date, i.due_date,
             coalesce((select sum(amount + tax) from public.acc_invoice_lines l where l.invoice_id = i.id), 0) total,
             coalesce((select sum(amount + tds_amount) from public.acc_transactions t where t.invoice_id = i.id), 0) received
      from public.acc_invoices i where i.status = 'sent'
    ),
    bill as (
      select b.id, b.status::text status, b.net_amount,
             case when b.status = 'paid' then b.net_amount
                  else coalesce((select sum(amount + tds_amount) from public.acc_transactions t where t.bill_id = b.id), 0) end paid
      from public.vendor_bills b where b.status::text in ('submitted', 'pm_approved', 'accounts_approved', 'paid')
    ),
    mon as (
      select t.kind, t.amount, t.gst_amount, t.category, t.txn_date from public.acc_transactions t
      where t.txn_date >= (v_month - interval '5 months')::date and t.kind <> 'transfer'
    )
    select jsonb_build_object(
      'month_income', (select coalesce(sum(amount), 0) from mon where kind = 'income' and txn_date >= v_month),
      'month_expense', (select coalesce(sum(amount), 0) from mon where kind = 'expense' and txn_date >= v_month),
      'month_gst_in', (select coalesce(sum(gst_amount), 0) from mon where kind = 'income' and txn_date >= v_month),
      'month_gst_out', (select coalesce(sum(gst_amount), 0) from mon where kind = 'expense' and txn_date >= v_month),
      'receivable', (select coalesce(sum(greatest(total - received, 0)), 0) from inv),
      'receivable_count', (select count(*) from inv where total - received > 0.005),
      'overdue', (select coalesce(sum(greatest(total - received, 0)), 0) from inv where due_date < v_today and total - received > 0.005),
      'overdue_count', (select count(*) from inv where due_date < v_today and total - received > 0.005),
      'payable', (select coalesce(sum(greatest(net_amount - paid, 0)), 0) from bill),
      'payable_count', (select count(*) from bill where net_amount - paid > 0.005),
      'payable_approved', (select coalesce(sum(greatest(net_amount - paid, 0)), 0) from bill where status = 'accounts_approved'),
      'payable_approved_count', (select count(*) from bill where status = 'accounts_approved' and net_amount - paid > 0.005),
      'balances', public.acc_balances(),
      'months', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                   'income', (select coalesce(sum(amount), 0) from mon where kind = 'income' and date_trunc('month', txn_date) = m),
                   'expense', (select coalesce(sum(amount), 0) from mon where kind = 'expense' and date_trunc('month', txn_date) = m))
                 order by m), '[]'::jsonb)
                 from generate_series(v_month - interval '5 months', v_month, interval '1 month') m),
      'top_expenses', (select coalesce(jsonb_agg(x order by (x->>'amount')::numeric desc), '[]'::jsonb) from (
                         select jsonb_build_object('category', coalesce(nullif(category, ''), 'Uncategorised'), 'amount', sum(amount)) x
                         from mon where kind = 'expense' and txn_date >= v_month
                         group by coalesce(nullif(category, ''), 'Uncategorised') order by sum(amount) desc limit 6) t),
      'overdue_invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'invoice_no', invoice_no, 'customer', customer_name,
                             'due_date', due_date, 'due', total - received) order by due_date), '[]'::jsonb)
                           from (select * from inv where due_date < v_today and total - received > 0.005 order by due_date limit 8) o),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'txn_no', txn_no, 'txn_date', txn_date, 'kind', kind,
                   'amount', amount, 'party', party, 'category', category) order by txn_date desc, created_at desc), '[]'::jsonb)
                 from (select * from public.acc_transactions order by txn_date desc, created_at desc limit 8) r)
    ));
end;
$$;
grant execute on function public.acc_overview() to authenticated;

-- ------------------------------------------------------------------ dashboard card
/** Short rupees for a sentence: ₹4,500 · ₹2.35 L · ₹1.20 Cr. */
create or replace function app.inr_short(p numeric)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when abs(coalesce(p, 0)) >= 10000000 then '₹' || to_char(p / 10000000, 'FM999990.00') || ' Cr'
    when abs(coalesce(p, 0)) >= 100000 then '₹' || to_char(p / 100000, 'FM990.00') || ' L'
    else '₹' || to_char(round(coalesce(p, 0)), 'FM99,990')
  end
$$;

alter function public.get_company_today() set schema app;
alter function app.get_company_today() rename to company_today_v2;
revoke all on function app.company_today_v2() from public, anon, authenticated;

create or replace function public.get_company_today()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := app.company_today_v2();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_month date := date_trunc('month', v_today)::date;
  v_in numeric; v_out numeric; v_recv numeric; v_pay numeric; v_bal numeric;
  v_overdue int; v_overdue_amt numeric; v_pay_n int;
  v_light text;
begin
  if app.has_perm('acc.overview', 'view') then
    select coalesce(sum(amount) filter (where kind = 'income'), 0), coalesce(sum(amount) filter (where kind = 'expense'), 0)
      into v_in, v_out
      from public.acc_transactions where deleted_at is null and txn_date >= v_month;
    with inv as (
      select i.due_date,
             coalesce((select sum(amount + tax) from public.acc_invoice_lines l where l.invoice_id = i.id), 0)
             - coalesce((select sum(amount + tds_amount) from public.acc_transactions t
                         where t.invoice_id = i.id and t.deleted_at is null), 0) due
      from public.acc_invoices i where i.deleted_at is null and i.status = 'sent')
    select coalesce(sum(greatest(due, 0)), 0), count(*) filter (where due > 0.005 and due_date < v_today),
           coalesce(sum(due) filter (where due > 0.005 and due_date < v_today), 0)
      into v_recv, v_overdue, v_overdue_amt from inv;
    select coalesce(sum(greatest(b.net_amount - coalesce((select sum(amount + tds_amount) from public.acc_transactions t
                                                          where t.bill_id = b.id and t.deleted_at is null), 0), 0)), 0),
           count(*)
      into v_pay, v_pay_n
      from public.vendor_bills b where b.deleted_at is null and b.status = 'accounts_approved';
    select coalesce(sum(a.opening_balance), 0)
           + coalesce((select sum(case when kind = 'income' then amount when kind = 'expense' then -amount else 0 end)
                       from public.acc_transactions where deleted_at is null), 0)
      into v_bal from public.acc_accounts a where a.deleted_at is null;

    v_light := case when v_overdue > 0 or v_bal < 0 then 'bad' when v_pay_n > 0 or v_out > v_in then 'ok' else 'good' end;
    v := jsonb_set(v, '{sections}', coalesce(v->'sections', '[]'::jsonb) || jsonb_build_object(
      'key', 'accounts', 'title', 'Accounts', 'route', '/accounts', 'status', v_light,
      'headline', format('%s overdue invoice(s)', v_overdue),
      'facts', jsonb_build_array(
        format('This month: in %s · out %s · net %s', app.inr_short(v_in), app.inr_short(v_out), app.inr_short(v_in - v_out)),
        format('To receive %s%s', app.inr_short(v_recv),
               case when v_overdue > 0 then format(' (%s overdue)', app.inr_short(v_overdue_amt)) else '' end),
        format('To pay %s on %s approved bill(s)', app.inr_short(v_pay), v_pay_n),
        format('Bank & cash balance %s', app.inr_short(v_bal)))));
  end if;
  return v;
end;
$$;
grant execute on function public.get_company_today() to authenticated;
revoke execute on function public.get_company_today() from anon, public;
