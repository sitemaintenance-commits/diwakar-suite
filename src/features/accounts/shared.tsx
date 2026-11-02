// Pieces the Accounts pages share: lookups, the money-in / money-out /
// transfer form, and a few small display helpers.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtINR, todayIST } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/auth/AccessProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSites } from '@/features/admin/api';
import { useVendors } from '@/features/projects/api';
import { useProjectList } from '@/features/projects/portfolio';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, MODES, billState, invoiceState, num, saveTxn, settledBy,
  useAccounts, useAllBills, useInvoices, useTxns, type Txn, type TxnInput,
} from '@/features/accounts/api';

export const NONE = '__none__';
export const unNone = (v: string) => (v === NONE ? '' : v);
export const opt = (rows: { id: string; name: string }[] | undefined, none?: string): [string, string][] =>
  [...(none ? [[NONE, none] as [string, string]] : []), ...(rows ?? []).map((r) => [r.id, r.name] as [string, string])];

export function useAccLookups() {
  const projects = useProjectList();
  const sites = useSites();
  const vendors = useVendors();
  const accounts = useAccounts();
  const name = (list: { id: string; name: string }[] | undefined, id: string | null | undefined) =>
    (id && list?.find((r) => r.id === id)?.name) || null;
  return {
    projects: projects.data ?? [],
    sites: sites.data ?? [],
    vendors: vendors.data ?? [],
    accounts: accounts.data ?? [],
    projectName: (id?: string | null) => name(projects.data, id),
    siteName: (id?: string | null) => name(sites.data, id),
    vendorName: (id?: string | null) => name(vendors.data, id),
    accountName: (id?: string | null) => name(accounts.data, id),
  };
}

/** A signed rupee amount: green for money in, red for money out. */
export function Money({ value, kind, compact }: { value: number; kind?: Txn['kind']; compact?: boolean }) {
  const sign = kind === 'income' ? '+' : kind === 'expense' ? '−' : '';
  return (
    <span className={cn('tabular whitespace-nowrap', kind === 'income' && 'text-emerald-700', kind === 'expense' && 'text-red-700')}>
      {sign}{fmtINR(value, compact)}
    </span>
  );
}

export const blankTxn = (kind: Txn['kind'], patch: Partial<TxnInput> = {}): TxnInput => ({
  txn_date: todayIST(), kind, account_id: '', to_account_id: null, amount: 0, gst_amount: 0, tds_amount: 0,
  category: null, party: null, mode: 'bank_transfer', reference: null, description: null,
  project_id: null, site_id: null, invoice_id: null, bill_id: null, ...patch,
});

/** Record or correct money in, money out, or a transfer between accounts. */
export function TxnForm({ initial, id, onClose, onSaved }: {
  initial: TxnInput;
  id?: string | null;
  onClose: () => void;
  onSaved: () => unknown;
}) {
  const lk = useAccLookups();
  const canBills = useCan('projects.bills');
  const invoices = useInvoices();
  const bills = useAllBills(canBills.view);
  const txns = useTxns();
  const today = todayIST();
  const [f, setF] = useState({
    ...initial,
    amount: initial.amount ? String(initial.amount) : '',
    gst_amount: initial.gst_amount ? String(initial.gst_amount) : '',
    tds_amount: initial.tds_amount ? String(initial.tds_amount) : '',
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  // What other entries (not this one) have already settled.
  const others = useMemo(() => (txns.data ?? []).filter((t) => t.id !== id), [txns.data, id]);
  const received = useMemo(() => settledBy(others, 'invoice_id'), [others]);
  const paid = useMemo(() => settledBy(others, 'bill_id'), [others]);

  const openInvoices = (invoices.data ?? [])
    .map((inv) => ({ inv, s: invoiceState(inv, received.get(inv.id) ?? 0, today) }))
    .filter(({ inv, s }) => inv.status === 'sent' && (s.due > 0 || inv.id === f.invoice_id));
  const payableBills = (bills.data ?? [])
    .map((b) => ({ b, s: billState(b, paid.get(b.id) ?? 0) }))
    .filter(({ b, s }) => (b.status === 'accounts_approved' && s.due > 0) || b.id === f.bill_id);

  const accounts = lk.accounts.filter((a) => a.is_active || a.id === f.account_id || a.id === f.to_account_id);
  const categories = f.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function pickInvoice(v: string) {
    const hit = openInvoices.find((x) => x.inv.id === v);
    if (!hit) return set({ invoice_id: null });
    set({
      invoice_id: hit.inv.id, party: hit.inv.customer_name, amount: String(hit.s.due),
      category: f.category || 'Project billing', project_id: hit.inv.project_id ?? f.project_id, site_id: hit.inv.site_id ?? f.site_id,
    });
  }
  function pickBill(v: string) {
    const hit = payableBills.find((x) => x.b.id === v);
    if (!hit) return set({ bill_id: null });
    set({
      bill_id: hit.b.id, party: lk.vendorName(hit.b.vendor_id) ?? f.party, amount: String(hit.s.due),
      category: f.category || 'Vendor payment', project_id: hit.b.project_id ?? f.project_id,
    });
  }

  async function save() {
    if (!f.account_id) return toast.error(f.kind === 'transfer' ? 'Choose the account the money leaves.' : 'Choose the bank or cash account.');
    if (f.kind === 'transfer' && (!f.to_account_id || f.to_account_id === f.account_id)) return toast.error('Choose a different account the money goes to.');
    if (!(num(f.amount) > 0)) return toast.error('Give an amount above zero.');
    if (num(f.gst_amount) > num(f.amount)) return toast.error('The GST part cannot be more than the amount.');
    setBusy(true);
    try {
      await saveTxn({ ...f, amount: num(f.amount), gst_amount: num(f.gst_amount), tds_amount: num(f.tds_amount) }, id ?? null);
      toast.success(id ? 'Entry updated' : f.kind === 'income' ? 'Money in recorded' : f.kind === 'expense' ? 'Money out recorded' : 'Transfer recorded');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  const title = { income: 'Money in', expense: 'Money out', transfer: 'Transfer between accounts' }[f.kind];
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{id ? `Edit · ${title}` : title}</DialogTitle>
          <DialogDescription>
            {f.kind === 'income' ? 'Money received: from a customer, a refund, interest, anything that comes in.'
              : f.kind === 'expense' ? 'Money paid out: a vendor, salaries, site or office expenses.'
                : 'Moving money between your own accounts, e.g. cash deposited in the bank.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {!id && (
            <Field label="Type">
              <FilterSelect value={f.kind} onChange={(v) => set({ kind: v as Txn['kind'], invoice_id: null, bill_id: null, category: null })}
                options={[['income', 'Money in'], ['expense', 'Money out'], ['transfer', 'Transfer']]} />
            </Field>
          )}
          <Field label="Date" required><Input type="date" value={f.txn_date} onChange={(e) => set({ txn_date: e.target.value })} /></Field>
          <Field label={f.kind === 'transfer' ? 'From account' : f.kind === 'income' ? 'Received into' : 'Paid from'} required>
            <FilterSelect value={f.account_id || NONE} onChange={(v) => set({ account_id: unNone(v) })}
              options={[[NONE, 'Choose an account'], ...accounts.map((a) => [a.id, a.name] as [string, string])]} />
          </Field>
          {f.kind === 'transfer' && (
            <Field label="To account" required>
              <FilterSelect value={f.to_account_id || NONE} onChange={(v) => set({ to_account_id: unNone(v) || null })}
                options={[[NONE, 'Choose an account'], ...accounts.filter((a) => a.id !== f.account_id).map((a) => [a.id, a.name] as [string, string])]} />
            </Field>
          )}
          {f.kind === 'income' && (
            <Field label="Against invoice" className="sm:col-span-2" hint="Optional: settles that invoice">
              <FilterSelect value={f.invoice_id || NONE} onChange={pickInvoice}
                options={[[NONE, 'Not against an invoice'], ...openInvoices.map(({ inv, s }) =>
                  [inv.id, `${inv.invoice_no} · ${inv.customer_name} · ${fmtINR(s.due)} due`] as [string, string])]} />
            </Field>
          )}
          {f.kind === 'expense' && canBills.view && (
            <Field label="Against vendor bill" className="sm:col-span-2" hint="Only bills with the accounts approval">
              <FilterSelect value={f.bill_id || NONE} onChange={pickBill}
                options={[[NONE, 'Not against a bill'], ...payableBills.map(({ b, s }) =>
                  [b.id, `${b.bill_no} · ${lk.vendorName(b.vendor_id) ?? 'Vendor'} · ${fmtINR(s.due)} to pay`] as [string, string])]} />
            </Field>
          )}
          <Field label="Amount (₹)" required>
            <Input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" />
          </Field>
          {f.kind !== 'transfer' && (
            <>
              <Field label="GST included (₹)" hint="The GST part of the amount">
                <Input inputMode="decimal" value={f.gst_amount} onChange={(e) => set({ gst_amount: e.target.value })} placeholder="0" />
              </Field>
              <Field label="TDS (₹)" hint={f.kind === 'income' ? 'Deducted by the customer' : 'You deducted'}>
                <Input inputMode="decimal" value={f.tds_amount} onChange={(e) => set({ tds_amount: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Category">
                <Input list="acc-categories" value={f.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="Choose or type" />
                <datalist id="acc-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label={f.kind === 'income' ? 'Received from' : 'Paid to'}>
                <Input value={f.party ?? ''} onChange={(e) => set({ party: e.target.value })} placeholder="Customer, vendor, person" />
              </Field>
            </>
          )}
          <Field label="Mode">
            <FilterSelect value={f.mode} onChange={(v) => set({ mode: v })} options={Object.entries(MODES)} />
          </Field>
          <Field label="Reference" hint="UTR, cheque or receipt number">
            <Input value={f.reference ?? ''} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
          <Field label="Project">
            <FilterSelect value={f.project_id || NONE} onChange={(v) => set({ project_id: unNone(v) || null })} options={opt(lk.projects, 'None')} />
          </Field>
          <Field label="Site">
            <FilterSelect value={f.site_id || NONE} onChange={(v) => set({ site_id: unNone(v) || null })} options={opt(lk.sites, 'None')} />
          </Field>
          <Field label="Description" className="sm:col-span-3">
            <Textarea rows={2} value={f.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="What it was for" />
          </Field>
        </div>
        {!accounts.length && <p className="text-sm text-amber-700">Add a bank or cash account first, in Bank &amp; Cash.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};
export const dateRange = (from: string, to: string) =>
  from || to ? `${from ? fmtDate(from) : 'start'} to ${to ? fmtDate(to) : 'today'}` : 'All dates';
