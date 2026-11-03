// Accounts: bank & cash, income & expenses, invoices & receivables, vendor
// bills & payables. Tables are read through RLS (acc.* modules; vendor bills
// through projects.bills); balances and the overview come from RPCs. The
// database checks the money rules: a receipt cannot exceed what is due on an
// invoice, a bill is paid only after its accounts approval, and a bill paid
// in full is marked paid.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BadgeTone } from '@/lib/types';
import type { VendorBill } from '@/features/projects/api';

export const ACCOUNT_KINDS: Record<string, string> = {
  bank: 'Bank account', cash: 'Cash', upi: 'UPI / wallet', card: 'Card', other: 'Other',
};
export const MODES: Record<string, string> = {
  bank_transfer: 'Bank transfer (NEFT / RTGS / IMPS)', upi: 'UPI', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other',
};
export const KIND_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  income: { label: 'Money in', tone: 'success' },
  expense: { label: 'Money out', tone: 'destructive' },
  transfer: { label: 'Transfer', tone: 'info' },
};
export const INCOME_CATEGORIES = [
  'Project billing', 'O&M service', 'Energy sale', 'Customer advance', 'Subsidy', 'Interest', 'Refund received', 'Other income',
];
export const EXPENSE_CATEGORIES = [
  'Material purchase', 'Vendor payment', 'Salaries & wages', 'Site expenses', 'Travel & conveyance', 'Fuel', 'Rent',
  'Electricity & utilities', 'Office expenses', 'Repairs & maintenance', 'Professional fees', 'Bank charges',
  'Taxes & duties (GST / TDS)', 'Insurance', 'Loan / EMI', 'Marketing', 'Other expense',
];
export const INVOICE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  sent: { label: 'Sent', tone: 'info' },
  part_paid: { label: 'Part paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export interface AccAccount {
  id: string;
  name: string;
  kind: string;
  bank_name: string | null;
  account_no: string | null;
  ifsc: string | null;
  branch: string | null;
  opening_balance: number;
  opening_date: string;
  is_active: boolean;
  notes: string | null;
}
export interface Balance {
  account_id: string;
  name: string;
  kind: string;
  is_active: boolean;
  opening_balance: number;
  money_in: number;
  money_out: number;
  balance: number;
}
export interface Txn {
  id: string;
  txn_no: string;
  txn_date: string;
  kind: 'income' | 'expense' | 'transfer';
  account_id: string;
  to_account_id: string | null;
  amount: number;
  gst_amount: number;
  tds_amount: number;
  category: string | null;
  party: string | null;
  mode: string;
  reference: string | null;
  description: string | null;
  project_id: string | null;
  site_id: string | null;
  invoice_id: string | null;
  bill_id: string | null;
  created_at: string;
}
export interface InvoiceLine {
  id?: string;
  sort_order?: number;
  description: string;
  hsn_code: string | null;
  qty: number | string;
  uom: string;
  rate: number | string;
  gst_rate: number | string;
  amount?: number;
  tax?: number;
}
export interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_name: string;
  customer_gstin: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  place_of_supply: string | null;
  project_id: string | null;
  site_id: string | null;
  status: 'draft' | 'sent' | 'cancelled';
  notes: string | null;
  terms: string | null;
  created_at: string;
  lines: InvoiceLine[];
}
export interface AccOverview {
  month_income: number;
  month_expense: number;
  month_gst_in: number;
  month_gst_out: number;
  receivable: number;
  receivable_count: number;
  overdue: number;
  overdue_count: number;
  payable: number;
  payable_count: number;
  payable_approved: number;
  payable_approved_count: number;
  balances: Balance[];
  months: { month: string; income: number; expense: number }[];
  top_expenses: { category: string; amount: number }[];
  overdue_invoices: { id: string; invoice_no: string; customer: string; due_date: string; due: number }[];
  recent: { id: string; txn_no: string; txn_date: string; kind: Txn['kind']; amount: number; party: string | null; category: string | null }[];
}

export const num = (v: unknown) => (v === '' || v == null ? 0 : Number(v));

export const invoiceTotals = (inv: Pick<Invoice, 'lines'>) => {
  const sub = inv.lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const tax = inv.lines.reduce((s, l) => s + (num(l.qty) * num(l.rate) * num(l.gst_rate)) / 100, 0);
  return { sub: round2(sub), tax: round2(tax), total: round2(sub + tax) };
};
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Money received and settled (incl. TDS the customer kept) per invoice, money paid per bill. */
export function settledBy(txns: Txn[], key: 'invoice_id' | 'bill_id') {
  const m = new Map<string, number>();
  for (const t of txns) {
    const id = t[key];
    if (id) m.set(id, (m.get(id) ?? 0) + num(t.amount) + num(t.tds_amount));
  }
  return m;
}

/** An invoice's state for the list: draft, sent, part paid, paid, overdue, cancelled. */
export function invoiceState(inv: Invoice, received: number, today: string) {
  const { total } = invoiceTotals(inv);
  const due = round2(Math.max(total - received, 0));
  if (inv.status !== 'sent') return { key: inv.status, total, received, due };
  if (due <= 0.005 && total > 0) return { key: 'paid', total, received, due: 0 };
  if (inv.due_date && inv.due_date < today) return { key: 'overdue', total, received, due };
  return { key: received > 0 ? 'part_paid' : 'sent', total, received, due };
}

/** What is still to pay on a bill; a bill marked paid in Projects (no payments here) counts as paid. */
export function billState(b: VendorBill, paid: number) {
  const net = num(b.net_amount);
  const settled = b.status === 'paid' && paid === 0 ? net : paid;
  return { net, paid: settled, due: b.status === 'rejected' ? 0 : round2(Math.max(net - settled, 0)) };
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return data as T;
}

export function useAccounts() {
  return useQuery({
    queryKey: ['acc', 'accounts'],
    queryFn: () => rows<AccAccount[]>(supabase.from('acc_accounts').select('*').order('is_active', { ascending: false }).order('name')),
  });
}
export function useBalances() {
  return useQuery({
    queryKey: ['acc', 'balances'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('acc_balances');
      if (error) throw error;
      return (data ?? []) as Balance[];
    },
  });
}
export function useTxns() {
  return useQuery({
    queryKey: ['acc', 'txns'],
    queryFn: () => rows<Txn[]>(supabase.from('acc_transactions').select('*')
      .order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(5000)),
  });
}
export function useInvoices() {
  return useQuery({
    queryKey: ['acc', 'invoices'],
    queryFn: async () => {
      const list = await rows<Invoice[]>(supabase.from('acc_invoices').select('*, lines:acc_invoice_lines(*)')
        .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }));
      for (const inv of list) inv.lines.sort((a, b) => num(a.sort_order) - num(b.sort_order));
      return list;
    },
  });
}
export function useAllBills(enabled = true) {
  return useQuery({
    queryKey: ['acc', 'bills'],
    enabled,
    queryFn: () => rows<(VendorBill & { po_id: string | null; created_at: string })[]>(supabase.from('vendor_bills').select('*')
      .order('bill_date', { ascending: false }).order('created_at', { ascending: false })),
  });
}
export function useAccOverview() {
  return useQuery({
    queryKey: ['acc', 'overview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('acc_overview');
      if (error) throw error;
      return data as AccOverview;
    },
  });
}

/** Everything in Accounts depends on everything else; refresh it all after a change. */
export function useAccRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['acc'] }),
    qc.invalidateQueries({ queryKey: ['vendor_bills'] }),
    qc.invalidateQueries({ queryKey: ['company-today'] }),
  ]);
}

// ------------------------------------------------------------------ writes
const clean = (v: string | null | undefined) => (v ?? '').trim() || null;

export async function saveAccount(a: Partial<AccAccount> & { name: string }, id: string | null) {
  const payload = {
    name: a.name.trim(), kind: a.kind ?? 'bank', bank_name: clean(a.bank_name), account_no: clean(a.account_no),
    ifsc: clean(a.ifsc)?.toUpperCase() ?? null, branch: clean(a.branch), opening_balance: num(a.opening_balance),
    opening_date: a.opening_date || undefined, is_active: a.is_active ?? true, notes: clean(a.notes),
  };
  const { error } = id
    ? await supabase.from('acc_accounts').update(payload).eq('id', id)
    : await supabase.from('acc_accounts').insert(payload);
  if (error) throw error;
}

export type TxnInput = Omit<Txn, 'id' | 'txn_no' | 'created_at'>;
export async function saveTxn(t: TxnInput, id: string | null) {
  const payload = {
    txn_date: t.txn_date, kind: t.kind, account_id: t.account_id,
    to_account_id: t.kind === 'transfer' ? t.to_account_id : null,
    amount: num(t.amount), gst_amount: t.kind === 'transfer' ? 0 : num(t.gst_amount),
    tds_amount: t.kind === 'transfer' ? 0 : num(t.tds_amount),
    category: t.kind === 'transfer' ? null : clean(t.category), party: clean(t.party), mode: t.mode,
    reference: clean(t.reference), description: clean(t.description),
    project_id: t.project_id || null, site_id: t.site_id || null,
    invoice_id: t.kind === 'income' ? t.invoice_id || null : null,
    bill_id: t.kind === 'expense' ? t.bill_id || null : null,
  };
  const { error } = id
    ? await supabase.from('acc_transactions').update(payload).eq('id', id)
    : await supabase.from('acc_transactions').insert(payload);
  if (error) throw error;
}

export async function saveInvoice(head: Omit<Invoice, 'id' | 'created_at' | 'lines'>, lines: InvoiceLine[], id: string | null) {
  const payload = {
    invoice_no: head.invoice_no.trim() || undefined, invoice_date: head.invoice_date, due_date: head.due_date || null,
    customer_name: head.customer_name.trim(), customer_gstin: clean(head.customer_gstin)?.toUpperCase() ?? null,
    customer_address: clean(head.customer_address), customer_phone: clean(head.customer_phone), customer_email: clean(head.customer_email),
    place_of_supply: clean(head.place_of_supply), project_id: head.project_id || null, site_id: head.site_id || null,
    status: head.status, notes: clean(head.notes), terms: clean(head.terms),
  };
  let invId = id;
  if (invId) {
    const { error } = await supabase.from('acc_invoices').update(payload).eq('id', invId);
    if (error) throw error;
    const del = await supabase.from('acc_invoice_lines').delete().eq('invoice_id', invId);
    if (del.error) throw del.error;
  } else {
    const { data, error } = await supabase.from('acc_invoices').insert(payload).select('id').single();
    if (error) throw error;
    invId = (data as { id: string }).id;
  }
  const good = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
  if (good.length) {
    const { error } = await supabase.from('acc_invoice_lines').insert(good.map((l, i) => ({
      invoice_id: invId, sort_order: i + 1, description: l.description.trim(), hsn_code: clean(l.hsn_code),
      qty: num(l.qty), uom: l.uom || 'nos', rate: num(l.rate), gst_rate: num(l.gst_rate),
    })));
    if (error) throw error;
  }
  return invId!;
}

export async function setInvoiceStatus(id: string, status: Invoice['status']) {
  const { error } = await supabase.from('acc_invoices').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function addBill(b: {
  vendor_id: string; bill_no: string; bill_date: string; amount: string; deductions: string;
  description: string; project_id: string; po_id: string;
}) {
  const { error } = await supabase.from('vendor_bills').insert({
    vendor_id: b.vendor_id, bill_no: b.bill_no.trim(), bill_date: b.bill_date, amount: num(b.amount),
    deductions: num(b.deductions), description: clean(b.description), project_id: b.project_id || null, po_id: b.po_id || null,
  });
  if (error) throw error;
}

export async function setBillStatus(id: string, status: string) {
  const { error } = await supabase.from('vendor_bills').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function removeRecord(table: 'acc_transactions' | 'acc_invoices' | 'acc_accounts', id: string) {
  const { error } = await supabase.rpc('soft_delete_record', { p_table: table, p_id: id });
  if (error) throw error;
}
