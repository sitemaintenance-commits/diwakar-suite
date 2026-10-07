// One approval request: its details, the approval levels and how far it
// has got, the approver's decision buttons, the documents (with versions)
// and the full timeline. What the buttons allow comes from the database,
// which checks every action again.
import { useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Ban, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Download, Eye, FileText, History, Loader2,
  Lock, MessageSquare, Paperclip, Pencil, RotateCcw, Send, SkipForward, Trash2, Undo2, Upload, UserCog, XCircle,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtDateTime, fmtINR } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, Field, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { RequestForm } from '@/features/approvals/RequestForm';
import {
  ACTION_LABEL, FILE_ACCEPT, LEVEL_STATUS, PRIORITIES, STATUS, actOnStep, addComment, approvalKeys, cancelRequest, categoryLabel,
  completeRequest, deleteDocument, fileUrl, fmtSize, isImage, isPdf, reassignStep, reopenRequest, saveRequest, uploadApprovalFile,
  useApprovalDetail, useApprovalSettings,
  type ApprovalDetail, type ApprovalDocument, type ApprovalStep, type DocVersion, type TimelineEntry,
} from '@/features/approvals/api';

export function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApprovalDetail(id);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: approvalKeys.all });

  if (q.isLoading) return <Card><TableSkeleton rows={8} cols={3} /></Card>;
  if (q.error || !q.data) {
    return (
      <>
        <BackLink />
        <Card><ErrorState message={q.error ? errorMessage(q.error) : 'Request not found.'} onRetry={() => q.refetch()} /></Card>
      </>
    );
  }
  return <Detail d={q.data} refresh={refresh} />;
}

function BackLink() {
  return (
    <Link to="/approvals" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Approvals
    </Link>
  );
}

type Dialogs =
  | { kind: 'approve' | 'reject' | 'return' }
  | { kind: 'cancel' | 'reopen' | 'complete' | 'submit' }
  | { kind: 'delete-doc'; doc: ApprovalDocument }
  | { kind: 'reassign'; step: ApprovalStep }
  | null;

function Detail({ d, refresh }: { d: ApprovalDetail; refresh: () => Promise<void> }) {
  const r = d.request;
  const p = d.permissions;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [editing, setEditing] = useState(false);
  const steps = d.steps.filter((s) => s.round === r.round);
  const actStep = steps.find((s) => s.id === p.act_step_id) ?? null;
  const done = r.completed_levels ?? 0;
  const total = r.total_levels || steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  async function run(work: () => Promise<unknown>, success: string) {
    try {
      await work();
      toast.success(success);
      setDialog(null);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      await refresh(); // e.g. someone else acted first: show the current state
    }
  }

  return (
    <>
      <BackLink />

      {/* ---------------------------------------------------------- header */}
      <Card className="mb-4 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-sm font-semibold text-primary">{r.request_no}</span>
              <Badge variant={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>
              <Badge variant={PRIORITIES[r.priority]?.tone}>{PRIORITIES[r.priority]?.label} priority</Badge>
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{r.title}</h1>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
              <Meta label="Requester">{r.requester}{r.employee_code ? <span className="text-muted-foreground"> · {r.employee_code}</span> : null}</Meta>
              <Meta label="Department">{r.department ?? '—'}</Meta>
              <Meta label="Amount">{r.amount == null ? '—' : fmtINR(r.amount)}</Meta>
              <Meta label="Created">{fmtDateTime(r.created_at)}</Meta>
              <Meta label="Last updated">{fmtDateTime(r.updated_at)}</Meta>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {p.can_edit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
            {p.can_submit && (
              <Button onClick={() => (r.status === 'returned' ? setEditing(true) : setDialog({ kind: 'submit' }))}>
                <Send /> {r.status === 'returned' ? 'Update and resubmit' : 'Submit for approval'}
              </Button>
            )}
            {p.can_complete && <Button variant="outline" onClick={() => setDialog({ kind: 'complete' })}><CheckCircle2 /> Mark completed</Button>}
            {p.can_reopen && <Button variant="outline" onClick={() => setDialog({ kind: 'reopen' })}><RotateCcw /> Reopen</Button>}
            {p.can_cancel && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog({ kind: 'cancel' })}><Ban /> Cancel request</Button>
            )}
          </div>
        </div>
        {(r.status === 'returned' || r.status === 'rejected') && r.decision_note && (
          <div className={cn('mt-4 rounded-lg px-3 py-2 text-sm', r.status === 'rejected' ? 'bg-red-50 text-red-900' : 'bg-sky-50 text-sky-900')}>
            <span className="font-semibold">{r.status === 'rejected' ? 'Reason for rejection: ' : 'Changes asked for: '}</span>{r.decision_note}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------- approver decision */}
      {actStep && (
        <Card className="mb-4 border-primary/40 bg-primary-soft/40 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Waiting for your decision</p>
              <p className="text-sm text-muted-foreground">Level {actStep.level_no} of {total}: {actStep.name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="bg-green-600 hover:bg-green-700" onClick={() => setDialog({ kind: 'approve' })}><CheckCircle2 /> Approve</Button>
              <Button variant="outline" onClick={() => setDialog({ kind: 'return' })}><Undo2 /> Return for changes</Button>
              <Button variant="outline" className="text-destructive" onClick={() => setDialog({ kind: 'reject' })}><XCircle /> Reject</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          {/* ---------------------------------------------------- progress */}
          <Card className="p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">Approval progress</h2>
              <span className="text-sm text-muted-foreground">
                {total ? `${done} of ${total} level${total > 1 ? 's' : ''} completed · ${pct}%` : 'Not submitted yet'}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={cn('h-full rounded-full transition-all', r.status === 'rejected' ? 'bg-red-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
            </div>
            {r.workflow_name && <p className="mt-2 text-xs text-muted-foreground">Workflow: {r.workflow_name}{r.round > 1 ? ` · submission ${r.round}` : ''}</p>}
            {steps.length > 0 ? (
              <ol className="mt-4 grid gap-3">
                {steps.map((s) => (
                  <LevelRow key={s.id} s={s} canReassign={p.can_reassign && (s.status === 'pending' || s.status === 'locked')}
                    onReassign={() => setDialog({ kind: 'reassign', step: s })} />
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">The approval levels are set when the request is submitted.</p>
            )}
          </Card>

          {/* ----------------------------------------------------- details */}
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Request details</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Meta label="Type">{categoryLabel(r.category)}</Meta>
              <Meta label="Needed by">{r.needed_by ? fmtDate(r.needed_by) : '—'}</Meta>
              <Meta label="Project / site">{r.project ?? r.site ?? '—'}</Meta>
              <Meta label="Submitted">{r.submitted_at ? fmtDateTime(r.submitted_at) : '—'}</Meta>
              {r.decided_at && <Meta label={r.status === 'rejected' ? 'Rejected' : 'Approved'}>{fmtDateTime(r.decided_at)}</Meta>}
              {r.completed_at && <Meta label="Completed">{fmtDateTime(r.completed_at)}</Meta>}
            </dl>
            <div className="mt-4">
              <div className="text-xs font-medium text-muted-foreground">Details</div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{r.details || '—'}</p>
            </div>
          </Card>

          <DocumentsCard d={d} refresh={refresh} onDelete={(doc) => setDialog({ kind: 'delete-doc', doc })} />
        </div>

        <Timeline d={d} refresh={refresh} />
      </div>

      {/* ------------------------------------------------------- dialogs */}
      {dialog?.kind === 'approve' && actStep && (
        <ReasonDialog title={`Approve ${r.request_no}?`} confirmLabel="Approve" tone="approve"
          description={`You approve Level ${actStep.level_no} (${actStep.name}).${actStep.level_no < total ? ' It then goes to the next level.' : ' This is the final approval.'}`}
          label="Comment (optional)" onClose={() => setDialog(null)}
          onConfirm={(c) => run(() => actOnStep(actStep.id, 'approve', c), 'Approved')} />
      )}
      {dialog?.kind === 'reject' && actStep && (
        <ReasonDialog title={`Reject ${r.request_no}?`} confirmLabel="Reject" tone="destructive" required
          description="The request stops here and the requester is told why." label="Reason for rejection"
          onClose={() => setDialog(null)} onConfirm={(c) => run(() => actOnStep(actStep.id, 'reject', c), 'Rejected')} />
      )}
      {dialog?.kind === 'return' && actStep && (
        <ReasonDialog title={`Return ${r.request_no} for changes?`} confirmLabel="Return for changes" required
          description="The requester can edit and resubmit it; approval then starts again from Level 1." label="What needs to change"
          onClose={() => setDialog(null)} onConfirm={(c) => run(() => actOnStep(actStep.id, 'return', c), 'Returned for changes')} />
      )}
      {dialog?.kind === 'cancel' && (
        <ReasonDialog title={`Cancel ${r.request_no}?`} confirmLabel="Cancel request" tone="destructive" required={!p.is_requester}
          description="It stops and the approvers are told. Its history is kept." label={p.is_requester ? 'Reason (optional)' : 'Reason'}
          cancelLabel="Keep it" onClose={() => setDialog(null)} onConfirm={(c) => run(() => cancelRequest(r.id, c), 'Request cancelled')} />
      )}
      {dialog?.kind === 'reopen' && (
        <ReasonDialog title={`Reopen ${r.request_no}?`} confirmLabel="Reopen" required
          description="Approval starts again from Level 1, with the same levels." label="Reason"
          onClose={() => setDialog(null)} onConfirm={(c) => run(() => reopenRequest(r.id, c), 'Request reopened')} />
      )}
      {dialog?.kind === 'complete' && (
        <ReasonDialog title={`Mark ${r.request_no} completed?`} confirmLabel="Mark completed" tone="approve"
          description="Use this once the approved purchase, payment or trip has been done." label="Note (optional)"
          onClose={() => setDialog(null)} onConfirm={(c) => run(() => completeRequest(r.id, c), 'Marked completed')} />
      )}
      {dialog?.kind === 'submit' && (
        <ReasonDialog title={`Submit ${r.request_no} for approval?`} confirmLabel="Submit" noInput
          description="It goes to Level 1 of its approval workflow and can then only be edited until the first approval."
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => saveRequest(toInput(d), r.id, true), 'Request submitted for approval')} />
      )}
      {dialog?.kind === 'delete-doc' && (
        <ReasonDialog title={`Delete ${dialog.doc.file_name}?`} confirmLabel="Delete" tone="destructive"
          description="It is removed from the request. The deletion is recorded and the file kept for the record."
          label="Reason (optional)" onClose={() => setDialog(null)}
          onConfirm={(c) => run(() => deleteDocument(dialog.doc.id, c), 'Document deleted')} />
      )}
      {dialog?.kind === 'reassign' && (
        <ReassignDialog step={dialog.step} onClose={() => setDialog(null)}
          onConfirm={(target, reason) => run(() => reassignStep(dialog.step.id, target, reason), 'Approver changed')} />
      )}
      <RequestForm open={editing} request={r} onClose={() => setEditing(false)} onSaved={() => void refresh()} />
    </>
  );
}

const toInput = (d: ApprovalDetail) => ({
  category: d.request.category, priority: d.request.priority, title: d.request.title, details: d.request.details ?? '',
  amount: d.request.amount == null ? '' : String(d.request.amount), needed_by: d.request.needed_by ?? '',
  department_id: d.request.department_id ?? '', site_id: d.request.site_id ?? '', project_id: d.request.project_id ?? '',
});

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}

const LEVEL_ICON: Record<string, { icon: typeof Circle; className: string }> = {
  approved: { icon: CheckCircle2, className: 'bg-green-100 text-green-700' },
  rejected: { icon: XCircle, className: 'bg-red-100 text-red-700' },
  returned: { icon: Undo2, className: 'bg-sky-100 text-sky-700' },
  pending: { icon: Clock, className: 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' },
  locked: { icon: Lock, className: 'bg-slate-100 text-slate-500' },
  skipped: { icon: SkipForward, className: 'bg-slate-100 text-slate-500' },
  cancelled: { icon: Ban, className: 'bg-slate-100 text-slate-500' },
};

function LevelRow({ s, canReassign, onReassign }: { s: ApprovalStep; canReassign: boolean; onReassign: () => void }) {
  const look = LEVEL_ICON[s.status] ?? LEVEL_ICON.locked;
  const Icon = look.icon;
  return (
    <li className="flex gap-3 rounded-lg border p-3">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', look.className)}><Icon className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Level {s.level_no} · {s.name}</span>
          <Badge variant={LEVEL_STATUS[s.status]?.tone}>{LEVEL_STATUS[s.status]?.label ?? s.status}</Badge>
          {s.unassigned && <Badge variant="warning">Approver needed</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {s.approver ? (s.approver_type === 'role' ? `Anyone with the ${s.approver} role` : s.approver) : 'No approver set'}
        </p>
        {s.acted_at && s.status !== 'skipped' && (
          <p className="mt-1 text-xs text-muted-foreground">
            {LEVEL_STATUS[s.status]?.label} by <span className="font-medium text-foreground">{s.acted_by_name}</span> ({s.acted_role}) · {fmtDateTime(s.acted_at)}
          </p>
        )}
        {s.comment && <p className="mt-1 rounded bg-muted/60 px-2 py-1 text-xs">“{s.comment}”</p>}
      </div>
      {canReassign && (
        <Button size="sm" variant="ghost" onClick={onReassign} className="shrink-0"><UserCog /> Change</Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- documents
function DocumentsCard({ d, refresh, onDelete }: { d: ApprovalDetail; refresh: () => Promise<void>; onDelete: (doc: ApprovalDocument) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);
  const [versionFor, setVersionFor] = useState<ApprovalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const p = d.permissions;
  const live = d.documents.filter((x) => !x.deleted_at);
  const gone = d.documents.filter((x) => x.deleted_at);

  async function upload(files: FileList | null, doc?: ApprovalDocument) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) await uploadApprovalFile(d.request.id, file, { documentId: doc?.id });
      toast.success(doc ? 'New version uploaded' : files.length > 1 ? `${files.length} documents added` : 'Document added');
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setVersionFor(null);
    }
  }

  async function view(v: DocVersion) {
    try {
      const url = await fileUrl(v, false);
      if (isImage(v.file_name)) setPreview({ url, name: v.file_name });
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function download(v: DocVersion) {
    try {
      window.open(await fileUrl(v, true), '_blank', 'noopener');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Documents{live.length ? ` (${live.length})` : ''}</h2>
        {p.can_upload && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="animate-spin" /> : <Paperclip />} Add documents
            </Button>
            <input ref={fileRef} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
            <input ref={versionRef} type="file" accept={FILE_ACCEPT} className="hidden"
              onChange={(e) => { void upload(e.target.files, versionFor ?? undefined); e.target.value = ''; }} />
          </>
        )}
      </div>
      {!live.length && !gone.length ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No documents attached.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {[...live, ...gone].map((doc) => {
            const latest = doc.versions[0];
            const expanded = open === doc.id;
            return (
              <li key={doc.id} className={cn('px-3 py-2.5', doc.deleted_at && 'bg-muted/40')}>
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-sm font-medium', doc.deleted_at && 'line-through')}>{doc.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      v{doc.current_version} · {fmtSize(latest?.size_bytes)} · {latest?.uploaded_by_name ?? doc.uploaded_by_name} · {fmtDateTime(latest?.uploaded_at ?? doc.created_at)}
                      {doc.deleted_at && ` · deleted by ${doc.deleted_by_name ?? '—'} ${fmtDateTime(doc.deleted_at)}${doc.delete_reason ? ` (${doc.delete_reason})` : ''}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {latest && (isImage(latest.file_name) || isPdf(latest.file_name)) && (
                      <Button size="icon-sm" variant="ghost" aria-label="Preview" title="Preview" onClick={() => void view(latest)}><Eye /></Button>
                    )}
                    {latest && <Button size="icon-sm" variant="ghost" aria-label="Download" title="Download" onClick={() => void download(latest)}><Download /></Button>}
                    {p.can_upload && !doc.deleted_at && (
                      <Button size="icon-sm" variant="ghost" aria-label="Upload a new version" title="Upload a new version" disabled={busy}
                        onClick={() => { setVersionFor(doc); versionRef.current?.click(); }}><Upload /></Button>
                    )}
                    {doc.can_delete && (
                      <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Delete" title="Delete" onClick={() => onDelete(doc)}><Trash2 /></Button>
                    )}
                    {doc.versions.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setOpen(expanded ? null : doc.id)}>
                        {expanded ? <ChevronDown /> : <ChevronRight />} {doc.versions.length} versions
                      </Button>
                    )}
                  </div>
                </div>
                {expanded && (
                  <ul className="ml-6 mt-2 grid gap-1 border-l pl-3">
                    {doc.versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">v{v.version_no}</span>
                        <span className="truncate">{v.file_name}</span>
                        <span className="text-muted-foreground">{fmtSize(v.size_bytes)} · {v.uploaded_by_name} · {fmtDateTime(v.uploaded_at)}</span>
                        {v.note && <span className="text-muted-foreground">“{v.note}”</span>}
                        <Button size="icon-sm" variant="ghost" aria-label={`Download version ${v.version_no}`} onClick={() => void download(v)}><Download /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="truncate">{preview?.name}</DialogTitle></DialogHeader>
          {preview && <img src={preview.url} alt={preview.name} className="max-h-[70vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ------------------------------------------------------------------ timeline
const TIMELINE_LOOK: Record<string, { icon: typeof Circle; className: string }> = {
  approved: { icon: CheckCircle2, className: 'bg-green-100 text-green-700' },
  completed: { icon: CheckCircle2, className: 'bg-green-100 text-green-700' },
  rejected: { icon: XCircle, className: 'bg-red-100 text-red-700' },
  cancelled: { icon: Ban, className: 'bg-slate-100 text-slate-600' },
  returned: { icon: Undo2, className: 'bg-sky-100 text-sky-700' },
  submitted: { icon: Send, className: 'bg-orange-100 text-orange-700' },
  resubmitted: { icon: Send, className: 'bg-orange-100 text-orange-700' },
  reopened: { icon: RotateCcw, className: 'bg-orange-100 text-orange-700' },
  reassigned: { icon: UserCog, className: 'bg-violet-100 text-violet-700' },
  commented: { icon: MessageSquare, className: 'bg-slate-100 text-slate-600' },
  document_added: { icon: Paperclip, className: 'bg-slate-100 text-slate-600' },
  document_version: { icon: Upload, className: 'bg-slate-100 text-slate-600' },
  document_deleted: { icon: Trash2, className: 'bg-slate-100 text-slate-600' },
  level_skipped: { icon: SkipForward, className: 'bg-slate-100 text-slate-600' },
};

function timelineTitle(t: TimelineEntry) {
  const base = ACTION_LABEL[t.action] ?? t.action;
  if (t.level_no && ['approved', 'rejected', 'returned', 'level_skipped', 'reassigned'].includes(t.action)) return `${base} · Level ${t.level_no}`;
  return base;
}

function timelineExtra(t: TimelineEntry): string | null {
  const m = t.meta ?? {};
  if (t.action === 'reassigned') return `${String(m.from ?? '—')} → ${String(m.to ?? '—')}`;
  if (t.action.startsWith('document_')) return `${String(m.file_name ?? '')}${t.version_no ? ` (v${t.version_no})` : ''}`;
  if (t.action === 'edited' && m.changes && typeof m.changes === 'object') {
    return Object.entries(m.changes as Record<string, { from: unknown; to: unknown }>)
      .map(([k, v]) => `${k.replace('_', ' ')}: ${fmtValue(v.from)} → ${fmtValue(v.to)}`).join(' · ');
  }
  return null;
}
const fmtValue = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'string' && v.length > 40 ? `${v.slice(0, 40)}…` : String(v));

function Timeline({ d, refresh }: { d: ApprovalDetail; refresh: () => Promise<void> }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const items = [...d.timeline].reverse();

  async function post() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await addComment(d.request.id, comment);
      setComment('');
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-fit p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><History className="h-4 w-4" /> Timeline</h2>
      {d.request.status !== 'draft' && (
        <div className="mb-4 grid gap-2">
          <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" maxLength={4000} />
          <Button size="sm" variant="outline" className="justify-self-end" disabled={busy || !comment.trim()} onClick={() => void post()}>
            {busy ? <Loader2 className="animate-spin" /> : <MessageSquare />} Comment
          </Button>
        </div>
      )}
      <ol className="relative grid gap-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
        {items.map((t) => {
          const look = TIMELINE_LOOK[t.action] ?? { icon: Circle, className: 'bg-slate-100 text-slate-600' };
          const Icon = look.icon;
          const extra = timelineExtra(t);
          return (
            <li key={t.id} className="relative flex gap-3">
              <div className={cn('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card', look.className)}><Icon className="h-3.5 w-3.5" /></div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-medium">{timelineTitle(t)}</span>
                  {t.to_status && t.to_status !== t.from_status && STATUS[t.to_status as keyof typeof STATUS] && (
                    <Badge variant={STATUS[t.to_status as keyof typeof STATUS].tone}>{STATUS[t.to_status as keyof typeof STATUS].label}</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.actor_name ?? 'System'}{t.actor_role ? ` · ${t.actor_role}` : ''} · {fmtDateTime(t.created_at)}
                </div>
                {extra && <div className="mt-0.5 break-words text-xs text-muted-foreground">{extra}</div>}
                {t.comment && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm">{t.comment}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ------------------------------------------------------------------- dialogs
function ReasonDialog({ title, description, label = 'Comment', required, noInput, confirmLabel, cancelLabel = 'Cancel', tone, onConfirm, onClose }: {
  title: string;
  description: string;
  label?: string;
  required?: boolean;
  noInput?: boolean;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'approve' | 'destructive';
  onConfirm: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const missing = required && !text.trim();
  async function confirm() {
    if (missing) return toast.error(`${label} is required.`);
    setBusy(true);
    try {
      await onConfirm(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {!noInput && (
          <Field label={label} required={required}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </Field>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>{cancelLabel}</Button>
          <Button disabled={busy || missing}
            className={tone === 'approve' ? 'bg-green-600 hover:bg-green-700' : undefined}
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => void confirm()}>
            {busy && <Loader2 className="animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({ step, onClose, onConfirm }: {
  step: ApprovalStep;
  onClose: () => void;
  onConfirm: (target: { employee?: string | null; role?: string | null }, reason: string) => Promise<void>;
}) {
  const settings = useApprovalSettings();
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const options: [string, string][] = [
    ...(settings.data?.employees ?? []).map((e) => [`e:${e.id}`, `${e.name}${e.department ? ` · ${e.department}` : ''}${e.has_login ? '' : ' (no login)'}`] as [string, string]),
    ...(settings.data?.roles ?? []).map((r) => [`r:${r.id}`, `Role: ${r.name} (${r.members} ${r.members === 1 ? 'person' : 'people'})`] as [string, string]),
  ];
  async function confirm() {
    if (!target) return toast.error('Choose who approves this level.');
    setBusy(true);
    try {
      await onConfirm(target.startsWith('e:') ? { employee: target.slice(2) } : { role: target.slice(2) }, reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change the approver of Level {step.level_no}</DialogTitle>
          <DialogDescription>{step.name} · now {step.approver ?? 'nobody'}. The new approver is notified if the level is active.</DialogDescription>
        </DialogHeader>
        <Field label="New approver" required>
          {settings.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <FilterSelect value={target} onChange={setTarget} placeholder="Choose a person or a role" options={options} />
          )}
        </Field>
        <Field label="Reason">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. On leave this week" />
        </Field>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !target} onClick={() => void confirm()}>{busy && <Loader2 className="animate-spin" />} Change approver</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
