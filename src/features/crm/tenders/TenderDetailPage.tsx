import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Gavel,
  Loader2,
  MapPin,
  Pencil,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtDateTime, fmtINR, fmtNumber, safeNum, titleCase } from '@/lib/format';
import type { TenderStatus } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog, ErrorState, Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useTender } from '@/features/crm/api';
import {
  Deadline,
  DetailRow,
  DocumentsPanel,
  EMD_STATUS,
  FollowUpsPanel,
  StatusChip,
  TENDER_STATUS,
  TENDER_TYPE_LABEL,
} from '@/features/crm/shared';
import { TenderFormDialog } from '@/features/crm/tenders/TenderFormDialog';

const TENDER_DOC_TYPES = ['NIT / tender document', 'BOQ', 'Technical bid', 'Financial bid', 'EMD receipt', 'Corrigendum', 'LOA / work order', 'Other'];

export function TenderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useCan('crm.tenders');
  const { data: t, isLoading, error, refetch } = useTender(id);
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'go' | 'no_go' | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (error || !t) {
    return (
      <Card>
        <ErrorState message={error ? errorMessage(error) : 'This tender does not exist or you do not have access to it.'} onRetry={() => refetch()} />
      </Card>
    );
  }

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['tender'] });
    await qc.invalidateQueries({ queryKey: ['tenders'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  async function setStatus(status: TenderStatus) {
    const { error } = await supabase.from('tenders').update({ status }).eq('id', t!.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Marked as ${TENDER_STATUS[status].label.toLowerCase()}`);
    await refresh();
  }

  async function remove() {
    const { error } = await supabase.rpc('soft_delete_record', { p_table: 'tenders', p_id: t!.id });
    if (error) return toast.error(errorMessage(error));
    toast.success('Tender deleted');
    await refresh();
    navigate('/crm/tenders');
  }

  const stages: { key: TenderStatus; label: string }[] = [
    { key: 'identified', label: 'Identified' },
    { key: 'evaluating', label: 'Go / No-go' },
    { key: 'preparing', label: 'Preparing' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'financial_opened', label: 'Opened' },
    { key: t.status === 'lost' || t.status === 'technical_disqualified' ? 'lost' : 'won', label: t.status === 'lost' || t.status === 'technical_disqualified' ? 'Lost' : 'Won' },
  ];
  const order: TenderStatus[] = ['identified', 'evaluating', 'preparing', 'submitted', 'technical_qualified', 'financial_opened', 'won'];
  const currentIndex = order.indexOf(t.status);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/crm/tenders">
          <ArrowLeft /> All tenders
        </Link>
      </Button>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip map={TENDER_STATUS} value={t.status} />
            {t.bid_decision && (
              <Badge variant={t.bid_decision === 'go' ? 'success' : 'destructive'}>
                {t.bid_decision === 'go' ? 'Approved to bid' : 'No-go'}
              </Badge>
            )}
            {t.our_rank ? <Badge variant="outline">Rank L{t.our_rank}</Badge> : null}
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">{t.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.tender_code}
            {t.reference_no ? ` · ${t.reference_no}` : ''}
            {t.authority ? ` · ${t.authority}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.approve && !t.bid_decision && ['identified', 'evaluating'].includes(t.status) && (
            <>
              <Button variant="outline" onClick={() => setDecision('no_go')}>
                <ThumbsDown /> No-go
              </Button>
              <Button onClick={() => setDecision('go')}>
                <ThumbsUp /> Approve to bid
              </Button>
            </>
          )}
          {can.edit && t.status === 'preparing' && (
            <Button onClick={() => setStatus('submitted')}>
              <CheckCircle2 /> Mark submitted
            </Button>
          )}
          {can.edit && ['submitted', 'technical_qualified', 'financial_opened'].includes(t.status) && (
            <>
              <Button variant="outline" onClick={() => setStatus('lost')}>
                Mark lost
              </Button>
              <Button onClick={() => setStatus('won')}>
                <Trophy /> Mark won
              </Button>
            </>
          )}
          {can.edit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
          {can.delete && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Bid pipeline */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {stages.map((s, i) => {
            const isLost = ['lost', 'technical_disqualified', 'cancelled'].includes(t.status);
            const reached = isLost ? i <= 3 && currentIndex < 0 ? false : i <= Math.max(currentIndex, 0) : i <= currentIndex;
            const isLast = i === stages.length - 1;
            const done = isLast ? t.status === 'won' : reached;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    done
                      ? isLast && (t.status === 'lost' || t.status === 'technical_disqualified')
                        ? 'bg-red-50 text-red-700'
                        : 'bg-primary-soft text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {s.label}
                </span>
                {!isLast && <span className="text-slate-300">→</span>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="money">Fee & EMD</TabsTrigger>
              <TabsTrigger value="result">Bid & result</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="followups">Follow-ups</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <Card>
                <CardContent className="grid gap-x-8 p-5 sm:grid-cols-2">
                  <DetailRow label="Authority / department">{t.authority}</DetailRow>
                  <DetailRow label="Tender type">{TENDER_TYPE_LABEL[t.tender_type] ?? titleCase(t.tender_type)}</DetailRow>
                  <DetailRow label="Scope of work">{t.work_type}</DetailRow>
                  <DetailRow label="Capacity">{safeNum(t.capacity_kwp) ? fmtCapacity(t.capacity_kwp) : null}</DetailRow>
                  <DetailRow label="Estimated value">{fmtINR(t.estimated_value)}</DetailRow>
                  <DetailRow label="Location">{[t.location, t.district, t.state].filter(Boolean).join(', ') || null}</DetailRow>
                  <DetailRow label="Linked site">{t.sites?.name}</DetailRow>
                  <DetailRow label="Portal">
                    {t.portal_url ? (
                      <a href={t.portal_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {t.portal ?? 'Open portal'} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      t.portal
                    )}
                  </DetailRow>
                  {t.notes && (
                    <div className="sm:col-span-2">
                      <DetailRow label="Notes">
                        <span className="whitespace-pre-wrap font-normal">{t.notes}</span>
                      </DetailRow>
                    </div>
                  )}
                  {t.bid_decision_note && (
                    <div className="sm:col-span-2">
                      <DetailRow label="Go / No-go note">
                        <span className="whitespace-pre-wrap font-normal">{t.bid_decision_note}</span>
                      </DetailRow>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="money">
              <Card>
                <CardContent className="grid gap-x-8 p-5 sm:grid-cols-2">
                  <DetailRow label="Tender fee">
                    {fmtINR(t.tender_fee)} {t.tender_fee_paid ? <Badge variant="success">Paid</Badge> : <Badge variant="secondary">Unpaid</Badge>}
                  </DetailRow>
                  <DetailRow label="EMD amount">{fmtINR(t.emd_amount)}</DetailRow>
                  <DetailRow label="EMD status">
                    <StatusChip map={EMD_STATUS} value={t.emd_status} />
                  </DetailRow>
                  <DetailRow label="EMD mode">{t.emd_mode}</DetailRow>
                  <DetailRow label="EMD paid on">{t.emd_submitted_on ? fmtDate(t.emd_submitted_on) : null}</DetailRow>
                  <DetailRow label="EMD valid until">{t.emd_valid_until ? fmtDate(t.emd_valid_until) : null}</DetailRow>
                  <DetailRow label="EMD refunded on">{t.emd_refunded_on ? fmtDate(t.emd_refunded_on) : null}</DetailRow>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="result">
              <Card>
                <CardContent className="grid gap-x-8 p-5 sm:grid-cols-2">
                  <DetailRow label="Our bid value">{t.our_bid_value ? fmtINR(t.our_bid_value) : null}</DetailRow>
                  <DetailRow label="Our rank">{t.our_rank ? `L${t.our_rank}` : null}</DetailRow>
                  <DetailRow label="L1 value">{t.l1_value ? fmtINR(t.l1_value) : null}</DetailRow>
                  <DetailRow label="L1 bidder">{t.l1_bidder}</DetailRow>
                  <DetailRow label="Total bidders">{t.total_bidders != null ? fmtNumber(t.total_bidders) : null}</DetailRow>
                  <DetailRow label="Result declared">{t.result_declared_on ? fmtDate(t.result_declared_on) : null}</DetailRow>
                  <DetailRow label="Reason for loss">{t.lost_reason}</DetailRow>
                  <DetailRow label="LOA / LOI">{t.loa_no ? `${t.loa_no}${t.loa_date ? ` · ${fmtDate(t.loa_date)}` : ''}` : null}</DetailRow>
                  <DetailRow label="Work order">{t.work_order_no}</DetailRow>
                  <DetailRow label="Contract value">{t.contract_value ? fmtINR(t.contract_value) : null}</DetailRow>
                  <DetailRow label="Completion period">{t.completion_days ? `${fmtNumber(t.completion_days)} days` : null}</DetailRow>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card>
                <CardContent className="p-5">
                  <DocumentsPanel moduleKey="crm.tenders" entityType="tender" entityId={t.id} siteId={t.site_id} categories={TENDER_DOC_TYPES} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="followups">
              <Card>
                <CardContent className="p-5">
                  <FollowUpsPanel entityType="tender" entityId={t.id} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Side column */}
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 text-primary" /> Key dates
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y">
              <DetailRow label="Published">{t.published_on ? fmtDate(t.published_on) : null}</DetailRow>
              <DetailRow label="Pre-bid meeting">{t.prebid_at ? fmtDateTime(t.prebid_at) : null}</DetailRow>
              <DetailRow label="Clarifications due">{t.clarification_due ? fmtDate(t.clarification_due) : null}</DetailRow>
              <DetailRow label="Submission deadline">
                <Deadline at={t.submission_due_at} done={!['identified', 'evaluating', 'preparing'].includes(t.status)} />
              </DetailRow>
              <DetailRow label="Technical opening">{t.technical_opening_at ? fmtDateTime(t.technical_opening_at) : null}</DetailRow>
              <DetailRow label="Financial opening">{t.financial_opening_at ? fmtDateTime(t.financial_opening_at) : null}</DetailRow>
              <DetailRow label="Submitted at">{t.submitted_at ? fmtDateTime(t.submitted_at) : null}</DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="h-4 w-4 text-primary" /> Money at stake
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y">
              <DetailRow label="Estimated value">{fmtINR(t.estimated_value)}</DetailRow>
              <DetailRow label="EMD">
                {fmtINR(t.emd_amount)} · <StatusChip map={EMD_STATUS} value={t.emd_status} />
              </DetailRow>
              <DetailRow label="Tender fee">{fmtINR(t.tender_fee)}</DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-primary" /> Record
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-0 divide-y">
              <DetailRow label="Created">{fmtDateTime(t.created_at)}</DetailRow>
              <DetailRow label="Go / No-go decided">{t.bid_approved_at ? fmtDateTime(t.bid_approved_at) : null}</DetailRow>
              {t.sites?.name && (
                <DetailRow label="Site">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {t.sites.name}
                  </span>
                </DetailRow>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <TenderFormDialog open={editing} onOpenChange={setEditing} tender={t} />
      <DecisionDialog decision={decision} tenderId={t.id} onClose={() => setDecision(null)} onSaved={refresh} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${t.tender_code}?`}
        description="The tender is removed from the lists. Its history stays in the audit log."
        confirmLabel="Delete tender"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}

function DecisionDialog({
  decision,
  tenderId,
  onClose,
  onSaved,
}: {
  decision: 'go' | 'no_go' | null;
  tenderId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<TenderStatus>('preparing');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from('tenders')
      .update({
        bid_decision: decision,
        bid_decision_note: note.trim() || null,
        status: decision === 'go' ? status : 'cancelled',
      })
      .eq('id', tenderId);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(decision === 'go' ? 'Approved to bid' : 'Recorded as no-go');
    setNote('');
    await onSaved();
    onClose();
  }

  return (
    <Dialog open={Boolean(decision)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" />
            {decision === 'go' ? 'Approve this tender for bidding' : 'Record a no-go decision'}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Reason / conditions" htmlFor="d_note" hint="Recorded with your name and the time in the audit log.">
            <Textarea
              id="d_note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={decision === 'go' ? 'Eligibility met, margins acceptable…' : 'Turnover criteria not met, EMD too high…'}
              autoFocus
            />
          </Field>
          {decision === 'go' && (
            <Field label="Move tender to">
              <FilterSelect
                value={status}
                onChange={(v) => setStatus(v as TenderStatus)}
                options={[
                  ['preparing', 'Preparing bid'],
                  ['submitted', 'Submitted'],
                ]}
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} variant={decision === 'go' ? 'default' : 'destructive'}>
            {busy ? <Loader2 className="animate-spin" /> : <FileText />} Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
