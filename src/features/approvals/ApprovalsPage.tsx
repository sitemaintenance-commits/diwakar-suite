// Approvals — any employee asks the company for something (a purchase, a
// payment, an advance, travel, time off, equipment); the approvers decide;
// the employee follows it to the decision.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BadgeCheck, CheckCircle2, Download, FileText, Loader2, MessageSquareWarning, Paperclip, Pencil, Plus, Send, XCircle,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtDateTime, fmtINR, fmtNumber, todayIST } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, SearchInput, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { downloadDocument, uploadDocument, useDocuments } from '@/features/crm/api';
import {
  CATEGORIES, EVENT_LABEL, STATUS, cancelRequest, decide, saveRequest, useApprovals,
  type ApprovalRequest, type ApprovalView, type RequestInput,
} from '@/features/approvals/api';

const ALL = '__all__';
const MAX_FILE = 25 * 1024 * 1024;

export function ApprovalsPage() {
  const can = useCan('approvals');
  const qc = useQueryClient();
  const [view, setView] = useState<ApprovalView | null>(null);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ApprovalRequest | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Approvers start on what is waiting for them; everyone else on their own requests.
  const probe = useApprovals('to_approve', null, '');
  const approver = probe.data?.approver ?? false;
  const current: ApprovalView = view ?? (approver ? 'to_approve' : 'mine');
  const list = useApprovals(current, status === ALL ? null : status, search);
  const rows = list.data?.rows ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['approvals'] });

  async function onExport() {
    try {
      await exportXlsx('approvals', `approvals-${todayIST()}`, rows, [
        { header: 'Request', value: (r) => r.request_no, width: 11 },
        { header: 'Date', value: (r) => fmtDate(r.created_at), width: 12 },
        { header: 'Requested by', value: (r) => r.requested_by, width: 22 },
        { header: 'Department', value: (r) => r.department ?? '', width: 20 },
        { header: 'Type', value: (r) => CATEGORIES[r.category] ?? r.category, width: 20 },
        { header: 'Title', value: (r) => r.title, width: 40 },
        { header: 'Details', value: (r) => r.details ?? '', width: 50 },
        { header: 'Amount (₹)', value: (r) => (r.amount == null ? '' : Number(r.amount)), numFmt: '#,##0.00', width: 13 },
        { header: 'Needed by', value: (r) => (r.needed_by ? fmtDate(r.needed_by) : ''), width: 12 },
        { header: 'Priority', value: (r) => (r.priority === 'urgent' ? 'Urgent' : 'Normal'), width: 9 },
        { header: 'Status', value: (r) => STATUS[r.status].label, width: 20 },
        { header: 'Decided by', value: (r) => r.decided_by ?? '', width: 20 },
        { header: 'Note', value: (r) => r.decision_note ?? '', width: 40 },
      ], { sheet: 'Approvals', title: ['APPROVAL REQUESTS', fmtDate(todayIST())] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={BadgeCheck}
        title="Approvals"
        description={approver
          ? 'Requests from the team — purchases, payments, advances, travel, time off — waiting for your decision.'
          : 'Ask the company for a purchase, a payment, an advance, travel or time off, and follow it to the decision.'}
        actions={
          <>
            {can.export && approver && (
              <Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export</Button>
            )}
            {can.create && <Button onClick={() => setEditing('new')}><Plus /> New request</Button>}
          </>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <Tabs value={current} onValueChange={(v) => setView(v as ApprovalView)}>
            <TabsList>
              {approver && (
                <TabsTrigger value="to_approve">
                  Waiting for you{probe.data?.waiting ? ` (${fmtNumber(probe.data.waiting)})` : ''}
                </TabsTrigger>
              )}
              <TabsTrigger value="mine">My requests</TabsTrigger>
              {approver && <TabsTrigger value="all">All requests</TabsTrigger>}
            </TabsList>
          </Tabs>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <SearchInput value={search} onChange={setSearch} placeholder="Search title, number, person…" />
            {current !== 'to_approve' && (
              <div className="sm:w-52">
                <FilterSelect value={status} onChange={setStatus}
                  options={[[ALL, 'Any status'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label] as [string, string])]} />
              </div>
            )}
          </div>
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={4} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={BadgeCheck}
            title={current === 'to_approve' ? 'Nothing waiting for you' : current === 'mine' ? 'You have not raised a request yet' : 'No requests'}
            description={current === 'mine' && can.create ? 'Use “New request” to ask for a purchase, a payment, an advance, travel or time off.' : undefined}
          />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs tabular text-muted-foreground">{r.request_no}</span>
                      <span className="truncate font-medium">{r.title}</span>
                      {r.priority === 'urgent' && <Badge variant="destructive">Urgent</Badge>}
                      {r.attachments > 0 && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORIES[r.category] ?? r.category}
                      {!r.mine && ` · ${r.requested_by}${r.department ? ` (${r.department})` : ''}`}
                      {` · ${fmtDate(r.created_at)}`}
                      {r.needed_by && ` · needed by ${fmtDate(r.needed_by)}`}
                    </p>
                  </div>
                  {r.amount != null && <span className="tabular text-sm font-medium">{fmtINR(r.amount)}</span>}
                  <Badge variant={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RequestForm request={editing} onClose={() => setEditing(null)} onSaved={async (id) => { await refresh(); setOpenId(id); }} />
      <RequestDetail request={open} onClose={() => setOpenId(null)} onEdit={(r) => { setOpenId(null); setEditing(r); }} onChanged={refresh} />
    </>
  );
}

// ----------------------------------------------------------- new / edit
function RequestForm({ request, onClose, onSaved }: {
  request: ApprovalRequest | 'new' | null;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const existing = request && request !== 'new' ? request : null;
  const blank: RequestInput = { category: 'purchase', title: '', details: '', amount: '', needed_by: '', priority: 'normal', note: '' };
  const [f, setF] = useState<RequestInput>(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = request === 'new' ? 'new' : existing?.id ?? null;
  if (key && key !== loadedFor) {
    setLoadedFor(key);
    setFiles([]);
    setF(existing ? {
      category: existing.category, title: existing.title, details: existing.details ?? '',
      amount: existing.amount == null ? '' : String(existing.amount), needed_by: existing.needed_by ?? '',
      priority: existing.priority, note: '',
    } : blank);
  }
  const set = <K extends keyof RequestInput>(k: K, v: RequestInput[K]) => setF((s) => ({ ...s, [k]: v }));
  const close = () => { if (!busy) { setLoadedFor(null); onClose(); } };

  async function submit() {
    if (f.title.trim().length < 3) return toast.error('Give the request a short title.');
    if (f.amount && Number.isNaN(Number(f.amount.replace(/[,\s₹]/g, '')))) return toast.error('The amount should be a number.');
    setBusy(true);
    try {
      const id = await saveRequest(f, existing?.id);
      for (const file of files) {
        await uploadDocument({ moduleKey: 'approvals', entityType: 'approval', entityId: id, file, category: 'Attachment' });
      }
      toast.success(existing ? (existing.status === 'needs_info' ? 'Request resubmitted' : 'Request updated') : 'Request sent for approval');
      setLoadedFor(null);
      onClose();
      await onSaved(id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? (existing.status === 'needs_info' ? 'Update and resubmit' : 'Edit request') : 'New request'}</DialogTitle>
          <DialogDescription>
            {existing?.status === 'needs_info' && existing.decision_note
              ? `Asked: ${existing.decision_note}`
              : 'It goes to the approvers; you will see their decision here.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" required>
            <FilterSelect value={f.category} onChange={(v) => set('category', v)}
              options={Object.entries(CATEGORIES).map(([k, v]) => [k, v] as [string, string])} />
          </Field>
          <Field label="Priority">
            <FilterSelect value={f.priority} onChange={(v) => set('priority', v as RequestInput['priority'])}
              options={[['normal', 'Normal'], ['urgent', 'Urgent']]} />
          </Field>
          <Field label="What do you need?" required className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. 2 padlocks for the Sadas store" maxLength={200} />
          </Field>
          <Field label="Details" className="sm:col-span-2" hint="Why it is needed, where, quantities, vendor.">
            <Textarea rows={4} value={f.details} onChange={(e) => set('details', e.target.value)} />
          </Field>
          <Field label="Amount (₹)" hint="If there is a cost.">
            <Input inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" />
          </Field>
          <Field label="Needed by">
            <Input type="date" value={f.needed_by} min={todayIST()} onChange={(e) => set('needed_by', e.target.value)} />
          </Field>
          {existing?.status === 'needs_info' && (
            <Field label="Your reply to the approver" className="sm:col-span-2">
              <Input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Quotation attached" />
            </Field>
          )}
          <Field label="Attachments" className="sm:col-span-2" hint="Quotation, bill, photo — up to 25 MB each.">
            <input type="file" multiple className="text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                const big = picked.filter((x) => x.size > MAX_FILE);
                if (big.length) toast.error(`Larger than 25 MB: ${big.map((x) => x.name).join(', ')}`);
                setFiles(picked.filter((x) => x.size <= MAX_FILE));
              }} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {existing ? (existing.status === 'needs_info' ? 'Resubmit' : 'Save') : 'Send for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- detail
function RequestDetail({ request, onClose, onEdit, onChanged }: {
  request: ApprovalRequest | null;
  onClose: () => void;
  onEdit: (r: ApprovalRequest) => void;
  onChanged: () => Promise<void>;
}) {
  const docs = useDocuments('approval', request?.id);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function act(decision: 'approved' | 'rejected' | 'needs_info') {
    if (!request) return;
    if (decision !== 'approved' && !note.trim()) return toast.error('Write a note: the employee needs to know why.');
    setBusy(decision);
    try {
      await decide(request.id, decision, note);
      toast.success(decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Sent back for more info');
      setNote('');
      await onChanged();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function attach(files: FileList | null) {
    if (!request || !files?.length) return;
    setBusy('attach');
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE) { toast.error(`${file.name} is larger than 25 MB.`); continue; }
        await uploadDocument({ moduleKey: 'approvals', entityType: 'approval', entityId: request.id, file, category: 'Attachment' });
      }
      await qc.invalidateQueries({ queryKey: ['documents', 'approval', request.id] });
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!request) return null;
  const r = request;
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{r.title}</span>
              <Badge variant={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              {r.priority === 'urgent' && <Badge variant="destructive">Urgent</Badge>}
            </DialogTitle>
            <DialogDescription>
              {r.request_no} · {CATEGORIES[r.category] ?? r.category} · {r.requested_by}
              {r.employee_code ? ` (${r.employee_code})` : ''}{r.department ? ` · ${r.department}` : ''} · {fmtDateTime(r.created_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div><div className="text-xs text-muted-foreground">Amount</div><div className="font-medium">{r.amount == null ? '—' : fmtINR(r.amount)}</div></div>
              <div><div className="text-xs text-muted-foreground">Needed by</div><div className="font-medium">{r.needed_by ? fmtDate(r.needed_by) : '—'}</div></div>
              {r.decided_by && (
                <div><div className="text-xs text-muted-foreground">{r.status === 'approved' ? 'Approved by' : 'Decided by'}</div>
                  <div className="font-medium">{r.decided_by}</div></div>
              )}
            </div>
            {r.details && <p className="whitespace-pre-wrap">{r.details}</p>}
            {r.decision_note && (
              <div className={`rounded-lg px-3 py-2 ${r.status === 'rejected' ? 'bg-red-50 text-red-900' : r.status === 'approved' ? 'bg-green-50 text-green-900' : 'bg-sky-50 text-sky-900'}`}>
                <span className="font-medium">{r.status === 'needs_info' ? 'Asked: ' : 'Note: '}</span>{r.decision_note}
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments</span>
                {r.can_edit && (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy === 'attach'} onClick={() => fileRef.current?.click()}>
                      {busy === 'attach' ? <Loader2 className="animate-spin" /> : <Paperclip />} Add file
                    </Button>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
                  </>
                )}
              </div>
              {docs.data?.length ? (
                <ul className="divide-y rounded-lg border">
                  {docs.data.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{d.file_name}</span>
                      <Button size="icon-sm" variant="ghost" aria-label="Download"
                        onClick={() => void downloadDocument(d).catch((e) => toast.error(errorMessage(e)))}><Download /></Button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground">None.</p>}
            </div>

            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</span>
              <ol className="mt-1 grid gap-1.5 border-l pl-3">
                {r.events.map((e, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</span>
                    {e.by && ` · ${e.by}`} · <span className="text-muted-foreground">{fmtDateTime(e.at)}</span>
                    {e.note && <div className="text-muted-foreground">“{e.note}”</div>}
                  </li>
                ))}
              </ol>
            </div>

            {r.can_decide && (
              <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
                <Field label="Your note" hint="Needed to reject or send back; optional when approving.">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!!busy} onClick={() => void act('approved')} className="bg-green-600 hover:bg-green-700">
                    {busy === 'approved' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => void act('needs_info')}>
                    {busy === 'needs_info' ? <Loader2 className="animate-spin" /> : <MessageSquareWarning />} Ask for more info
                  </Button>
                  <Button variant="outline" className="text-destructive" disabled={!!busy} onClick={() => void act('rejected')}>
                    {busy === 'rejected' ? <Loader2 className="animate-spin" /> : <XCircle />} Reject
                  </Button>
                </div>
              </div>
            )}
          </div>

          {r.can_edit && (
            <DialogFooter>
              <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>Withdraw request</Button>
              <Button onClick={() => onEdit(r)}><Pencil /> {r.status === 'needs_info' ? 'Update and resubmit' : 'Edit'}</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Withdraw this request?"
        description="It will be marked cancelled. You can raise a new one later."
        confirmLabel="Withdraw"
        destructive
        onConfirm={async () => {
          try {
            await cancelRequest(r.id);
            toast.success('Request withdrawn');
            await onChanged();
            onClose();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
