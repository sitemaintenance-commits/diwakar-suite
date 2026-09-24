// Shared CRM building blocks: status vocabulary, deadline display,
// document and follow-up panels used by tender and lead pages.
import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Download, FileText, Loader2, Paperclip, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import type {
  DocumentRow,
  EmdStatus,
  FollowUp,
  FollowUpEntity,
  FollowUpStatus,
  LeadStatus,
  QuotationStatus,
  TenderStatus,
} from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog, EmptyState, Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { deleteDocument, downloadDocument, uploadDocument, useDocuments, useFollowUps } from '@/features/crm/api';

// ---------------------------------------------------------------- vocabulary
export const TENDER_STATUS: Record<TenderStatus, { label: string; tone: BadgeProps['variant'] }> = {
  identified: { label: 'Identified', tone: 'secondary' },
  evaluating: { label: 'Go / No-go review', tone: 'info' },
  preparing: { label: 'Preparing bid', tone: 'warning' },
  submitted: { label: 'Submitted', tone: 'default' },
  technical_qualified: { label: 'Technically qualified', tone: 'info' },
  technical_disqualified: { label: 'Disqualified', tone: 'destructive' },
  financial_opened: { label: 'Financial opened', tone: 'default' },
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'destructive' },
  cancelled: { label: 'Cancelled / retendered', tone: 'secondary' },
};

export const EMD_STATUS: Record<EmdStatus, { label: string; tone: BadgeProps['variant'] }> = {
  not_required: { label: 'Not required', tone: 'secondary' },
  pending: { label: 'To be paid', tone: 'warning' },
  submitted: { label: 'Paid / blocked', tone: 'info' },
  refund_requested: { label: 'Refund requested', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'success' },
  forfeited: { label: 'Forfeited', tone: 'destructive' },
};

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: BadgeProps['variant'] }> = {
  new: { label: 'New', tone: 'secondary' },
  contacted: { label: 'Contacted', tone: 'info' },
  interested: { label: 'Interested', tone: 'warning' },
  quoted: { label: 'Quoted', tone: 'default' },
  converted: { label: 'Converted', tone: 'success' },
  lost: { label: 'Lost', tone: 'destructive' },
};

export const QUOTATION_STATUS: Record<QuotationStatus, { label: string; tone: BadgeProps['variant'] }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  sent: { label: 'Sent', tone: 'info' },
  under_discussion: { label: 'Under discussion', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  expired: { label: 'Expired', tone: 'secondary' },
};

export const FOLLOWUP_STATUS: Record<FollowUpStatus, { label: string; tone: BadgeProps['variant'] }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  done: { label: 'Done', tone: 'success' },
  missed: { label: 'Missed', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export const TENDER_TYPES = ['open', 'limited', 'gem', 'eoi', 'rfp', 'rfq', 'single'];
export const TENDER_TYPE_LABEL: Record<string, string> = {
  open: 'Open tender',
  limited: 'Limited tender',
  gem: 'GeM bid',
  eoi: 'EOI',
  rfp: 'RFP',
  rfq: 'RFQ',
  single: 'Single / nomination',
};
export const WORK_TYPES = [
  'Rooftop solar',
  'Ground mount',
  'Solar pump',
  'Solar street light',
  'O&M contract',
  'Supply only',
  'EPC',
  'Other',
];
export const PORTALS = ['GeM', 'CPPP (eprocure.gov.in)', 'Rajasthan eProc', 'IREPS', 'Authority website', 'Offline'];
export const EMD_MODES = ['Online / NEFT', 'Bank guarantee', 'DD', 'FDR', 'Exempt (MSME/NSIC)'];
export const FOLLOWUP_TYPES = ['call', 'visit', 'email', 'portal', 'meeting', 'pre-bid'];

export function StatusChip({ map, value }: { map: Record<string, { label: string; tone: BadgeProps['variant'] }>; value: string }) {
  const s = map[value] ?? { label: value, tone: 'secondary' as const };
  return <Badge variant={s.tone}>{s.label}</Badge>;
}

/** Deadline with urgency colouring — the number that matters in bidding. */
export function Deadline({ at, done }: { at: string | null; done?: boolean }) {
  if (!at) return <span className="text-muted-foreground">—</span>;
  const ms = new Date(at).getTime() - Date.now();
  const days = Math.ceil(ms / 864e5);
  const tone = done ? 'text-muted-foreground' : ms < 0 ? 'text-destructive' : days <= 3 ? 'text-amber-600' : 'text-foreground';
  const note = done ? '' : ms < 0 ? 'overdue' : days === 0 ? 'today' : `in ${fmtNumber(days)} day${days === 1 ? '' : 's'}`;
  return (
    <span className={cn('whitespace-nowrap', tone)}>
      {fmtDateTime(at)}
      {note && <span className="ml-1 text-xs">({note})</span>}
    </span>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children ?? '—'}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- documents
export function DocumentsPanel({
  moduleKey,
  entityType,
  entityId,
  siteId,
  categories,
}: {
  moduleKey: string;
  entityType: string;
  entityId: string;
  siteId?: string | null;
  categories: string[];
}) {
  const can = useCan(moduleKey);
  const qc = useQueryClient();
  const docs = useDocuments(entityType, entityId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(categories[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<DocumentRow | null>(null);

  async function onFile(file: File) {
    if (file.size > 25 * 1024 * 1024) return toast.error('File must be 25 MB or smaller.');
    setBusy(true);
    try {
      await uploadDocument({ moduleKey, entityType, entityId, file, category, siteId });
      toast.success(`${file.name} uploaded`);
      await qc.invalidateQueries({ queryKey: ['documents', entityType, entityId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {can.edit || can.create ? (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="w-52">
            <Field label="Document type">
              <FilterSelect value={category} onChange={setCategory} options={categories.map((c) => [c, c] as [string, string])} />
            </Field>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Upload file
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </div>
      ) : null}

      {docs.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {docs.data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {d.category ? `${d.category} · ` : ''}
                  {d.size_bytes ? `${fmtNumber(d.size_bytes / 1024)} KB · ` : ''}
                  {fmtDate(d.created_at)}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => void downloadDocument(d).catch((e) => toast.error(errorMessage(e)))} aria-label="Download">
                <Download />
              </Button>
              {can.delete && (
                <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setRemoving(d)} aria-label="Delete">
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Paperclip} title="No documents yet" description="Attach the NIT, BOQ, EMD receipt, technical bid or award letter." />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${removing?.file_name}?`}
        description="The file is removed from storage. This cannot be undone."
        confirmLabel="Delete file"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteDocument(removing);
            toast.success('Document deleted');
            await qc.invalidateQueries({ queryKey: ['documents', entityType, entityId] });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- follow-ups
export function FollowUpsPanel({ entityType, entityId }: { entityType: FollowUpEntity; entityId: string }) {
  const can = useCan('crm.followups');
  const qc = useQueryClient();
  const list = useFollowUps({
    search: '',
    status: 'all',
    entity: entityType,
    assignedTo: 'all',
    due: 'all',
    page: 0,
    pageSize: 50,
    tenderId: entityType === 'tender' ? entityId : undefined,
    leadId: entityType === 'lead' ? entityId : undefined,
  });
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<FollowUp | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['follow-ups'] });

  return (
    <div>
      {can.create && (
        <Button variant="outline" className="mb-4" onClick={() => setOpen(true)}>
          <Plus /> Schedule follow-up
        </Button>
      )}
      {list.data?.rows.length ? (
        <ol className="space-y-3">
          {list.data.rows.map((f) => (
            <li key={f.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{f.subject || f.type}</span>
                  <StatusChip map={FOLLOWUP_STATUS} value={f.status} />
                </div>
                <Deadline at={f.follow_up_at} done={f.status !== 'scheduled'} />
              </div>
              {f.notes && <p className="mt-2 text-sm text-muted-foreground">{f.notes}</p>}
              {f.outcome && <p className="mt-2 text-sm"><span className="text-muted-foreground">Outcome: </span>{f.outcome}</p>}
              {can.edit && f.status === 'scheduled' && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setDone(f)}>
                  Mark done
                </Button>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={CalendarClock} title="No follow-ups" description="Schedule the pre-bid meeting, clarification or result check." />
      )}

      <FollowUpDialog open={open} onOpenChange={setOpen} entityType={entityType} entityId={entityId} onSaved={refresh} />
      <CompleteFollowUpDialog followUp={done} onClose={() => setDone(null)} onSaved={refresh} />
    </div>
  );
}

export function FollowUpDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entityType: FollowUpEntity;
  entityId: string;
  onSaved: () => void;
}) {
  const [type, setType] = useState('call');
  const [subject, setSubject] = useState('');
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const payload: Record<string, unknown> = {
      entity_type: entityType,
      type,
      subject: subject.trim() || null,
      notes: notes.trim() || null,
      follow_up_at: when ? new Date(when).toISOString() : new Date().toISOString(),
      assigned_to: auth.user?.id ?? null,
    };
    payload[`${entityType}_id`] = entityId;
    const { error } = await supabase.from('follow_ups').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Follow-up scheduled');
    setSubject('');
    setNotes('');
    setWhen('');
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule follow-up</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Type">
            <FilterSelect value={type} onChange={setType} options={FOLLOWUP_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)] as [string, string])} />
          </Field>
          <Field label="Subject" htmlFor="fu_subject">
            <Input id="fu_subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Pre-bid meeting, EMD refund follow-up…" />
          </Field>
          <Field label="Date & time" htmlFor="fu_when" required>
            <Input id="fu_when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="fu_notes">
            <Textarea id="fu_notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !when}>
            {busy && <Loader2 className="animate-spin" />} Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteFollowUpDialog({ followUp, onClose, onSaved }: { followUp: FollowUp | null; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!followUp) return;
    setBusy(true);
    const { error } = await supabase.rpc('log_followup_done', {
      p_id: followUp.id,
      p_outcome: outcome.trim() || null,
      p_next: next ? new Date(next).toISOString() : null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Follow-up completed');
    setOutcome('');
    setNext('');
    onSaved();
    onClose();
  }

  return (
    <Dialog open={Boolean(followUp)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete follow-up</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="What happened?" htmlFor="fu_outcome">
            <Textarea id="fu_outcome" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus />
          </Field>
          <Field label="Next follow-up (optional)" htmlFor="fu_next">
            <Input id="fu_next" type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
