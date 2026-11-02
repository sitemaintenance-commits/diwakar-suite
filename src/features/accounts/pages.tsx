// Accounts pages: Overview, Income & Expenses, Invoices & Receivables,
// Bills & Payables, Bank & Cash.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, Check, Download, HandCoins, IndianRupee, Landmark, Loader2, Pencil,
  Plus, Printer, ReceiptText, Search, Send, Trash2, Wallet, X,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { exportXlsx } from '@/lib/export';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { BILL } from '@/features/projects/shared';
import { UOMS, useOrders } from '@/features/procurement/api';
import {
  ACCOUNT_KINDS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, INVOICE_STATUS, KIND_LABEL, MODES, addBill, billState, invoiceState,
  invoiceTotals, num, removeRecord, saveAccount, saveInvoice, setBillStatus, setInvoiceStatus, settledBy, useAccOverview,
  useAccRefresh, useAccounts, useAllBills, useBalances, useInvoices, useTxns,
  type AccAccount, type Invoice, type InvoiceLine, type Txn, type TxnInput,
} from '@/features/accounts/api';
import {
  Money, NONE, TxnForm, blankTxn, dateRange, fmtMonth, opt, unNone, useAccLookups,
} from '@/features/accounts/shared';

type TxnDialog = { initial: TxnInput; id?: string } | null;
const toInput = (t: Txn): TxnInput => {
  const { id: _id, txn_no: _no, created_at: _c, ...rest } = t;
  return rest;
};

// =================================================================== overview
export function AccountsOverviewPage() {
  const q = useAccOverview();
  const canTxn = useCan('acc.transactions');
  const canInv = useCan('acc.invoices');
  const refresh = useAccRefresh();
  const [txn, setTxn] = useState<TxnDialog>(null);
  const d = q.data;
  const net = d ? num(d.month_income) - num(d.month_expense) : 0;
  const totalBal = d ? d.balances.filter((b) => b.is_active).reduce((s, b) => s + num(b.balance), 0) : 0;
  const peak = d ? Math.max(1, ...d.months.flatMap((m) => [num(m.income), num(m.expense)])) : 1;

  return (
    <>
      <PageHeader icon={Wallet} title="Accounts"
        description="Money in and out, what customers owe, what is to pay to vendors, and your bank and cash balances."
        actions={(
          <>
            {canTxn.create && <Button variant="outline" onClick={() => setTxn({ initial: blankTxn('income') })}><ArrowDownLeft /> Money in</Button>}
            {canTxn.create && <Button variant="outline" onClick={() => setTxn({ initial: blankTxn('expense') })}><ArrowUpRight /> Money out</Button>}
            {canInv.create && <Button asChild><Link to="/accounts/invoices?new=1"><Plus /> New invoice</Link></Button>}
          </>
        )} />
      {q.isLoading ? <Skeleton className="h-72 rounded-xl" /> : q.error ? (
        <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>
      ) : d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Money in this month" value={fmtINR(d.month_income, true)} hint={`GST ${fmtINR(d.month_gst_in, true)}`} icon={ArrowDownLeft} tone="green" />
            <StatCard label="Money out this month" value={fmtINR(d.month_expense, true)} hint={`GST ${fmtINR(d.month_gst_out, true)}`} icon={ArrowUpRight} tone="red" />
            <StatCard label="Net this month" value={fmtINR(net, true)} icon={IndianRupee} tone={net >= 0 ? 'green' : 'red'} />
            <StatCard label="To receive" value={fmtINR(d.receivable, true)}
              hint={d.overdue_count ? `${fmtINR(d.overdue, true)} overdue on ${d.overdue_count} invoice(s)` : `${fmtNumber(d.receivable_count)} invoice(s) open`}
              icon={ReceiptText} tone={d.overdue_count ? 'amber' : 'blue'} />
            <StatCard label="To pay vendors" value={fmtINR(d.payable, true)}
              hint={`${fmtINR(d.payable_approved, true)} approved, ready to pay`} icon={HandCoins} tone="violet" />
            <StatCard label="Bank & cash" value={fmtINR(totalBal, true)} hint={`${d.balances.filter((b) => b.is_active).length} account(s)`} icon={Landmark} tone={totalBal < 0 ? 'red' : 'slate'} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Last 6 months</CardTitle><CardDescription>Money in and money out, month by month</CardDescription></CardHeader>
              <CardContent>
                <div className="space-y-2.5">
                  {d.months.map((m) => (
                    <div key={m.month} className="grid grid-cols-[3.5rem_1fr_6.5rem] items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{fmtMonth(m.month)}</span>
                      <div className="space-y-1">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(100 * num(m.income)) / peak}%`, minWidth: num(m.income) ? 4 : 0 }} />
                        <div className="h-2 rounded-full bg-rose-400" style={{ width: `${(100 * num(m.expense)) / peak}%`, minWidth: num(m.expense) ? 4 : 0 }} />
                      </div>
                      <span className="tabular text-right">
                        <span className="text-emerald-700">{fmtINR(m.income, true)}</span><br />
                        <span className="text-red-700">{fmtINR(m.expense, true)}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Money in</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> Money out</span>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Bank & cash balances</CardTitle><CardDescription>Opening balance plus money in, less money out</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.balances.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">No accounts yet.</p> : (
                  <Table><TableBody>
                    {d.balances.map((b) => (
                      <TableRow key={b.account_id} className={cn(!b.is_active && 'opacity-60')}>
                        <TableCell><Link to="/accounts/banks" className="font-medium hover:underline">{b.name}</Link>
                          <span className="ml-2 text-xs text-muted-foreground">{ACCOUNT_KINDS[b.kind] ?? b.kind}{!b.is_active && ' · inactive'}</span></TableCell>
                        <TableCell className={cn('tabular text-right font-medium', num(b.balance) < 0 && 'text-red-700')}>{fmtINR(b.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Overdue invoices</CardTitle><CardDescription>Past their due date with money still to come</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.overdue_invoices.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing is overdue.</p> : (
                  <Table><TableBody>
                    {d.overdue_invoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell><Link to="/accounts/invoices" className="font-medium text-primary hover:underline">{i.invoice_no}</Link></TableCell>
                        <TableCell>{i.customer}</TableCell>
                        <TableCell className="text-red-700">Due {fmtDate(i.due_date)}</TableCell>
                        <TableCell className="tabular text-right font-medium">{fmtINR(i.due)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="pb-2"><CardTitle>Where the money went</CardTitle><CardDescription>This month's expenses by category</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.top_expenses.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">No expenses this month.</p> : (
                  <Table><TableBody>
                    {d.top_expenses.map((e) => (
                      <TableRow key={e.category}>
                        <TableCell className="font-medium">{e.category}</TableCell>
                        <TableCell className="tabular text-right">{fmtINR(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle>Recent entries</CardTitle><CardDescription>The latest money in, out and transfers</CardDescription></CardHeader>
              <CardContent className="p-0">
                {!d.recent.length ? <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing recorded yet. Start with “Money in” or “Money out”.</p> : (
                  <Table><TableBody>
                    {d.recent.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.txn_date)}</TableCell>
                        <TableCell><Badge variant={KIND_LABEL[r.kind].tone}>{KIND_LABEL[r.kind].label}</Badge></TableCell>
                        <TableCell>{r.party || r.category || r.txn_no}</TableCell>
                        <TableCell className="text-right font-medium"><Money value={r.amount} kind={r.kind} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>
                )}
                <div className="border-t px-5 py-2.5 text-right"><Link to="/accounts/transactions" className="text-sm text-primary hover:underline">All entries →</Link></div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
      {txn && <TxnForm initial={txn.initial} onClose={() => setTxn(null)} onSaved={refresh} />}
    </>
  );
}

// ========================================================== income & expenses
export function TransactionsPage() {
  const can = useCan('acc.transactions');
  const q = useTxns();
  const lk = useAccLookups();
  const invoices = useInvoices();
  const bills = useAllBills(useCan('projects.bills').view);
  const refresh = useAccRefresh();
  const [txn, setTxn] = useState<TxnDialog>(null);
  const [removing, setRemoving] = useState<Txn | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [account, setAccount] = useState('all');
  const [category, setCategory] = useState('all');
  const [mode, setMode] = useState('all');
  const [project, setProject] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(200);

  const invNo = (id: string | null) => (id && invoices.data?.find((i) => i.id === id)?.invoice_no) || null;
  const billNo = (id: string | null) => (id && bills.data?.find((b) => b.id === id)?.bill_no) || null;
  const categories = useMemo(() => [...new Set([...(q.data ?? []).map((t) => t.category).filter(Boolean) as string[],
    ...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])].sort(), [q.data]);

  const rows = (q.data ?? []).filter((t) =>
    (kind === 'all' || t.kind === kind)
    && (account === 'all' || t.account_id === account || t.to_account_id === account)
    && (category === 'all' || t.category === category)
    && (mode === 'all' || t.mode === mode)
    && (project === 'all' || t.project_id === project)
    && (!from || t.txn_date >= from) && (!to || t.txn_date <= to)
    && (!search || [t.txn_no, t.party, t.category, t.reference, t.description, invNo(t.invoice_id), billNo(t.bill_id)]
      .filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())));
  const sum = (k: Txn['kind'], f: (t: Txn) => number = (t) => num(t.amount)) => rows.filter((t) => t.kind === k).reduce((s, t) => s + f(t), 0);
  const tIn = sum('income');
  const tOut = sum('expense');

  async function onExport() {
    await exportXlsx('acc.transactions', `income-expenses-${todayIST()}.xlsx`, rows, [
      { header: 'Entry', value: (t) => t.txn_no, width: 12 },
      { header: 'Date', value: (t) => t.txn_date, width: 12 },
      { header: 'Type', value: (t) => KIND_LABEL[t.kind].label, width: 11 },
      { header: 'Account', value: (t) => lk.accountName(t.account_id), width: 20 },
      { header: 'To account', value: (t) => lk.accountName(t.to_account_id), width: 20 },
      { header: 'Category', value: (t) => t.category, width: 20 },
      { header: 'Party', value: (t) => t.party, width: 24 },
      { header: 'Mode', value: (t) => MODES[t.mode] ?? t.mode, width: 14 },
      { header: 'Reference', value: (t) => t.reference, width: 16 },
      { header: 'Money in', value: (t) => (t.kind === 'income' ? num(t.amount) : null), numFmt: '#,##0.00', width: 14 },
      { header: 'Money out', value: (t) => (t.kind === 'expense' ? num(t.amount) : null), numFmt: '#,##0.00', width: 14 },
      { header: 'Transfer', value: (t) => (t.kind === 'transfer' ? num(t.amount) : null), numFmt: '#,##0.00', width: 14 },
      { header: 'GST included', value: (t) => num(t.gst_amount), numFmt: '#,##0.00', width: 12 },
      { header: 'TDS', value: (t) => num(t.tds_amount), numFmt: '#,##0.00', width: 10 },
      { header: 'Invoice', value: (t) => invNo(t.invoice_id), width: 12 },
      { header: 'Vendor bill', value: (t) => billNo(t.bill_id), width: 12 },
      { header: 'Project', value: (t) => lk.projectName(t.project_id), width: 20 },
      { header: 'Site', value: (t) => lk.siteName(t.site_id), width: 16 },
      { header: 'Description', value: (t) => t.description, width: 30 },
    ], { sheet: 'Income & Expenses', title: ['Income & Expenses', dateRange(from, to)], totals: { 9: tIn, 10: tOut } });
  }

  async function remove(t: Txn) {
    try { await removeRecord('acc_transactions', t.id); toast.success('Entry deleted'); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
    setRemoving(null);
  }

  const shown = rows.slice(0, limit);
  return (
    <>
      <PageHeader icon={ArrowLeftRight} title="Income & Expenses"
        description="Every rupee in and out: account, category, party, mode, GST and TDS, project and site."
        actions={(
          <>
            {can.export && <Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export Excel</Button>}
            {can.create && <Button variant="outline" onClick={() => setTxn({ initial: blankTxn('transfer') })}><ArrowLeftRight /> Transfer</Button>}
            {can.create && <Button variant="outline" onClick={() => setTxn({ initial: blankTxn('expense') })}><ArrowUpRight /> Money out</Button>}
            {can.create && <Button onClick={() => setTxn({ initial: blankTxn('income') })}><ArrowDownLeft /> Money in</Button>}
          </>
        )} />
      <Card className="mb-3"><CardContent className="grid gap-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search party, category, reference, invoice or bill" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <FilterSelect value={kind} onChange={setKind} options={[['all', 'Money in and out'], ['income', 'Money in'], ['expense', 'Money out'], ['transfer', 'Transfers']]} />
        <FilterSelect value={account} onChange={setAccount} options={[['all', 'All accounts'], ...lk.accounts.map((a) => [a.id, a.name] as [string, string])]} />
        <FilterSelect value={category} onChange={setCategory} options={[['all', 'All categories'], ...categories.map((c) => [c, c] as [string, string])]} />
        <FilterSelect value={mode} onChange={setMode} options={[['all', 'All modes'], ...Object.entries(MODES)]} />
        <FilterSelect value={project} onChange={setProject} options={[['all', 'All projects'], ...opt(lk.projects)]} />
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
      </CardContent></Card>
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Money in" value={fmtINR(tIn, true)} hint={`GST ${fmtINR(sum('income', (t) => num(t.gst_amount)), true)}`} icon={ArrowDownLeft} tone="green" />
        <StatCard label="Money out" value={fmtINR(tOut, true)} hint={`GST ${fmtINR(sum('expense', (t) => num(t.gst_amount)), true)}`} icon={ArrowUpRight} tone="red" />
        <StatCard label="Net" value={fmtINR(tIn - tOut, true)} icon={IndianRupee} tone={tIn - tOut >= 0 ? 'green' : 'red'} />
        <StatCard label="Entries" value={fmtNumber(rows.length)} hint={dateRange(from, to)} icon={ArrowLeftRight} tone="slate" />
      </div>
      <Card className="overflow-hidden">
        {q.isLoading ? <Skeleton className="h-60" /> : q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <EmptyState icon={ArrowLeftRight} title="No entries" description={(q.data ?? []).length ? 'Nothing matches these filters.' : 'Record money in or out to start the books.'} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Party · category</TableHead><TableHead>Account</TableHead>
                <TableHead>Mode · reference</TableHead><TableHead>For</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {shown.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap"><div>{fmtDate(t.txn_date)}</div><div className="text-xs text-muted-foreground">{t.txn_no}</div></TableCell>
                    <TableCell><Badge variant={KIND_LABEL[t.kind].tone}>{KIND_LABEL[t.kind].label}</Badge></TableCell>
                    <TableCell className="max-w-[16rem]">
                      <div className="truncate font-medium" title={t.party ?? ''}>{t.party || (t.kind === 'transfer' ? 'Between accounts' : '—')}</div>
                      <div className="truncate text-xs text-muted-foreground" title={t.description ?? ''}>{[t.category, t.description].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{lk.accountName(t.account_id)}{t.to_account_id && <> → {lk.accountName(t.to_account_id)}</>}</TableCell>
                    <TableCell className="text-xs"><div>{MODES[t.mode]?.split(' (')[0] ?? t.mode}</div><div className="text-muted-foreground">{t.reference}</div></TableCell>
                    <TableCell className="text-xs">
                      {[invNo(t.invoice_id) && `Invoice ${invNo(t.invoice_id)}`, billNo(t.bill_id) && `Bill ${billNo(t.bill_id)}`,
                        lk.projectName(t.project_id), lk.siteName(t.site_id)].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium">
                      <Money value={num(t.amount)} kind={t.kind} />
                      {(num(t.gst_amount) > 0 || num(t.tds_amount) > 0) && (
                        <div className="text-[11px] font-normal text-muted-foreground">
                          {[num(t.gst_amount) > 0 && `GST ${fmtINR(t.gst_amount)}`, num(t.tds_amount) > 0 && `TDS ${fmtINR(t.tds_amount)}`].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {can.edit && <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setTxn({ initial: toInput(t), id: t.id })}><Pencil /></Button>}
                      {can.delete && <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Delete" onClick={() => setRemoving(t)}><Trash2 /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {rows.length > limit && (
          <div className="border-t p-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit(limit + 200)}>Show more ({fmtNumber(rows.length - limit)} left)</Button></div>
        )}
      </Card>
      {txn && <TxnForm initial={txn.initial} id={txn.id} onClose={() => setTxn(null)} onSaved={refresh} />}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} destructive confirmLabel="Delete"
        title={`Delete ${removing?.txn_no}?`}
        description={removing?.bill_id ? 'This payment is against a vendor bill; the bill will show it as unpaid again.' : 'The entry leaves the books and the balances.'}
        onConfirm={() => removing && void remove(removing)} />
    </>
  );
}

// =================================================================== invoices
export function InvoicesPage() {
  const can = useCan('acc.invoices');
  const canTxn = useCan('acc.transactions');
  const q = useInvoices();
  const txns = useTxns();
  const lk = useAccLookups();
  const refresh = useAccRefresh();
  const today = todayIST();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Invoice | 'new' | null>(params.get('new') ? 'new' : null);
  const [txn, setTxn] = useState<TxnDialog>(null);
  const [removing, setRemoving] = useState<Invoice | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const received = useMemo(() => settledBy(txns.data ?? [], 'invoice_id'), [txns.data]);

  const all = (q.data ?? []).map((inv) => ({ inv, s: invoiceState(inv, received.get(inv.id) ?? 0, today) }));
  const rows = all.filter(({ inv, s }) =>
    (status === 'all' || (status === 'open' ? ['sent', 'part_paid', 'overdue', 'draft'].includes(s.key) : s.key === status))
    && (!search || `${inv.invoice_no} ${inv.customer_name} ${inv.customer_gstin ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const live = all.filter(({ inv }) => inv.status === 'sent');
  const due = live.reduce((x, { s }) => x + s.due, 0);
  const overdue = live.filter(({ s }) => s.key === 'overdue');
  const month = today.slice(0, 7);
  const billedMonth = live.filter(({ inv }) => inv.invoice_date.startsWith(month)).reduce((x, { s }) => x + s.total, 0);

  async function act(inv: Invoice, s: Invoice['status'], done: string) {
    try { await setInvoiceStatus(inv.id, s); toast.success(done); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function remove(inv: Invoice) {
    try { await removeRecord('acc_invoices', inv.id); toast.success('Invoice deleted'); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
    setRemoving(null);
  }
  async function onExport() {
    await exportXlsx('acc.invoices', `invoices-${today}.xlsx`, rows, [
      { header: 'Invoice', value: (r) => r.inv.invoice_no, width: 12 },
      { header: 'Date', value: (r) => r.inv.invoice_date, width: 12 },
      { header: 'Due', value: (r) => r.inv.due_date, width: 12 },
      { header: 'Customer', value: (r) => r.inv.customer_name, width: 28 },
      { header: 'GSTIN', value: (r) => r.inv.customer_gstin, width: 18 },
      { header: 'Project', value: (r) => lk.projectName(r.inv.project_id), width: 20 },
      { header: 'Taxable', value: (r) => invoiceTotals(r.inv).sub, numFmt: '#,##0.00', width: 14 },
      { header: 'GST', value: (r) => invoiceTotals(r.inv).tax, numFmt: '#,##0.00', width: 12 },
      { header: 'Total', value: (r) => r.s.total, numFmt: '#,##0.00', width: 14 },
      { header: 'Received', value: (r) => r.s.received, numFmt: '#,##0.00', width: 14 },
      { header: 'Balance', value: (r) => r.s.due, numFmt: '#,##0.00', width: 14 },
      { header: 'Status', value: (r) => INVOICE_STATUS[r.s.key]?.label, width: 12 },
    ], { sheet: 'Invoices', title: ['Invoices & Receivables', `Exported ${fmtDate(today)}`] });
  }

  return (
    <>
      <PageHeader icon={ReceiptText} title="Invoices & Receivables"
        description="Customer invoices with GST, due dates and payments received. What is outstanding and what is overdue."
        actions={(
          <>
            {can.export && <Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export Excel</Button>}
            {can.create && <Button onClick={() => setEditing('new')}><Plus /> New invoice</Button>}
          </>
        )} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="To receive" value={fmtINR(due, true)} hint={`${live.filter(({ s }) => s.due > 0).length} open invoice(s)`} icon={ReceiptText} tone="blue" />
        <StatCard label="Overdue" value={fmtINR(overdue.reduce((x, { s }) => x + s.due, 0), true)} hint={`${overdue.length} invoice(s)`} icon={ReceiptText} tone={overdue.length ? 'red' : 'green'} />
        <StatCard label="Invoiced this month" value={fmtINR(billedMonth, true)} icon={IndianRupee} tone="violet" />
        <StatCard label="Drafts" value={fmtNumber(all.filter(({ inv }) => inv.status === 'draft').length)} icon={Pencil} tone="slate" />
      </div>
      <Card className="mb-3"><CardContent className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="relative w-72"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search number, customer or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><FilterSelect value={status} onChange={setStatus}
          options={[['open', 'Open and drafts'], ['all', 'All'], ...Object.entries(INVOICE_STATUS).map(([k, v]) => [k, v.label] as [string, string])]} /></div>
      </CardContent></Card>
      <Card className="overflow-hidden">
        {q.isLoading ? <Skeleton className="h-60" /> : q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <EmptyState icon={ReceiptText} title="No invoices" description={all.length ? 'Nothing matches these filters.' : 'Raise an invoice for a customer; payments received settle it.'} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(({ inv, s }) => (
                  <TableRow key={inv.id}>
                    <TableCell className="whitespace-nowrap"><div className="font-medium">{inv.invoice_no}</div><div className="text-xs text-muted-foreground">{fmtDate(inv.invoice_date)}</div></TableCell>
                    <TableCell className="max-w-[16rem]">
                      <div className="truncate font-medium">{inv.customer_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{[inv.customer_gstin, lk.projectName(inv.project_id), lk.siteName(inv.site_id)].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell className={cn('whitespace-nowrap', s.key === 'overdue' && 'font-medium text-red-700')}>{inv.due_date ? fmtDate(inv.due_date) : '—'}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(s.total)}</TableCell>
                    <TableCell className="tabular text-right text-emerald-700">{s.received ? fmtINR(s.received) : '—'}</TableCell>
                    <TableCell className="tabular text-right font-medium">{inv.status === 'sent' ? fmtINR(s.due) : '—'}</TableCell>
                    <TableCell><Badge variant={INVOICE_STATUS[s.key]?.tone}>{INVOICE_STATUS[s.key]?.label}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {inv.status === 'sent' && s.due > 0 && canTxn.create && (
                        <Button size="sm" variant="outline" onClick={() => setTxn({ initial: blankTxn('income', {
                          invoice_id: inv.id, amount: s.due, party: inv.customer_name, category: 'Project billing',
                          project_id: inv.project_id, site_id: inv.site_id }) })}><ArrowDownLeft /> Receive</Button>
                      )}
                      {inv.status === 'draft' && can.edit && <Button size="sm" variant="outline" onClick={() => void act(inv, 'sent', 'Invoice marked sent')}><Send /> Mark sent</Button>}
                      <Button size="icon-sm" variant="ghost" aria-label="Print" title="Print the invoice" onClick={() => printInvoice(inv, lk)}><Printer /></Button>
                      {can.edit && inv.status !== 'cancelled' && <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(inv)}><Pencil /></Button>}
                      {can.edit && inv.status !== 'cancelled' && !s.received && (
                        <Button size="icon-sm" variant="ghost" aria-label="Cancel invoice" title="Cancel the invoice" onClick={() => void act(inv, 'cancelled', 'Invoice cancelled')}><Ban /></Button>
                      )}
                      {can.delete && !s.received && <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Delete" onClick={() => setRemoving(inv)}><Trash2 /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {editing && <InvoiceForm invoice={editing === 'new' ? null : editing} onClose={() => { setEditing(null); if (params.get('new')) setParams({}, { replace: true }); }} onSaved={refresh} />}
      {txn && <TxnForm initial={txn.initial} onClose={() => setTxn(null)} onSaved={refresh} />}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} destructive confirmLabel="Delete"
        title={`Delete ${removing?.invoice_no}?`} description="The invoice and its lines are removed. To keep a record, cancel it instead."
        onConfirm={() => removing && void remove(removing)} />
    </>
  );
}

const blankLine = (): InvoiceLine => ({ description: '', hsn_code: '', qty: '1', uom: 'nos', rate: '', gst_rate: '18' });

function InvoiceForm({ invoice, onClose, onSaved }: { invoice: Invoice | null; onClose: () => void; onSaved: () => unknown }) {
  const lk = useAccLookups();
  const [f, setF] = useState({
    invoice_no: invoice?.invoice_no ?? '', invoice_date: invoice?.invoice_date ?? todayIST(), due_date: invoice?.due_date ?? '',
    customer_name: invoice?.customer_name ?? '', customer_gstin: invoice?.customer_gstin ?? '', customer_address: invoice?.customer_address ?? '',
    customer_phone: invoice?.customer_phone ?? '', customer_email: invoice?.customer_email ?? '', place_of_supply: invoice?.place_of_supply ?? '',
    project_id: invoice?.project_id ?? '', site_id: invoice?.site_id ?? '', status: invoice?.status ?? 'sent',
    notes: invoice?.notes ?? '', terms: invoice?.terms ?? '',
  });
  const [lines, setLines] = useState<InvoiceLine[]>(invoice?.lines.length
    ? [...invoice.lines].map((l) => ({ ...l, qty: String(l.qty), rate: String(l.rate), gst_rate: String(l.gst_rate), hsn_code: l.hsn_code ?? '' }))
    : [blankLine()]);
  const [busy, setBusy] = useState(false);
  const t = invoiceTotals({ lines });
  const setLine = (i: number, patch: Partial<InvoiceLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const dueIn = (days: number) => {
    const d = new Date(`${f.invoice_date}T00:00:00`);
    d.setDate(d.getDate() + days);
    setF({ ...f, due_date: d.toISOString().slice(0, 10) });
  };

  async function save() {
    if (f.customer_name.trim().length < 2) return toast.error('Give the customer name.');
    if (!lines.some((l) => l.description.trim() && num(l.qty) > 0)) return toast.error('Add at least one line.');
    if (f.due_date && f.due_date < f.invoice_date) return toast.error('The due date cannot be before the invoice date.');
    setBusy(true);
    try {
      await saveInvoice({ ...f, due_date: f.due_date || null, project_id: f.project_id || null, site_id: f.site_id || null } as Omit<Invoice, 'id' | 'created_at' | 'lines'>,
        lines, invoice?.id ?? null);
      toast.success(invoice ? 'Invoice saved' : 'Invoice created');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{invoice ? `Edit ${invoice.invoice_no}` : 'New invoice'}</DialogTitle>
          <DialogDescription>Who it is for, what was supplied, and when it is due. Leave the number empty to get the next one.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Invoice number" hint="Empty = next number"><Input value={f.invoice_no} maxLength={40} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} placeholder="INV-0001" /></Field>
          <Field label="Invoice date" required><Input type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></Field>
          <Field label="Due date">
            <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
            <div className="mt-1 flex gap-1">{[0, 15, 30, 45].map((d) => (
              <button key={d} type="button" className="rounded border px-1.5 text-[11px] text-muted-foreground hover:bg-muted" onClick={() => dueIn(d)}>{d ? `${d} days` : 'On receipt'}</button>
            ))}</div>
          </Field>
          <Field label="Status"><FilterSelect value={f.status} onChange={(v) => setF({ ...f, status: v as Invoice['status'] })} options={[['draft', 'Draft (not owed yet)'], ['sent', 'Sent to customer']]} /></Field>
          <Field label="Customer name" required className="sm:col-span-2"><Input value={f.customer_name} maxLength={200} onChange={(e) => setF({ ...f, customer_name: e.target.value })} placeholder="Company or person billed" /></Field>
          <Field label="Customer GSTIN"><Input value={f.customer_gstin} maxLength={15} onChange={(e) => setF({ ...f, customer_gstin: e.target.value.toUpperCase() })} placeholder="08ABCDE1234F1Z5" /></Field>
          <Field label="Place of supply"><Input value={f.place_of_supply} onChange={(e) => setF({ ...f, place_of_supply: e.target.value })} placeholder="e.g. Rajasthan (08)" /></Field>
          <Field label="Phone"><Input value={f.customer_phone} onChange={(e) => setF({ ...f, customer_phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.customer_email} onChange={(e) => setF({ ...f, customer_email: e.target.value })} /></Field>
          <Field label="Project"><FilterSelect value={f.project_id || NONE} onChange={(v) => setF({ ...f, project_id: unNone(v) })} options={opt(lk.projects, 'None')} /></Field>
          <Field label="Site"><FilterSelect value={f.site_id || NONE} onChange={(v) => setF({ ...f, site_id: unNone(v) })} options={opt(lk.sites, 'None')} /></Field>
          <Field label="Billing address" className="sm:col-span-4"><Textarea rows={2} value={f.customer_address} onChange={(e) => setF({ ...f, customer_address: e.target.value })} /></Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Lines</p>
          <div className="grid gap-2">
            <div className="hidden grid-cols-[minmax(0,2fr)_6rem_5rem_5.5rem_7rem_4.5rem_7rem_2rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
              <span>Description</span><span>HSN / SAC</span><span>Qty</span><span>Unit</span><span>Rate (₹)</span><span>GST %</span><span className="text-right">Amount</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[minmax(0,2fr)_6rem_5rem_5.5rem_7rem_4.5rem_7rem_2rem] md:border-0 md:p-0">
                <Input className="col-span-2 md:col-span-1" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="What was supplied or done" />
                <Input value={l.hsn_code ?? ''} onChange={(e) => setLine(i, { hsn_code: e.target.value })} placeholder="HSN / SAC" />
                <Input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="Qty" />
                <FilterSelect value={l.uom} onChange={(v) => setLine(i, { uom: v })} options={[...new Set([l.uom, ...UOMS, 'kWp', 'kWh', 'month'])].map((u) => [u, u] as [string, string])} />
                <Input inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="0" />
                <Input inputMode="decimal" value={l.gst_rate} onChange={(e) => setLine(i, { gst_rate: e.target.value })} />
                <span className="tabular self-center text-right text-sm">{fmtINR(num(l.qty) * num(l.rate) * (1 + num(l.gst_rate) / 100))}</span>
                <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Remove line" disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}><X /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Button variant="outline" size="sm" onClick={() => setLines([...lines, blankLine()])}><Plus /> Add line</Button>
              <div className="tabular min-w-[14rem] space-y-0.5 text-sm">
                <div className="flex justify-between gap-6"><span className="text-muted-foreground">Taxable value</span>{fmtINR(t.sub)}</div>
                <div className="flex justify-between gap-6"><span className="text-muted-foreground">GST</span>{fmtINR(t.tax)}</div>
                <div className="flex justify-between gap-6 border-t pt-1 font-semibold"><span>Total</span>{fmtINR(t.total)}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="PO reference, period covered" /></Field>
          <Field label="Terms & bank details"><Textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="Payment terms, bank account for payment" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save invoice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function printInvoice(inv: Invoice, lk: ReturnType<typeof useAccLookups>) {
  const t = invoiceTotals(inv);
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const w = window.open('', '_blank');
  if (!w) return toast.error('Allow pop-ups to print.');
  w.document.write(`<!doctype html><html><head><title>${esc(inv.invoice_no)}</title><style>
    body{font:13px system-ui,sans-serif;color:#0f172a;margin:32px} h1{font-size:20px;margin:0} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left} th{background:#f1f5f9} .r{text-align:right} .grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}
    .muted{color:#64748b}</style></head><body>
    <h1>${inv.status === 'draft' ? 'Draft ' : ''}Tax Invoice ${esc(inv.invoice_no)}</h1>
    <div class="muted">Diwakar Renewable &amp; Infra Pvt. Ltd. · ${esc(fmtDate(inv.invoice_date))}${inv.due_date ? ` · Due ${esc(fmtDate(inv.due_date))}` : ''}</div>
    <div class="grid"><div><b>Bill to</b><br>${esc(inv.customer_name)}${inv.customer_address ? `<br>${esc(inv.customer_address).replace(/\n/g, '<br>')}` : ''}
      ${inv.customer_gstin ? `<br>GSTIN ${esc(inv.customer_gstin)}` : ''}${inv.customer_phone ? `<br>${esc(inv.customer_phone)}` : ''}${inv.customer_email ? `<br>${esc(inv.customer_email)}` : ''}</div>
    <div>${inv.place_of_supply ? `<b>Place of supply</b><br>${esc(inv.place_of_supply)}<br>` : ''}${lk.projectName(inv.project_id) ? `Project: ${esc(lk.projectName(inv.project_id))}<br>` : ''}${lk.siteName(inv.site_id) ? `Site: ${esc(lk.siteName(inv.site_id))}` : ''}</div></div>
    <table><thead><tr><th>#</th><th>Description</th><th>HSN / SAC</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">GST %</th><th class="r">GST</th><th class="r">Amount</th></tr></thead><tbody>
    ${inv.lines.map((l, i) => {
      const a = num(l.qty) * num(l.rate);
      const g = (a * num(l.gst_rate)) / 100;
      return `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td>${esc(l.hsn_code ?? '')}</td><td class="r">${esc(l.qty)}</td><td>${esc(l.uom)}</td><td class="r">${esc(fmtINR(num(l.rate)))}</td><td class="r">${esc(fmtINR(a))}</td><td class="r">${esc(l.gst_rate)}</td><td class="r">${esc(fmtINR(g))}</td><td class="r">${esc(fmtINR(a + g))}</td></tr>`;
    }).join('')}
    <tr><td colspan="9" class="r">Taxable value</td><td class="r">${esc(fmtINR(t.sub))}</td></tr><tr><td colspan="9" class="r">GST</td><td class="r">${esc(fmtINR(t.tax))}</td></tr>
    <tr><td colspan="9" class="r"><b>Total</b></td><td class="r"><b>${esc(fmtINR(t.total))}</b></td></tr></tbody></table>
    ${inv.notes ? `<p>${esc(inv.notes)}</p>` : ''}${inv.terms ? `<p><b>Terms:</b> ${esc(inv.terms).replace(/\n/g, '<br>')}</p>` : ''}
    <p style="margin-top:48px">Authorised signatory</p><script>window.print()</script></body></html>`);
  w.document.close();
}

// ====================================================================== bills
export function BillsPage() {
  const canBills = useCan('projects.bills');
  const canPay = useCan('projects.payments');
  const canTxn = useCan('acc.transactions');
  const canAcc = useCan('acc.bills');
  const q = useAllBills(canBills.view);
  const txns = useTxns();
  const lk = useAccLookups();
  const refresh = useAccRefresh();
  const today = todayIST();
  const [txn, setTxn] = useState<TxnDialog>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [vendor, setVendor] = useState('all');
  const paid = useMemo(() => settledBy(txns.data ?? [], 'bill_id'), [txns.data]);
  const payments = (id: string) => (txns.data ?? []).filter((t) => t.bill_id === id).length;

  const all = (q.data ?? []).map((b) => ({ b, s: billState(b, paid.get(b.id) ?? 0) }));
  const rows = all.filter(({ b, s }) =>
    (status === 'all' || (status === 'open' ? b.status !== 'rejected' && s.due > 0 : b.status === status))
    && (vendor === 'all' || b.vendor_id === vendor)
    && (!search || `${b.bill_no} ${lk.vendorName(b.vendor_id) ?? ''} ${b.description ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const total = (pred: (x: (typeof all)[number]) => boolean) => all.filter(pred).reduce((x, { s }) => x + s.due, 0);
  const month = today.slice(0, 7);
  const paidMonth = (txns.data ?? []).filter((t) => t.bill_id && t.txn_date.startsWith(month)).reduce((x, t) => x + num(t.amount), 0);

  async function move(id: string, s: string, done: string) {
    try { await setBillStatus(id, s); toast.success(done); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function onExport() {
    await exportXlsx('acc.bills', `vendor-bills-${today}.xlsx`, rows, [
      { header: 'Bill', value: (r) => r.b.bill_no, width: 14 },
      { header: 'Date', value: (r) => r.b.bill_date, width: 12 },
      { header: 'Vendor', value: (r) => lk.vendorName(r.b.vendor_id), width: 26 },
      { header: 'Project', value: (r) => lk.projectName(r.b.project_id), width: 20 },
      { header: 'Amount', value: (r) => num(r.b.amount), numFmt: '#,##0.00', width: 14 },
      { header: 'Deductions', value: (r) => num(r.b.deductions), numFmt: '#,##0.00', width: 12 },
      { header: 'Net payable', value: (r) => r.s.net, numFmt: '#,##0.00', width: 14 },
      { header: 'Paid', value: (r) => r.s.paid, numFmt: '#,##0.00', width: 14 },
      { header: 'Balance', value: (r) => r.s.due, numFmt: '#,##0.00', width: 14 },
      { header: 'Status', value: (r) => BILL[r.b.status]?.label, width: 16 },
      { header: 'Paid on', value: (r) => r.b.paid_on, width: 12 },
      { header: 'UTR', value: (r) => r.b.utr_no, width: 16 },
    ], { sheet: 'Vendor bills', title: ['Bills & Payables', `Exported ${fmtDate(today)}`] });
  }

  if (!canBills.view) {
    return (
      <>
        <PageHeader icon={HandCoins} title="Bills & Payables" description="Vendor bills, their approvals, payments made and what is still due." />
        <Card><EmptyState icon={HandCoins} title="You cannot see vendor bills" description="Ask an administrator for View on Vendor Payment Approval (Projects)." /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={HandCoins} title="Bills & Payables"
        description="Vendor bills from every project: project-manager approval, accounts approval, then payment. A bill paid in full is marked paid."
        actions={(
          <>
            {canAcc.export && <Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export Excel</Button>}
            {canBills.create && <Button onClick={() => setAdding(true)}><Plus /> Add bill</Button>}
          </>
        )} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Approved, ready to pay" value={fmtINR(total(({ b, s }) => b.status === 'accounts_approved' && s.due > 0), true)}
          hint={`${all.filter(({ b, s }) => b.status === 'accounts_approved' && s.due > 0).length} bill(s)`} icon={HandCoins} tone="violet" />
        <StatCard label="Awaiting approval" value={fmtINR(total(({ b }) => b.status === 'submitted' || b.status === 'pm_approved'), true)}
          hint={`${all.filter(({ b }) => b.status === 'submitted' || b.status === 'pm_approved').length} bill(s)`} icon={HandCoins} tone="amber" />
        <StatCard label="Total to pay" value={fmtINR(total(({ b }) => b.status !== 'rejected'), true)} icon={IndianRupee} tone="red" />
        <StatCard label="Paid this month" value={fmtINR(paidMonth, true)} icon={Check} tone="green" />
      </div>
      <Card className="mb-3"><CardContent className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="relative w-72"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search bill number, vendor or description" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><FilterSelect value={status} onChange={setStatus}
          options={[['open', 'Still to pay'], ['all', 'All'], ...Object.entries(BILL).map(([k, v]) => [k, v.label] as [string, string])]} /></div>
        <div className="w-56"><FilterSelect value={vendor} onChange={setVendor} options={[['all', 'All vendors'], ...opt(lk.vendors)]} /></div>
      </CardContent></Card>
      <Card className="overflow-hidden">
        {q.isLoading ? <Skeleton className="h-60" /> : q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !rows.length ? (
          <EmptyState icon={HandCoins} title="No vendor bills" description={all.length ? 'Nothing matches these filters.' : 'Bills recorded here or on a project appear for approval and payment.'} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Bill</TableHead><TableHead>Vendor</TableHead><TableHead>Project</TableHead>
                <TableHead className="text-right">Net payable</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(({ b, s }) => (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap"><div className="font-medium">{b.bill_no}</div><div className="text-xs text-muted-foreground">{fmtDate(b.bill_date)}</div></TableCell>
                    <TableCell className="max-w-[14rem]"><div className="truncate font-medium">{lk.vendorName(b.vendor_id) ?? '—'}</div>
                      <div className="truncate text-xs text-muted-foreground" title={b.description ?? ''}>{b.description}</div></TableCell>
                    <TableCell className="text-sm">{lk.projectName(b.project_id) ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(s.net)}{num(b.deductions) > 0 && <div className="text-[11px] text-muted-foreground">after {fmtINR(b.deductions)} deductions</div>}</TableCell>
                    <TableCell className="tabular text-right text-emerald-700">{s.paid ? fmtINR(s.paid) : '—'}
                      {payments(b.id) > 0 && <div className="text-[11px] text-muted-foreground">{payments(b.id)} payment(s)</div>}</TableCell>
                    <TableCell className="tabular text-right font-medium">{b.status === 'rejected' ? '—' : fmtINR(s.due)}</TableCell>
                    <TableCell><Badge variant={BILL[b.status]?.tone}>{BILL[b.status]?.label}</Badge>
                      {b.paid_on && <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDate(b.paid_on)}{b.utr_no ? ` · ${b.utr_no}` : ''}</div>}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {b.status === 'submitted' && canBills.approve && <Button size="sm" variant="outline" onClick={() => void move(b.id, 'pm_approved', 'Bill approved by the project manager')}>PM approve</Button>}
                      {b.status === 'pm_approved' && canPay.approve && <Button size="sm" variant="outline" onClick={() => void move(b.id, 'accounts_approved', 'Accounts approval given')}>Accounts approve</Button>}
                      {b.status === 'accounts_approved' && s.due > 0 && canTxn.create && (
                        <Button size="sm" onClick={() => setTxn({ initial: blankTxn('expense', {
                          bill_id: b.id, amount: s.due, party: lk.vendorName(b.vendor_id), category: 'Vendor payment', project_id: b.project_id }) })}>
                          <ArrowUpRight /> Pay
                        </Button>
                      )}
                      {(b.status === 'submitted' || b.status === 'pm_approved') && canBills.approve && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void move(b.id, 'rejected', 'Bill rejected')}>Reject</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {adding && <BillForm onClose={() => setAdding(false)} onSaved={refresh} />}
      {txn && <TxnForm initial={txn.initial} onClose={() => setTxn(null)} onSaved={refresh} />}
    </>
  );
}

function BillForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => unknown }) {
  const lk = useAccLookups();
  const orders = useOrders();
  const [f, setF] = useState({ vendor_id: '', bill_no: '', bill_date: todayIST(), amount: '', deductions: '', description: '', project_id: '', po_id: '' });
  const [busy, setBusy] = useState(false);
  const vendorOrders = (orders.data ?? []).filter((o) => o.vendor_id === f.vendor_id && o.status !== 'cancelled' && o.status !== 'draft');

  async function save() {
    if (!f.vendor_id || !f.bill_no.trim()) return toast.error('Vendor and bill number are required.');
    if (!(num(f.amount) > 0)) return toast.error('Give the bill amount.');
    if (num(f.deductions) > num(f.amount)) return toast.error('Deductions cannot be more than the amount.');
    setBusy(true);
    try {
      await addBill(f);
      toast.success('Bill recorded; it goes for approval next');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add vendor bill</DialogTitle>
          <DialogDescription>The bill goes through the project-manager and accounts approvals, then it can be paid.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" required><FilterSelect value={f.vendor_id || NONE} onChange={(v) => setF({ ...f, vendor_id: unNone(v), po_id: '' })} options={opt(lk.vendors.filter((v) => v.status !== 'blacklisted'), 'Choose a vendor')} /></Field>
          <Field label="Bill number" required><Input value={f.bill_no} onChange={(e) => setF({ ...f, bill_no: e.target.value })} /></Field>
          <Field label="Bill date"><Input type="date" value={f.bill_date} onChange={(e) => setF({ ...f, bill_date: e.target.value })} /></Field>
          <Field label="Project"><FilterSelect value={f.project_id || NONE} onChange={(v) => setF({ ...f, project_id: unNone(v) })} options={opt(lk.projects, 'None')} /></Field>
          <Field label="Amount (₹)" required hint="Including GST"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Deductions (₹)" hint="Retention, TDS, penalties"><Input inputMode="decimal" value={f.deductions} onChange={(e) => setF({ ...f, deductions: e.target.value })} /></Field>
          {vendorOrders.length > 0 && (
            <Field label="Purchase order" className="sm:col-span-2">
              <FilterSelect value={f.po_id || NONE} onChange={(v) => setF({ ...f, po_id: unNone(v) })}
                options={[[NONE, 'Not against an order'], ...vendorOrders.map((o) => [o.id, `${o.po_no} · ${fmtDate(o.po_date)}`] as [string, string])]} />
            </Field>
          )}
          <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <p className="text-sm">Net payable: <span className="tabular font-semibold">{fmtINR(num(f.amount) - num(f.deductions))}</span></p>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Add bill</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================== bank & cash
export function BanksPage() {
  const can = useCan('acc.banks');
  const canTxn = useCan('acc.transactions');
  const accounts = useAccounts();
  const balances = useBalances();
  const refresh = useAccRefresh();
  const [editing, setEditing] = useState<AccAccount | 'new' | null>(null);
  const [statement, setStatement] = useState<AccAccount | null>(null);
  const [removing, setRemoving] = useState<AccAccount | null>(null);
  const [txn, setTxn] = useState<TxnDialog>(null);
  const bal = (id: string) => balances.data?.find((b) => b.account_id === id);
  const total = (balances.data ?? []).filter((b) => b.is_active).reduce((s, b) => s + num(b.balance), 0);
  const list = accounts.data ?? [];

  async function remove(a: AccAccount) {
    try { await removeRecord('acc_accounts', a.id); toast.success('Account deleted'); await refresh(); } catch (e) { toast.error(errorMessage(e)); }
    setRemoving(null);
  }

  return (
    <>
      <PageHeader icon={Landmark} title="Bank & Cash"
        description="Bank accounts, cash, UPI and cards: opening balance, money in and out, and the balance today."
        actions={(
          <>
            {canTxn.create && list.length > 1 && <Button variant="outline" onClick={() => setTxn({ initial: blankTxn('transfer') })}><ArrowLeftRight /> Transfer</Button>}
            {can.create && <Button onClick={() => setEditing('new')}><Plus /> Add account</Button>}
          </>
        )} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total balance" value={fmtINR(total, true)} hint="Active accounts" icon={Landmark} tone={total < 0 ? 'red' : 'green'} />
        <StatCard label="In banks" value={fmtINR((balances.data ?? []).filter((b) => b.is_active && b.kind === 'bank').reduce((s, b) => s + num(b.balance), 0), true)} icon={Landmark} tone="blue" />
        <StatCard label="Cash" value={fmtINR((balances.data ?? []).filter((b) => b.is_active && b.kind === 'cash').reduce((s, b) => s + num(b.balance), 0), true)} icon={Wallet} tone="amber" />
        <StatCard label="Accounts" value={fmtNumber(list.filter((a) => a.is_active).length)} hint={`${list.filter((a) => !a.is_active).length} inactive`} icon={Wallet} tone="slate" />
      </div>
      {accounts.isLoading ? <Skeleton className="h-60 rounded-xl" /> : accounts.error ? (
        <Card><ErrorState message={errorMessage(accounts.error)} onRetry={() => accounts.refetch()} /></Card>
      ) : !list.length ? (
        <Card><EmptyState icon={Landmark} title="No accounts" description="Add your bank accounts and cash so money in and out can be recorded." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const b = bal(a.id);
            return (
              <Card key={a.id} className={cn('flex flex-col p-4', !a.is_active && 'opacity-70')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[ACCOUNT_KINDS[a.kind], a.bank_name, a.account_no && `A/c ••${a.account_no.slice(-4)}`, a.ifsc].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {!a.is_active && <Badge variant="secondary">Inactive</Badge>}
                </div>
                <p className={cn('tabular mt-3 text-2xl font-semibold tracking-tight', num(b?.balance) < 0 && 'text-red-700')}>{fmtINR(b?.balance ?? a.opening_balance)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Opening {fmtINR(a.opening_balance)} on {fmtDate(a.opening_date)} · <span className="text-emerald-700">in {fmtINR(b?.money_in ?? 0, true)}</span> · <span className="text-red-700">out {fmtINR(b?.money_out ?? 0, true)}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => setStatement(a)}>Statement</Button>
                  {can.edit && <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil /> Edit</Button>}
                  {can.delete && !num(b?.money_in) && !num(b?.money_out) && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoving(a)}><Trash2 /> Delete</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {statement && <Statement account={statement} onClose={() => setStatement(null)} />}
      {txn && <TxnForm initial={txn.initial} onClose={() => setTxn(null)} onSaved={refresh} />}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} destructive confirmLabel="Delete"
        title={`Delete ${removing?.name}?`} description="Only an account with no money in or out can be deleted. Otherwise mark it inactive."
        onConfirm={() => removing && void remove(removing)} />
    </>
  );
}

function AccountForm({ account, onClose, onSaved }: { account: AccAccount | null; onClose: () => void; onSaved: () => unknown }) {
  const [f, setF] = useState({
    name: account?.name ?? '', kind: account?.kind ?? 'bank', bank_name: account?.bank_name ?? '', account_no: account?.account_no ?? '',
    ifsc: account?.ifsc ?? '', branch: account?.branch ?? '', opening_balance: account ? String(account.opening_balance) : '',
    opening_date: account?.opening_date ?? todayIST(), is_active: account?.is_active ?? true, notes: account?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (f.name.trim().length < 2) return toast.error('Give the account a name.');
    setBusy(true);
    try {
      await saveAccount({ ...f, opening_balance: num(f.opening_balance) }, account?.id ?? null);
      toast.success(account ? 'Account saved' : 'Account added');
      await onSaved();
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const bank = f.kind === 'bank';
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{account ? `Edit ${account.name}` : 'Add bank or cash account'}</DialogTitle>
          <DialogDescription>The opening balance is what the account held on the opening date.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required><Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. HDFC Current, Site cash Bassi" /></Field>
          <Field label="Type"><FilterSelect value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={Object.entries(ACCOUNT_KINDS)} /></Field>
          {bank && <Field label="Bank"><Input value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} placeholder="HDFC Bank" /></Field>}
          {(bank || f.kind === 'card' || f.kind === 'upi') && (
            <Field label={f.kind === 'upi' ? 'UPI ID / number' : f.kind === 'card' ? 'Card (last digits)' : 'Account number'}>
              <Input value={f.account_no} onChange={(e) => setF({ ...f, account_no: e.target.value })} />
            </Field>
          )}
          {bank && <Field label="IFSC"><Input value={f.ifsc} maxLength={11} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>}
          {bank && <Field label="Branch"><Input value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} /></Field>}
          <Field label="Opening balance (₹)"><Input inputMode="decimal" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} placeholder="0" /></Field>
          <Field label="Opening date"><Input type="date" value={f.opening_date} onChange={(e) => setF({ ...f, opening_date: e.target.value })} /></Field>
          <Field label="Status"><FilterSelect value={f.is_active ? 'active' : 'inactive'} onChange={(v) => setF({ ...f, is_active: v === 'active' })} options={[['active', 'Active'], ['inactive', 'Inactive (closed)']]} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every entry through one account, oldest first, with the running balance. */
function Statement({ account, onClose }: { account: AccAccount; onClose: () => void }) {
  const txns = useTxns();
  const can = useCan('acc.banks');
  const lk = useAccLookups();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const lines = useMemo(() => {
    let run = num(account.opening_balance);
    return (txns.data ?? [])
      .filter((t) => t.account_id === account.id || t.to_account_id === account.id)
      .sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at))
      .map((t) => {
        const isIn = t.kind === 'income' || (t.kind === 'transfer' && t.to_account_id === account.id);
        const amt = num(t.amount);
        run += isIn ? amt : -amt;
        return { t, isIn, amt, run };
      });
  }, [txns.data, account]);
  const before = lines.filter((l) => from && l.t.txn_date < from);
  const opening = before.length ? before[before.length - 1].run : num(account.opening_balance);
  const shown = lines.filter((l) => (!from || l.t.txn_date >= from) && (!to || l.t.txn_date <= to));
  const label = (t: Txn) => (t.kind === 'transfer'
    ? (t.to_account_id === account.id ? `From ${lk.accountName(t.account_id)}` : `To ${lk.accountName(t.to_account_id)}`)
    : [t.party, t.category].filter(Boolean).join(' · ') || t.txn_no);

  async function onExport() {
    await exportXlsx('acc.banks', `statement-${account.name.replace(/\W+/g, '-')}-${todayIST()}.xlsx`, shown, [
      { header: 'Date', value: (l) => l.t.txn_date, width: 12 },
      { header: 'Entry', value: (l) => l.t.txn_no, width: 12 },
      { header: 'Particulars', value: (l) => label(l.t), width: 34 },
      { header: 'Reference', value: (l) => l.t.reference, width: 16 },
      { header: 'Money in', value: (l) => (l.isIn ? l.amt : null), numFmt: '#,##0.00', width: 14 },
      { header: 'Money out', value: (l) => (l.isIn ? null : l.amt), numFmt: '#,##0.00', width: 14 },
      { header: 'Balance', value: (l) => l.run, numFmt: '#,##0.00', width: 16 },
    ], { sheet: 'Statement', title: [`${account.name} statement`, dateRange(from, to), `Opening balance ${fmtINR(opening)}`] });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account.name} · statement</DialogTitle>
          <DialogDescription>Every entry through this account, with the balance after each one.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <span className="ml-auto text-sm">Opening <span className="tabular font-medium">{fmtINR(opening)}</span></span>
          {can.export && <Button size="sm" variant="outline" disabled={!shown.length} onClick={() => void onExport()}><Download /> Excel</Button>}
        </div>
        {txns.isLoading ? <Skeleton className="h-40" /> : !shown.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No entries in this period.</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Particulars</TableHead><TableHead className="text-right">In</TableHead>
              <TableHead className="text-right">Out</TableHead><TableHead className="text-right">Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map(({ t, isIn, amt, run }) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(t.txn_date)}<div className="text-xs text-muted-foreground">{t.txn_no}</div></TableCell>
                  <TableCell className="max-w-[18rem]"><div className="truncate">{label(t)}</div><div className="truncate text-xs text-muted-foreground">{t.reference}</div></TableCell>
                  <TableCell className="tabular text-right text-emerald-700">{isIn ? fmtINR(amt) : ''}</TableCell>
                  <TableCell className="tabular text-right text-red-700">{isIn ? '' : fmtINR(amt)}</TableCell>
                  <TableCell className={cn('tabular text-right font-medium', run < 0 && 'text-red-700')}>{fmtINR(run)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
