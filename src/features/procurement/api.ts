// Procurement: requisitions, purchase orders, goods receipts, stores.
// Tables are read through RLS (proc.* modules); stock and the overview come
// from RPCs. Requisitions and orders are approved through the Approvals
// section as linked requests (source_type 'requisition' / 'purchase_order').
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BadgeTone } from '@/lib/types';
import type { ProjectApprovalRequest } from '@/features/approvals/api';

export const ITEM_CATEGORIES = [
  'Modules', 'Inverters', 'Structure', 'Cables', 'BOS', 'Electrical', 'Civil', 'Spares', 'Consumables',
  'Tools', 'Safety / PPE', 'Office', 'Other',
];
export const UOMS = ['nos', 'pair', 'set', 'm', 'km', 'kg', 'ton', 'litre', 'bag', 'box', 'roll', 'lot', 'job'];

export const REQ_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  submitted: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  ordered: { label: 'Ordered', tone: 'info' },
  closed: { label: 'Closed', tone: 'secondary' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};
export const PO_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  approved: { label: 'Approved', tone: 'success' },
  issued: { label: 'Issued to vendor', tone: 'info' },
  partially_received: { label: 'Partly received', tone: 'warning' },
  received: { label: 'Received', tone: 'success' },
  closed: { label: 'Closed', tone: 'secondary' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export interface Item {
  id: string;
  code: string;
  name: string;
  category: string;
  uom: string;
  hsn_code: string | null;
  gst_rate: number;
  spec: string | null;
  min_stock: number;
  last_rate: number | null;
  is_active: boolean;
}
export interface ReqLine {
  id?: string;
  item_id: string | null;
  description: string;
  qty: number | string;
  uom: string;
  est_rate: number | string;
  amount?: number;
  remarks?: string | null;
}
export interface Requisition {
  id: string;
  req_no: string;
  title: string;
  project_id: string | null;
  site_id: string | null;
  department_id: string | null;
  required_by: string | null;
  priority: 'normal' | 'urgent';
  status: string;
  notes: string | null;
  requested_by: string | null;
  created_at: string;
  lines: ReqLine[];
}
export interface PoLine {
  id?: string;
  item_id: string | null;
  description: string;
  qty: number | string;
  uom: string;
  rate: number | string;
  gst_rate: number | string;
  amount?: number;
  tax?: number;
  received_qty?: number;
}
export interface PurchaseOrder {
  id: string;
  po_no: string;
  vendor_id: string;
  requisition_id: string | null;
  project_id: string | null;
  site_id: string | null;
  po_date: string;
  delivery_date: string | null;
  delivery_address: string | null;
  payment_terms: string | null;
  freight: number;
  status: string;
  notes: string | null;
  created_at: string;
  lines: PoLine[];
}
export interface Receipt {
  id: string;
  grn_no: string;
  po_id: string;
  receipt_date: string;
  site_id: string | null;
  challan_no: string | null;
  invoice_no: string | null;
  vehicle_no: string | null;
  received_by: string | null;
  remarks: string | null;
  lines: { id: string; po_line_id: string; qty_received: number; qty_accepted: number; qty_rejected: number; remarks: string | null }[];
}
export interface StockRow { item_id: string; site_id: string | null; site: string | null; qty: number }
export interface StockMove {
  id: string;
  item_id: string;
  move_date: string;
  kind: string;
  qty: number;
  site_id: string | null;
  project_id: string | null;
  notes: string | null;
  rate: number | null;
  created_at: string;
}
export interface ProcDashboard {
  requisitions_waiting: number;
  requisitions_to_order: number;
  orders_open: number;
  orders_draft: number;
  overdue: { id: string; po_no: string; vendor: string; delivery_date: string; status: string }[];
  spend_month: number;
  low_stock: { id: string; code: string; name: string; uom: string; stock: number; min_stock: number }[];
  top_vendors: { vendor: string; orders: number; spend: number }[];
  recent_receipts: { id: string; grn_no: string; po_no: string; vendor: string; receipt_date: string }[];
}

const num = (v: unknown) => (v === '' || v == null ? 0 : Number(v));
export const poTotals = (po: Pick<PurchaseOrder, 'lines' | 'freight'>) => {
  const sub = po.lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const tax = po.lines.reduce((s, l) => s + (num(l.qty) * num(l.rate) * num(l.gst_rate)) / 100, 0);
  return { sub, tax, total: sub + tax + num(po.freight) };
};
export const reqTotal = (r: Pick<Requisition, 'lines'>) => r.lines.reduce((s, l) => s + num(l.qty) * num(l.est_rate), 0);

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return data as T;
}

export function useItems() {
  return useQuery({
    queryKey: ['proc', 'items'],
    queryFn: () => rows<Item[]>(supabase.from('proc_items').select('*').order('name')),
  });
}
export function useRequisitions() {
  return useQuery({
    queryKey: ['proc', 'requisitions'],
    queryFn: () => rows<Requisition[]>(supabase.from('proc_requisitions')
      .select('*, lines:proc_requisition_lines(*)').order('created_at', { ascending: false })),
  });
}
export function useOrders() {
  return useQuery({
    queryKey: ['proc', 'orders'],
    queryFn: () => rows<PurchaseOrder[]>(supabase.from('proc_purchase_orders')
      .select('*, lines:proc_po_lines(*)').order('po_date', { ascending: false }).order('created_at', { ascending: false })),
  });
}
export function useReceipts() {
  return useQuery({
    queryKey: ['proc', 'receipts'],
    queryFn: () => rows<Receipt[]>(supabase.from('proc_receipts')
      .select('*, lines:proc_receipt_lines(*)').order('receipt_date', { ascending: false }).order('created_at', { ascending: false })),
  });
}
export function useStock() {
  return useQuery({
    queryKey: ['proc', 'stock'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('proc_stock');
      if (error) throw error;
      return (data ?? []) as StockRow[];
    },
  });
}
export function useMoves() {
  return useQuery({
    queryKey: ['proc', 'moves'],
    queryFn: () => rows<StockMove[]>(supabase.from('proc_stock_moves').select('*')
      .order('move_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)),
  });
}
export function useProcDashboard() {
  return useQuery({
    queryKey: ['proc', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('proc_dashboard');
      if (error) throw error;
      return data as ProcDashboard;
    },
  });
}
export function useProcLinks() {
  const q = useQuery({
    queryKey: ['approvals', 'procurement'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('proc_approval_requests');
      if (error) throw error;
      return (data ?? []) as ProjectApprovalRequest[];
    },
  });
  const list = q.data ?? [];
  return {
    forSource: (type: 'requisition' | 'purchase_order', id: string) =>
      list.find((r) => r.source_type === type && r.source_id === id) ?? null,
  };
}

/** Everything procurement shows depends on everything else; refresh it all after a change. */
export function useProcRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['proc'] }),
    qc.invalidateQueries({ queryKey: ['approvals'] }),
  ]);
}

// ------------------------------------------------------------------ writes
export async function saveRequisition(
  head: Partial<Requisition> & { title: string }, lines: ReqLine[], id: string | null,
): Promise<string> {
  const payload = {
    title: head.title.trim(), project_id: head.project_id || null, site_id: head.site_id || null,
    department_id: head.department_id || null, required_by: head.required_by || null,
    priority: head.priority ?? 'normal', notes: head.notes?.trim() || null,
  };
  let reqId = id;
  if (reqId) {
    const { error } = await supabase.from('proc_requisitions').update(payload).eq('id', reqId);
    if (error) throw error;
    const del = await supabase.from('proc_requisition_lines').delete().eq('requisition_id', reqId);
    if (del.error) throw del.error;
  } else {
    const { data, error } = await supabase.from('proc_requisitions').insert(payload).select('id').single();
    if (error) throw error;
    reqId = (data as { id: string }).id;
  }
  const clean = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
  if (clean.length) {
    const { error } = await supabase.from('proc_requisition_lines').insert(clean.map((l, i) => ({
      requisition_id: reqId, sort_order: i + 1, item_id: l.item_id || null, description: l.description.trim(),
      qty: num(l.qty), uom: l.uom || 'nos', est_rate: num(l.est_rate), remarks: l.remarks?.trim() || null,
    })));
    if (error) throw error;
  }
  return reqId!;
}

export async function saveOrder(
  head: Partial<PurchaseOrder> & { vendor_id: string }, lines: PoLine[], id: string | null,
): Promise<string> {
  const payload = {
    vendor_id: head.vendor_id, requisition_id: head.requisition_id || null, project_id: head.project_id || null,
    site_id: head.site_id || null, po_date: head.po_date || undefined, delivery_date: head.delivery_date || null,
    delivery_address: head.delivery_address?.trim() || null, payment_terms: head.payment_terms?.trim() || null,
    freight: num(head.freight), notes: head.notes?.trim() || null,
  };
  let poId = id;
  if (poId) {
    const { error } = await supabase.from('proc_purchase_orders').update(payload).eq('id', poId);
    if (error) throw error;
    const del = await supabase.from('proc_po_lines').delete().eq('po_id', poId);
    if (del.error) throw del.error;
  } else {
    const { data, error } = await supabase.from('proc_purchase_orders').insert(payload).select('id').single();
    if (error) throw error;
    poId = (data as { id: string }).id;
  }
  const clean = lines.filter((l) => l.description.trim() && num(l.qty) > 0);
  if (clean.length) {
    const { error } = await supabase.from('proc_po_lines').insert(clean.map((l, i) => ({
      po_id: poId, sort_order: i + 1, item_id: l.item_id || null, description: l.description.trim(),
      qty: num(l.qty), uom: l.uom || 'nos', rate: num(l.rate), gst_rate: num(l.gst_rate),
    })));
    if (error) throw error;
  }
  // An order made from a requisition marks it ordered.
  if (!id && head.requisition_id) {
    await supabase.from('proc_requisitions').update({ status: 'ordered' }).eq('id', head.requisition_id).eq('status', 'approved');
  }
  return poId!;
}

export async function setStatus(table: 'proc_requisitions' | 'proc_purchase_orders', id: string, status: string) {
  const { error } = await supabase.from(table).update({ status }).eq('id', id);
  if (error) throw error;
}

export async function postReceipt(
  head: { po_id: string; receipt_date: string; site_id: string | null; challan_no: string; invoice_no: string; vehicle_no: string; received_by: string; remarks: string },
  lines: { po_line_id: string; qty_received: number; qty_accepted: number; remarks?: string }[],
) {
  const { data, error } = await supabase.from('proc_receipts').insert({
    po_id: head.po_id, receipt_date: head.receipt_date, site_id: head.site_id || null,
    challan_no: head.challan_no.trim() || null, invoice_no: head.invoice_no.trim() || null,
    vehicle_no: head.vehicle_no.trim() || null, received_by: head.received_by.trim() || null, remarks: head.remarks.trim() || null,
  }).select('id').single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  const clean = lines.filter((l) => l.qty_received > 0);
  if (clean.length) {
    const r = await supabase.from('proc_receipt_lines').insert(clean.map((l) => ({ receipt_id: id, ...l, remarks: l.remarks || null })));
    if (r.error) throw r.error;
  }
  return id;
}

export async function issueStock(p: { item: string; qty: number; from: string | null; project: string | null; toSite: string | null; notes: string }) {
  const { error } = await supabase.rpc('proc_issue_stock', {
    p_item: p.item, p_qty: p.qty, p_from_site: p.from, p_project: p.project, p_to_site: p.toSite, p_ticket: null, p_notes: p.notes.trim() || null,
  });
  if (error) throw error;
}

export async function adjustStock(p: { item: string; qty: number; site: string | null; kind: 'adjustment' | 'opening' | 'return'; notes: string }) {
  const { error } = await supabase.from('proc_stock_moves').insert({
    item_id: p.item, qty: p.qty, site_id: p.site, kind: p.kind, notes: p.notes.trim() || null,
  });
  if (error) throw error;
}
