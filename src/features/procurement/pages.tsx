// Procurement pages: Overview, Purchase Requisitions, Purchase Orders,
// Goods Receipts and Stores & Inventory. Vendors reuse the vendor master.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowRightLeft, ClipboardList, FileText, IndianRupee, Loader2, PackageCheck, PackagePlus, Pencil,
  Plus, Printer, Search, ShoppingCart, Truck, Warehouse,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtINR, fmtNumber, todayIST } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, Field, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { LinkedApproval, isOpenRequest, useRequestFromProject } from '@/features/projects/ApprovalLinks';
import {
  ITEM_CATEGORIES, PO_STATUS, REQ_STATUS, UOMS, adjustStock, issueStock, poTotals, postReceipt, reqTotal,
  saveOrder, saveRequisition, setStatus, useItems, useMoves, useOrders, useProcDashboard, useProcLinks, useProcRefresh,
  useReceipts, useRequisitions, useStock, type Item, type PurchaseOrder, type Requisition,
} from '@/features/procurement/api';
import { LineEditor, NONE, opt, unNone, useLookups, type EditLine } from '@/features/procurement/shared';
import { supabase } from '@/lib/supabase';

const n = (v: unknown) => (v === '' || v == null ? 0 : Number(v));
const blankLine = (): EditLine => ({ item_id: null, description: '', qty: '1', uom: 'nos', rate: '', gst_rate: '18' });

// =================================================================== overview
export function ProcurementOverviewPage() {
  const q = useProcDashboard();
  const d = q.data;
  return (
    <>
      <PageHeader icon={ShoppingCart} title="Procurement"
        description="Requisitions, purchase orders, receipts and stores: what is waiting, late or running low." />
      {q.isLoading ? <Skeleton className="h-72 rounded-xl" /> : q.error ? (
        <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>
      ) : d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Requisitions awaiting approval" value={d.requisitions_waiting} icon={ClipboardList} tone="amber" />
            <StatCard label="Approved, not yet ordered" value={d.requisitions_to_order} icon={ShoppingCart} tone="blue" />
            <StatCard label="Open purchase orders" value={d.orders_open} hint={`${fmtNumber(d.orders_draft)} draft`} icon={FileText} tone="violet" />
            <StatCard label="Late deliveries" value={d.overdue.length} icon={Truck} tone={d.overdue.length ? 'red' : 'green'} />
            <StatCard label="Ordered this month" value={fmtINR(d.spend_month, true)} hint="Incl. GST and freight" icon={IndianRupee} tone="green" />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Late deliveries</CardTitle><CardDescription>Open orders past their delivery date</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.overdue.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing is late.</p> : (
                  <Table><TableBody>
                    {d.overdue.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell><Link to="/procurement/orders" className="font-medium text-primary hover:underline">{o.po_no}</Link></TableCell>
                        <TableCell>{o.vendor}</TableCell>
                        <TableCell className="text-red-700">Due {fmtDate(o.delivery_date)}</TableCell>
                        <TableCell><Badge variant={PO_STATUS[o.status]?.tone}>{PO_STATUS[o.status]?.label}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Running low</CardTitle><CardDescription>Items below their minimum stock</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.low_stock.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">Every item is above its minimum.</p> : (
                  <Table><TableBody>
                    {d.low_stock.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell><span className="font-medium">{i.name}</span> <span className="text-xs text-muted-foreground">{i.code}</span></TableCell>
                        <TableCell className="tabular text-right text-red-700">{fmtNumber(i.stock)} {i.uom}</TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">min {fmtNumber(i.min_stock)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Top vendors</CardTitle><CardDescription>By value ordered in the last 12 months</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.top_vendors.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">No orders yet.</p> : (
                  <Table><TableBody>
                    {d.top_vendors.map((v) => (
                      <TableRow key={v.vendor}>
                        <TableCell className="font-medium">{v.vendor}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtNumber(v.orders)} order(s)</TableCell>
                        <TableCell className="tabular text-right font-medium">{fmtINR(v.spend, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Recent receipts</CardTitle><CardDescription>Material that arrived lately</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.recent_receipts.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing received yet.</p> : (
                  <Table><TableBody>
                    {d.recent_receipts.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.grn_no}</TableCell>
                        <TableCell>{r.po_no} · {r.vendor}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(r.receipt_date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// =============================================================== requisitions
export function RequisitionsPage() {
  const can = useCan('proc.requisitions');
  const canOrder = useCan('proc.orders');
  const q = useRequisitions();
  const lk = useLookups();
  const links = useProcLinks();
  const req = useRequestFromProject();
  const refresh = useProcRefresh();
  const [status, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Requisition | 'new' | null>(null);
  const [ordering, setOrdering] = useState<Requisition | null>(null);

  const rows = (q.data ?? []).filter((r) =>
    (status === 'all' || (status === 'open' ? ['draft', 'submitted', 'approved'].includes(r.status) : r.status === status))
    && (!search || `${r.req_no} ${r.title}`.toLowerCase().includes(search.toLowerCase())));

  const sendForApproval = (r: Requisition) => req.open({
    source: { type: 'requisition', id: r.id },
    context: `Requisition ${r.req_no} · ${r.title}`,
    prefill: {
      category: 'procurement', title: `${r.req_no}: ${r.title}`.slice(0, 200), project_id: r.project_id ?? '',
      site_id: r.site_id ?? '', department_id: r.department_id ?? '', amount: String(Math.round(reqTotal(r))),
      needed_by: r.required_by ?? '', priority: r.priority,
      details: r.lines.map((l) => `• ${l.description}: ${l.qty} ${l.uom}${n(l.est_rate) ? ` @ ₹${l.est_rate}` : ''}`).join('\n'),
    },
  });

  async function act(r: Requisition, s: string, done: string) {
    try { await setStatus('proc_requisitions', r.id, s); toast.success(done); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader icon={ClipboardList} title="Purchase Requisitions"
        description="A site, project or department asks for material; once approved, procurement orders it."
        actions={can.create && <Button onClick={() => setEditing('new')}><Plus /> New requisition</Button>} />
      <Card className="mb-3"><CardContent className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search number or title" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><FilterSelect value={status} onChange={setStatusFilter}
          options={[['open', 'Open'], ['all', 'All'], ...Object.entries(REQ_STATUS).map(([k, v]) => [k, v.label] as [string, string])]} /></div>
      </CardContent></Card>
      <Card className="overflow-hidden">
        {q.isLoading ? <Skeleton className="h-60" /> : !rows.length ? (
          <EmptyState icon={ClipboardList} title="No requisitions" description="Raise one when a site or project needs material." />
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Requisition</TableHead><TableHead>For</TableHead><TableHead>Items</TableHead>
              <TableHead className="text-right">Est. value</TableHead><TableHead>Needed by</TableHead>
              <TableHead>Status</TableHead><TableHead>Approval</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const link = links.forSource('requisition', r.id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.req_no} {r.priority === 'urgent' && <Badge variant="destructive" className="ml-1">Urgent</Badge>}</div>
                      <div className="max-w-[16rem] truncate text-xs text-muted-foreground" title={r.title}>{r.title}</div>
                    </TableCell>
                    <TableCell className="text-xs">{[lk.projectName(r.project_id), lk.siteName(r.site_id), lk.departmentName(r.department_id)].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground" title={r.lines.map((l) => `${l.description} ${l.qty} ${l.uom}`).join(', ')}>
                      {r.lines.length} line(s): {r.lines.map((l) => l.description).join(', ')}
                    </TableCell>
                    <TableCell className="tabular text-right">{fmtINR(reqTotal(r), true)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.required_by ? fmtDate(r.required_by) : '—'}</TableCell>
                    <TableCell><Badge variant={REQ_STATUS[r.status]?.tone}>{REQ_STATUS[r.status]?.label ?? r.status}</Badge></TableCell>
                    <TableCell>
                      {(link || r.status === 'draft' || r.status === 'rejected') ? (
                        <LinkedApproval link={link} canRequest={req.canRequest && r.lines.length > 0} onRequest={() => sendForApproval(r)} />
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {can.edit && (r.status === 'draft' || r.status === 'rejected') && !isOpenRequest(link) && (
                        <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(r)}><Pencil /></Button>
                      )}
                      {r.status === 'approved' && canOrder.create && <Button size="sm" variant="outline" onClick={() => setOrdering(r)}><ShoppingCart /> Make PO</Button>}
                      {['draft', 'rejected', 'approved'].includes(r.status) && can.edit && !isOpenRequest(link) && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void act(r, 'cancelled', 'Requisition cancelled')}>Cancel</Button>
                      )}
                      {r.status === 'ordered' && can.edit && <Button size="sm" variant="ghost" onClick={() => void act(r, 'closed', 'Requisition closed')}>Close</Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && <RequisitionForm requisition={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {ordering && <OrderForm order={null} fromRequisition={ordering} onClose={() => setOrdering(null)} onSaved={refresh} />}
      {req.dialog}
    </>
  );
}

function RequisitionForm({ requisition, onClose, onSaved }: { requisition: Requisition | null; onClose: () => void; onSaved: () => unknown }) {
  const lk = useLookups();
  const [f, setF] = useState({
    title: requisition?.title ?? '', project_id: requisition?.project_id ?? '', site_id: requisition?.site_id ?? '',
    department_id: requisition?.department_id ?? '', required_by: requisition?.required_by ?? '',
    priority: requisition?.priority ?? 'normal', notes: requisition?.notes ?? '',
  });
  const [lines, setLines] = useState<EditLine[]>(requisition?.lines.length
    ? requisition.lines.map((l) => ({ item_id: l.item_id, description: l.description, qty: String(l.qty), uom: l.uom, rate: String(l.est_rate ?? '') }))
    : [blankLine()]);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (f.title.trim().length < 3) return toast.error('Give the requisition a title.');
    if (!lines.some((l) => l.description.trim() && n(l.qty) > 0)) return toast.error('Add at least one item.');
    setBusy(true);
    try {
      await saveRequisition({ ...f, priority: f.priority as 'normal' | 'urgent' },
        lines.map((l) => ({ item_id: l.item_id, description: l.description, qty: l.qty, uom: l.uom, est_rate: l.rate })), requisition?.id ?? null);
      toast.success(requisition ? 'Requisition saved' : 'Requisition created — send it for approval when ready');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{requisition ? `Edit ${requisition.req_no}` : 'New purchase requisition'}</DialogTitle>
          <DialogDescription>What is needed, for where, and by when. Send it for approval from the list once saved.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Title" required className="sm:col-span-3"><Input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. DC cables and connectors for Deegod block C" /></Field>
          <Field label="Project"><FilterSelect value={f.project_id || NONE} onChange={(v) => setF({ ...f, project_id: unNone(v) })} options={opt(lk.projects, 'None')} /></Field>
          <Field label="Site"><FilterSelect value={f.site_id || NONE} onChange={(v) => setF({ ...f, site_id: unNone(v) })} options={opt(lk.sites, 'None')} /></Field>
          <Field label="Department"><FilterSelect value={f.department_id || NONE} onChange={(v) => setF({ ...f, department_id: unNone(v) })} options={opt(lk.departments, 'None')} /></Field>
          <Field label="Needed by"><Input type="date" value={f.required_by} onChange={(e) => setF({ ...f, required_by: e.target.value })} /></Field>
          <Field label="Priority"><FilterSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v as 'normal' | 'urgent' })} options={[['normal', 'Normal'], ['urgent', 'Urgent']]} /></Field>
        </div>
        <div><p className="mb-2 text-sm font-medium">Items</p>
          <LineEditor lines={lines} setLines={setLines} items={lk.items} rateLabel="Est. rate (₹)" /></div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Why it is needed, preferred make or vendor" /></Field>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save requisition</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================================================================== orders
export function PurchaseOrdersPage() {
  const can = useCan('proc.orders');
  const canReceive = useCan('proc.receipts');
  const q = useOrders();
  const lk = useLookups();
  const links = useProcLinks();
  const req = useRequestFromProject();
  const refresh = useProcRefresh();
  const [status, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PurchaseOrder | 'new' | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  const rows = (q.data ?? []).filter((o) =>
    (status === 'all' || (status === 'open' ? ['draft', 'approved', 'issued', 'partially_received'].includes(o.status) : o.status === status))
    && (!search || `${o.po_no} ${lk.vendorName(o.vendor_id) ?? ''}`.toLowerCase().includes(search.toLowerCase())));

  const sendForApproval = (o: PurchaseOrder) => {
    const t = poTotals(o);
    req.open({
      source: { type: 'purchase_order', id: o.id },
      context: `Purchase order ${o.po_no} · ${lk.vendorName(o.vendor_id)}`,
      prefill: {
        category: 'purchase', title: `${o.po_no}: ${lk.vendorName(o.vendor_id)}`.slice(0, 200), project_id: o.project_id ?? '',
        site_id: o.site_id ?? '', amount: String(Math.round(t.total)), needed_by: o.delivery_date ?? '',
        details: [...o.lines.map((l) => `• ${l.description}: ${l.qty} ${l.uom} @ ₹${l.rate} + ${l.gst_rate}% GST`),
          `Total ₹${Math.round(t.total)} (incl. GST${n(o.freight) ? ' and freight' : ''})`, o.payment_terms && `Payment terms: ${o.payment_terms}`].filter(Boolean).join('\n'),
      },
    });
  };
  async function act(o: PurchaseOrder, s: string, done: string) {
    try { await setStatus('proc_purchase_orders', o.id, s); toast.success(done); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader icon={FileText} title="Purchase Orders"
        description="Orders to vendors: lines, GST, delivery and terms. Approved in the Approvals section, then issued and received."
        actions={can.create && <Button onClick={() => setEditing('new')}><Plus /> New order</Button>} />
      <Card className="mb-3"><CardContent className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search PO or vendor" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><FilterSelect value={status} onChange={setStatusFilter}
          options={[['open', 'Open'], ['all', 'All'], ...Object.entries(PO_STATUS).map(([k, v]) => [k, v.label] as [string, string])]} /></div>
      </CardContent></Card>
      <Card className="overflow-hidden">
        {q.isLoading ? <Skeleton className="h-60" /> : !rows.length ? (
          <EmptyState icon={FileText} title="No purchase orders" description="Create one directly, or with “Make PO” on an approved requisition." />
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Order</TableHead><TableHead>Vendor</TableHead><TableHead>For</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead>Delivery</TableHead><TableHead>Received</TableHead>
              <TableHead>Status</TableHead><TableHead>Approval</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((o) => {
                const t = poTotals(o);
                const link = links.forSource('purchase_order', o.id);
                const ordered = o.lines.reduce((s, l) => s + n(l.qty), 0);
                const got = o.lines.reduce((s, l) => s + n(l.received_qty), 0);
                const vendorPhone = lk.vendors.find((v) => v.id === o.vendor_id)?.phone;
                const late = o.delivery_date && o.delivery_date < todayIST() && ['approved', 'issued', 'partially_received'].includes(o.status);
                return (
                  <TableRow key={o.id}>
                    <TableCell><div className="font-medium">{o.po_no}</div><div className="text-xs text-muted-foreground">{fmtDate(o.po_date)}</div></TableCell>
                    <TableCell>
                      <div className="font-medium">{lk.vendorName(o.vendor_id) ?? '—'}</div>
                      {vendorPhone && <div className="tabular text-xs text-muted-foreground">{vendorPhone}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{lk.projectName(o.project_id) ?? lk.siteName(o.site_id) ?? 'Main store'}</TableCell>
                    <TableCell className="tabular text-right font-medium">{fmtINR(t.total, true)}</TableCell>
                    <TableCell className={cn('whitespace-nowrap', late && 'font-medium text-red-700')}>{o.delivery_date ? fmtDate(o.delivery_date) : '—'}{late && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}</TableCell>
                    <TableCell className="min-w-[6rem]">
                      <div className="tabular text-xs">{fmtNumber(got)} / {fmtNumber(ordered)}</div>
                      <div className="mt-1 h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-primary" style={{ width: `${ordered ? Math.min(100, (got / ordered) * 100) : 0}%` }} /></div>
                    </TableCell>
                    <TableCell><Badge variant={PO_STATUS[o.status]?.tone}>{PO_STATUS[o.status]?.label ?? o.status}</Badge></TableCell>
                    <TableCell>
                      {(link || o.status === 'draft') ? <LinkedApproval link={link} canRequest={req.canRequest && o.lines.length > 0} onRequest={() => sendForApproval(o)} />
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="icon-sm" variant="ghost" aria-label="Print" title="Print the order" onClick={() => printPO(o, lk)}><Printer /></Button>
                      {o.status === 'draft' && can.edit && !isOpenRequest(link) && <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(o)}><Pencil /></Button>}
                      {o.status === 'approved' && can.edit && <Button size="sm" variant="outline" onClick={() => void act(o, 'issued', 'Marked issued to the vendor')}>Mark issued</Button>}
                      {['approved', 'issued', 'partially_received'].includes(o.status) && canReceive.create && (
                        <Button size="sm" variant="outline" onClick={() => setReceiving(o)}><PackageCheck /> Receive</Button>
                      )}
                      {['received', 'partially_received'].includes(o.status) && can.edit && <Button size="sm" variant="ghost" onClick={() => void act(o, 'closed', 'Order closed')}>Close</Button>}
                      {['draft', 'approved', 'issued'].includes(o.status) && can.edit && !isOpenRequest(link) && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void act(o, 'cancelled', 'Order cancelled')}>Cancel</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && <OrderForm order={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {receiving && <ReceiptForm order={receiving} onClose={() => setReceiving(null)} onSaved={refresh} />}
      {req.dialog}
    </>
  );
}

function OrderForm({ order, fromRequisition, onClose, onSaved }: {
  order: PurchaseOrder | null; fromRequisition?: Requisition; onClose: () => void; onSaved: () => unknown;
}) {
  const lk = useLookups();
  const src = fromRequisition;
  const [f, setF] = useState({
    vendor_id: order?.vendor_id ?? '', project_id: order?.project_id ?? src?.project_id ?? '', site_id: order?.site_id ?? src?.site_id ?? '',
    po_date: order?.po_date ?? todayIST(), delivery_date: order?.delivery_date ?? src?.required_by ?? '',
    delivery_address: order?.delivery_address ?? '', payment_terms: order?.payment_terms ?? '', freight: String(order?.freight ?? ''),
    notes: order?.notes ?? (src ? `Against ${src.req_no}: ${src.title}` : ''),
  });
  const [lines, setLines] = useState<EditLine[]>(order?.lines.length
    ? order.lines.map((l) => ({ item_id: l.item_id, description: l.description, qty: String(l.qty), uom: l.uom, rate: String(l.rate), gst_rate: String(l.gst_rate) }))
    : src?.lines.length
      ? src.lines.map((l) => ({ item_id: l.item_id, description: l.description, qty: String(l.qty), uom: l.uom, rate: String(l.est_rate ?? ''),
          gst_rate: String(lk.item(l.item_id)?.gst_rate ?? 18) }))
      : [blankLine()]);
  const [busy, setBusy] = useState(false);
  const vendor = lk.vendors.find((v) => v.id === f.vendor_id);

  async function save() {
    if (!f.vendor_id) return toast.error('Choose the vendor.');
    if (!lines.some((l) => l.description.trim() && n(l.qty) > 0)) return toast.error('Add at least one line.');
    setBusy(true);
    try {
      await saveOrder({ ...f, freight: n(f.freight), requisition_id: order?.requisition_id ?? src?.id ?? null },
        lines.map((l) => ({ item_id: l.item_id, description: l.description, qty: l.qty, uom: l.uom, rate: l.rate, gst_rate: l.gst_rate ?? '18' })), order?.id ?? null);
      toast.success(order ? 'Order saved' : 'Order created — send it for approval from the list');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? `Edit ${order.po_no}` : src ? `Purchase order for ${src.req_no}` : 'New purchase order'}</DialogTitle>
          <DialogDescription>Saved as a draft; send it for approval, then mark it issued to the vendor.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Vendor" required className="sm:col-span-2"
            hint={vendor && (vendor.phone ? `Phone: ${vendor.phone}${vendor.contact_person ? ` · ${vendor.contact_person}` : ''}` : 'No phone saved — add it under Procurement → Vendors')}>
            <FilterSelect value={f.vendor_id || NONE} onChange={(v) => setF({ ...f, vendor_id: unNone(v), payment_terms: f.payment_terms || lk.vendors.find((x) => x.id === v)?.payment_terms || '' })}
              options={opt(lk.vendors.filter((v) => v.status === 'active'), 'Choose the vendor')} />
          </Field>
          <Field label="Order date"><Input type="date" value={f.po_date} onChange={(e) => setF({ ...f, po_date: e.target.value })} /></Field>
          <Field label="Project"><FilterSelect value={f.project_id || NONE} onChange={(v) => setF({ ...f, project_id: unNone(v) })} options={opt(lk.projects, 'None')} /></Field>
          <Field label="Deliver to site" hint="Empty = the main store"><FilterSelect value={f.site_id || NONE} onChange={(v) => setF({ ...f, site_id: unNone(v) })} options={opt(lk.sites, 'Main store')} /></Field>
          <Field label="Delivery by"><Input type="date" value={f.delivery_date} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></Field>
          <Field label="Payment terms"><Input value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })} placeholder={vendor?.payment_terms ?? '30 days / advance / milestone'} /></Field>
          <Field label="Freight (₹)"><Input inputMode="decimal" value={f.freight} onChange={(e) => setF({ ...f, freight: e.target.value })} placeholder="0" /></Field>
          <Field label="Delivery address" className="sm:col-span-3"><Input value={f.delivery_address} onChange={(e) => setF({ ...f, delivery_address: e.target.value })} /></Field>
        </div>
        <div><p className="mb-2 text-sm font-medium">Lines</p><LineEditor lines={lines} setLines={setLines} items={lk.items} withGst /></div>
        <Field label="Notes / terms"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A printable purchase order in a new window. */
function printPO(o: PurchaseOrder, lk: ReturnType<typeof useLookups>) {
  const t = poTotals(o);
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const v = lk.vendors.find((x) => x.id === o.vendor_id);
  const w = window.open('', '_blank');
  if (!w) return toast.error('Allow pop-ups to print.');
  w.document.write(`<!doctype html><html><head><title>${esc(o.po_no)}</title><style>
    body{font:13px system-ui,sans-serif;color:#0f172a;margin:32px} h1{font-size:20px;margin:0} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left} th{background:#f1f5f9} .r{text-align:right} .grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}
    .muted{color:#64748b}</style></head><body>
    <h1>Purchase Order ${esc(o.po_no)}</h1><div class="muted">Diwakar Renewable &amp; Infra Pvt. Ltd. · ${esc(fmtDate(o.po_date))}</div>
    <div class="grid"><div><b>To</b><br>${esc(v?.name)}<br>${esc(v?.contact_person ?? '')} ${esc(v?.phone ?? '')}<br>GST ${esc(v?.gst_no ?? '—')}</div>
    <div><b>Deliver to</b><br>${esc(lk.siteName(o.site_id) ?? 'Main store')}${o.delivery_address ? `<br>${esc(o.delivery_address)}` : ''}<br>By ${esc(o.delivery_date ? fmtDate(o.delivery_date) : '—')}
    ${lk.projectName(o.project_id) ? `<br>Project: ${esc(lk.projectName(o.project_id))}` : ''}</div></div>
    <table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">GST %</th><th class="r">Amount</th></tr></thead><tbody>
    ${o.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="r">${esc(l.qty)}</td><td>${esc(l.uom)}</td><td class="r">${esc(fmtINR(n(l.rate)))}</td><td class="r">${esc(l.gst_rate)}</td><td class="r">${esc(fmtINR(n(l.qty) * n(l.rate)))}</td></tr>`).join('')}
    <tr><td colspan="6" class="r">Subtotal</td><td class="r">${esc(fmtINR(t.sub))}</td></tr><tr><td colspan="6" class="r">GST</td><td class="r">${esc(fmtINR(t.tax))}</td></tr>
    ${n(o.freight) ? `<tr><td colspan="6" class="r">Freight</td><td class="r">${esc(fmtINR(n(o.freight)))}</td></tr>` : ''}
    <tr><td colspan="6" class="r"><b>Total</b></td><td class="r"><b>${esc(fmtINR(t.total))}</b></td></tr></tbody></table>
    ${o.payment_terms ? `<p><b>Payment terms:</b> ${esc(o.payment_terms)}</p>` : ''}${o.notes ? `<p>${esc(o.notes)}</p>` : ''}
    <p style="margin-top:48px">Authorised signatory</p><script>window.print()</script></body></html>`);
  w.document.close();
}

// ================================================================== receipts
export function GoodsReceiptsPage() {
  const can = useCan('proc.receipts');
  const q = useReceipts();
  const orders = useOrders();
  const lk = useLookups();
  const refresh = useProcRefresh();
  const [picking, setPicking] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const open = (orders.data ?? []).filter((o) => ['approved', 'issued', 'partially_received'].includes(o.status));
  const poOf = (id: string) => (orders.data ?? []).find((o) => o.id === id);

  return (
    <>
      <PageHeader icon={PackageCheck} title="Goods Receipts"
        description="Material received against purchase orders. Accepted quantities go into stock; rejected ones are recorded."
        actions={can.create && <Button onClick={() => setPicking(true)} disabled={!open.length}><Plus /> Record a receipt</Button>} />
      <Card className="overflow-hidden">
        {q.isLoading ? <Skeleton className="h-60" /> : !(q.data ?? []).length ? (
          <EmptyState icon={PackageCheck} title="No receipts yet" description="When material arrives, record it against its purchase order." />
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>GRN</TableHead><TableHead>Order · vendor</TableHead><TableHead>Received at</TableHead>
              <TableHead>Challan / invoice</TableHead><TableHead className="text-right">Accepted</TableHead><TableHead className="text-right">Rejected</TableHead><TableHead>By</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(q.data ?? []).map((r) => {
                const po = poOf(r.po_id);
                const acc = r.lines.reduce((s, l) => s + n(l.qty_accepted), 0);
                const rej = r.lines.reduce((s, l) => s + n(l.qty_rejected), 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{r.grn_no}</div><div className="text-xs text-muted-foreground">{fmtDate(r.receipt_date)}</div></TableCell>
                    <TableCell>{po?.po_no ?? '—'} · {lk.vendorName(po?.vendor_id) ?? '—'}</TableCell>
                    <TableCell className="text-sm">{lk.siteName(r.site_id) ?? 'Main store'}</TableCell>
                    <TableCell className="text-xs">{[r.challan_no && `Challan ${r.challan_no}`, r.invoice_no && `Invoice ${r.invoice_no}`, r.vehicle_no].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell className="tabular text-right">{fmtNumber(acc)}</TableCell>
                    <TableCell className={cn('tabular text-right', rej > 0 && 'font-medium text-red-700')}>{fmtNumber(rej)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.received_by ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Which order arrived?</DialogTitle><DialogDescription>Approved or issued orders still waiting for material.</DialogDescription></DialogHeader>
          <div className="grid max-h-[50vh] gap-1.5 overflow-y-auto">
            {open.map((o) => (
              <button key={o.id} type="button" onClick={() => { setPicking(false); setReceiving(o); }}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted">
                <span><span className="font-medium">{o.po_no}</span> · {lk.vendorName(o.vendor_id)}</span>
                <Badge variant={PO_STATUS[o.status]?.tone}>{PO_STATUS[o.status]?.label}</Badge>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {receiving && <ReceiptForm order={receiving} onClose={() => setReceiving(null)} onSaved={refresh} />}
    </>
  );
}

function ReceiptForm({ order, onClose, onSaved }: { order: PurchaseOrder; onClose: () => void; onSaved: () => unknown }) {
  const lk = useLookups();
  const [h, setH] = useState({ receipt_date: todayIST(), site_id: order.site_id ?? '', challan_no: '', invoice_no: '', vehicle_no: '', received_by: '', remarks: '' });
  const [qty, setQty] = useState<Record<string, { got: string; ok: string }>>(() =>
    Object.fromEntries(order.lines.map((l) => {
      const left = Math.max(n(l.qty) - n(l.received_qty), 0);
      return [l.id!, { got: left ? String(left) : '', ok: left ? String(left) : '' }];
    })));
  const [busy, setBusy] = useState(false);

  async function save() {
    const lines = order.lines.map((l) => ({ po_line_id: l.id!, qty_received: n(qty[l.id!]?.got), qty_accepted: n(qty[l.id!]?.ok) }));
    if (!lines.some((l) => l.qty_received > 0)) return toast.error('Enter what arrived.');
    if (lines.some((l) => l.qty_accepted > l.qty_received)) return toast.error('Accepted cannot be more than received.');
    setBusy(true);
    try {
      await postReceipt({ ...h, po_id: order.id, site_id: h.site_id || null }, lines);
      toast.success('Receipt recorded; stock updated');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive against {order.po_no}</DialogTitle>
          <DialogDescription>{lk.vendorName(order.vendor_id)} · enter what arrived and how much passed inspection.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Received on"><Input type="date" value={h.receipt_date} max={todayIST()} onChange={(e) => setH({ ...h, receipt_date: e.target.value })} /></Field>
          <Field label="Received at"><FilterSelect value={h.site_id || NONE} onChange={(v) => setH({ ...h, site_id: unNone(v) })} options={opt(lk.sites, 'Main store')} /></Field>
          <Field label="Received by"><Input value={h.received_by} onChange={(e) => setH({ ...h, received_by: e.target.value })} /></Field>
          <Field label="Challan no."><Input value={h.challan_no} onChange={(e) => setH({ ...h, challan_no: e.target.value })} /></Field>
          <Field label="Invoice no."><Input value={h.invoice_no} onChange={(e) => setH({ ...h, invoice_no: e.target.value })} /></Field>
          <Field label="Vehicle no."><Input value={h.vehicle_no} onChange={(e) => setH({ ...h, vehicle_no: e.target.value })} /></Field>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Line</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Already in</TableHead>
            <TableHead className="w-28">Received</TableHead><TableHead className="w-28">Accepted</TableHead></TableRow></TableHeader>
          <TableBody>
            {order.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.description}</TableCell>
                <TableCell className="tabular text-right">{fmtNumber(n(l.qty))} {l.uom}</TableCell>
                <TableCell className="tabular text-right text-muted-foreground">{fmtNumber(n(l.received_qty))}</TableCell>
                <TableCell><Input inputMode="decimal" className="h-8" value={qty[l.id!]?.got ?? ''} onChange={(e) => setQty({ ...qty, [l.id!]: { got: e.target.value, ok: e.target.value } })} /></TableCell>
                <TableCell><Input inputMode="decimal" className="h-8" value={qty[l.id!]?.ok ?? ''} onChange={(e) => setQty({ ...qty, [l.id!]: { ...qty[l.id!], ok: e.target.value } })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Field label="Remarks"><Textarea rows={2} value={h.remarks} onChange={(e) => setH({ ...h, remarks: e.target.value })} placeholder="Damage, shortages, why anything was rejected" /></Field>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Record receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================= inventory
export function InventoryPage() {
  const can = useCan('proc.inventory');
  const items = useItems();
  const stock = useStock();
  const moves = useMoves();
  const lk = useLookups();
  const refresh = useProcRefresh();
  const [search, setSearch] = useState('');
  const [itemForm, setItemForm] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<{ kind: 'issue' | 'adjustment'; item?: Item } | null>(null);

  const onHand = useMemo(() => {
    const m = new Map<string, number>();
    (stock.data ?? []).forEach((s) => m.set(s.item_id, (m.get(s.item_id) ?? 0) + n(s.qty)));
    return m;
  }, [stock.data]);
  const list = (items.data ?? []).filter((i) => !search || `${i.code} ${i.name} ${i.category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader icon={Warehouse} title="Stores & Inventory"
        description="The item master, stock in the main store and at each site, issues to projects and every movement."
        actions={can.create && (
          <>
            <Button variant="outline" onClick={() => setMoving({ kind: 'issue' })}><ArrowRightLeft /> Issue / transfer</Button>
            <Button variant="outline" onClick={() => setMoving({ kind: 'adjustment' })}><PackagePlus /> Opening / adjustment</Button>
            <Button onClick={() => setItemForm('new')}><Plus /> New item</Button>
          </>
        )} />
      <Tabs defaultValue="items">
        <TabsList className="mb-3"><TabsTrigger value="items">Items & stock</TabsTrigger><TabsTrigger value="places">By store / site</TabsTrigger><TabsTrigger value="ledger">Movements</TabsTrigger></TabsList>
        <TabsContent value="items">
          <Card className="mb-3"><CardContent className="px-4 py-2.5">
            <div className="relative w-72"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Search code, name or category" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </CardContent></Card>
          <Card className="overflow-hidden">
            {items.isLoading ? <Skeleton className="h-60" /> : !list.length ? (
              <EmptyState icon={Warehouse} title="No items yet" description="Add the materials you buy and stock: modules, cables, connectors, spares." />
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Unit · HSN · GST</TableHead>
                  <TableHead className="text-right">In stock</TableHead><TableHead className="text-right">Minimum</TableHead><TableHead className="text-right">Last rate</TableHead><TableHead />
                </TableRow></TableHeader>
                <TableBody>
                  {list.map((i) => {
                    const q = onHand.get(i.id) ?? 0;
                    const low = i.min_stock > 0 && q < i.min_stock;
                    return (
                      <TableRow key={i.id} className={i.is_active ? '' : 'opacity-60'}>
                        <TableCell><div className="font-medium">{i.name}</div><div className="text-xs text-muted-foreground">{i.code}{i.spec ? ` · ${i.spec}` : ''}</div></TableCell>
                        <TableCell className="text-sm">{i.category}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{i.uom} · {i.hsn_code ?? '—'} · {i.gst_rate}%</TableCell>
                        <TableCell className={cn('tabular text-right font-semibold', low && 'text-red-700')}>{fmtNumber(q)} {low && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}</TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">{i.min_stock ? fmtNumber(i.min_stock) : '—'}</TableCell>
                        <TableCell className="tabular text-right">{i.last_rate != null ? fmtINR(i.last_rate) : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {can.create && q > 0 && <Button size="sm" variant="ghost" onClick={() => setMoving({ kind: 'issue', item: i })}>Issue</Button>}
                          {can.edit && <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setItemForm(i)}><Pencil /></Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="places">
          <Card className="overflow-hidden">
            {!(stock.data ?? []).length ? <EmptyState icon={Warehouse} title="Nothing in stock" description="Receipts and opening balances appear here by store and site." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Store / site</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...(stock.data ?? [])].sort((a, b) => (a.site ?? '').localeCompare(b.site ?? '')).map((s) => {
                    const it = lk.item(s.item_id);
                    return (
                      <TableRow key={`${s.item_id}-${s.site_id}`}>
                        <TableCell className="font-medium">{s.site ?? 'Main store'}</TableCell>
                        <TableCell>{it?.name ?? '—'} <span className="text-xs text-muted-foreground">{it?.code}</span></TableCell>
                        <TableCell className="tabular text-right font-medium">{fmtNumber(n(s.qty))} {it?.uom}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="ledger">
          <Card className="overflow-hidden">
            {!(moves.data ?? []).length ? <EmptyState icon={ArrowRightLeft} title="No movements yet" description="Every receipt, issue, transfer and adjustment is listed here." /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Item</TableHead><TableHead>Movement</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Where</TableHead><TableHead>For / note</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(moves.data ?? []).map((m) => {
                    const it = lk.item(m.item_id);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap">{fmtDate(m.move_date)}</TableCell>
                        <TableCell>{it?.name ?? '—'}</TableCell>
                        <TableCell className="capitalize">{m.kind}</TableCell>
                        <TableCell className={cn('tabular text-right font-medium', n(m.qty) < 0 ? 'text-red-700' : 'text-green-700')}>{n(m.qty) > 0 ? '+' : ''}{fmtNumber(n(m.qty))} {it?.uom}</TableCell>
                        <TableCell className="text-sm">{lk.siteName(m.site_id) ?? 'Main store'}</TableCell>
                        <TableCell className="max-w-[18rem] truncate text-xs text-muted-foreground" title={m.notes ?? undefined}>{[lk.projectName(m.project_id), m.notes].filter(Boolean).join(' · ') || '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      {itemForm && <ItemForm item={itemForm === 'new' ? null : itemForm} onClose={() => setItemForm(null)} onSaved={refresh} />}
      {moving && <MoveForm kind={moving.kind} item={moving.item} onClose={() => setMoving(null)} onSaved={refresh} />}
    </>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => unknown }) {
  const [f, setF] = useState({
    name: item?.name ?? '', category: item?.category ?? 'BOS', uom: item?.uom ?? 'nos', hsn_code: item?.hsn_code ?? '',
    gst_rate: String(item?.gst_rate ?? 18), spec: item?.spec ?? '', min_stock: String(item?.min_stock ?? 0), is_active: item?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (f.name.trim().length < 2) return toast.error('Give the item a name.');
    setBusy(true);
    const payload = { name: f.name.trim(), category: f.category, uom: f.uom, hsn_code: f.hsn_code.trim() || null, gst_rate: n(f.gst_rate),
      spec: f.spec.trim() || null, min_stock: n(f.min_stock), is_active: f.is_active };
    const { error } = item ? await supabase.from('proc_items').update(payload).eq('id', item.id) : await supabase.from('proc_items').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(item ? 'Item saved' : 'Item added');
    await onSaved();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{item ? `Edit ${item.code}` : 'New item'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. 4 sq mm DC solar cable" /></Field>
          <Field label="Category"><FilterSelect value={f.category} onChange={(v) => setF({ ...f, category: v })} options={ITEM_CATEGORIES.map((c) => [c, c] as [string, string])} /></Field>
          <Field label="Unit"><FilterSelect value={f.uom} onChange={(v) => setF({ ...f, uom: v })} options={UOMS.map((u) => [u, u] as [string, string])} /></Field>
          <Field label="HSN code"><Input value={f.hsn_code} onChange={(e) => setF({ ...f, hsn_code: e.target.value })} /></Field>
          <Field label="GST %"><Input inputMode="decimal" value={f.gst_rate} onChange={(e) => setF({ ...f, gst_rate: e.target.value })} /></Field>
          <Field label="Minimum stock" hint="Flagged as running low below this"><Input inputMode="decimal" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} /></Field>
          <Field label="Status"><FilterSelect value={f.is_active ? 'yes' : 'no'} onChange={(v) => setF({ ...f, is_active: v === 'yes' })} options={[['yes', 'Active'], ['no', 'Not used any more']]} /></Field>
          <Field label="Specification" className="sm:col-span-2"><Textarea rows={2} value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} placeholder="Make, model, rating" /></Field>
        </div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>Save item</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({ kind, item, onClose, onSaved }: { kind: 'issue' | 'adjustment'; item?: Item; onClose: () => void; onSaved: () => unknown }) {
  const lk = useLookups();
  const [f, setF] = useState({ item: item?.id ?? '', qty: '', from: '', project: '', toSite: '', notes: '', mode: 'opening' as 'opening' | 'adjustment' | 'return', sign: '+' });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.item) return toast.error('Choose the item.');
    if (!(n(f.qty) > 0)) return toast.error('Give a quantity.');
    setBusy(true);
    try {
      if (kind === 'issue') await issueStock({ item: f.item, qty: n(f.qty), from: f.from || null, project: f.project || null, toSite: f.toSite || null, notes: f.notes });
      else await adjustStock({ item: f.item, qty: f.sign === '-' ? -n(f.qty) : n(f.qty), site: f.from || null, kind: f.mode, notes: f.notes });
      toast.success('Stock updated');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind === 'issue' ? 'Issue or transfer stock' : 'Opening balance or adjustment'}</DialogTitle>
          <DialogDescription>{kind === 'issue' ? 'Out of a store to a project, or across to another site.' : 'Starting stock, a count correction or material returned.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item" required className="sm:col-span-2"><FilterSelect value={f.item || NONE} onChange={(v) => setF({ ...f, item: unNone(v) })} options={[[NONE, 'Choose the item'], ...lk.items.map((i) => [i.id, `${i.code} · ${i.name}`] as [string, string])]} /></Field>
          {kind === 'adjustment' && (
            <>
              <Field label="Type"><FilterSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v as typeof f.mode })} options={[['opening', 'Opening balance'], ['adjustment', 'Count correction'], ['return', 'Returned from site']]} /></Field>
              <Field label="Direction"><FilterSelect value={f.sign} onChange={(v) => setF({ ...f, sign: v })} options={[['+', 'Add to stock'], ['-', 'Remove from stock']]} /></Field>
            </>
          )}
          <Field label="Quantity" required><Input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label={kind === 'issue' ? 'From' : 'Store / site'}><FilterSelect value={f.from || NONE} onChange={(v) => setF({ ...f, from: unNone(v) })} options={opt(lk.sites, 'Main store')} /></Field>
          {kind === 'issue' && (
            <>
              <Field label="For project"><FilterSelect value={f.project || NONE} onChange={(v) => setF({ ...f, project: unNone(v) })} options={opt(lk.projects, 'None')} /></Field>
              <Field label="Transfer to site" hint="Leave empty to issue for use"><FilterSelect value={f.toSite || NONE} onChange={(v) => setF({ ...f, toSite: unNone(v) })} options={opt(lk.sites, 'Not a transfer')} /></Field>
            </>
          )}
          <Field label="Note" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={kind === 'issue' ? 'e.g. Block C stringing' : 'e.g. Physical count 15 Oct'} /></Field>
        </div>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
