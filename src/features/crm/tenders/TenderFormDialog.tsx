import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import type { Tender } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople, useSites } from '@/features/admin/api';
import { EMD_MODES, EMD_STATUS, PORTALS, TENDER_STATUS, TENDER_TYPES, TENDER_TYPE_LABEL, WORK_TYPES } from '@/features/crm/shared';

const NONE = '__none__';
/** datetime-local needs "YYYY-MM-DDTHH:mm" in local time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const num = (v: string) => (v.trim() === '' ? null : Number(v));

type Form = Record<string, string>;

const EMPTY: Form = {
  title: '', reference_no: '', authority: '', portal: '', portal_url: '', tender_type: 'open', work_type: '',
  state: 'Rajasthan', district: '', location: '', site_id: '', capacity_kwp: '', estimated_value: '',
  tender_fee: '', emd_amount: '', emd_mode: '', emd_status: 'not_required', emd_submitted_on: '', emd_valid_until: '',
  emd_refunded_on: '', published_on: '', prebid_at: '', clarification_due: '', submission_due_at: '',
  technical_opening_at: '', financial_opening_at: '', status: 'identified', assigned_to: '', notes: '',
  our_bid_value: '', our_rank: '', l1_value: '', l1_bidder: '', total_bidders: '', result_declared_on: '',
  lost_reason: '', loa_no: '', loa_date: '', work_order_no: '', contract_value: '', completion_days: '',
};

function fromTender(t: Tender | null): Form {
  if (!t) return { ...EMPTY };
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    ...EMPTY,
    title: t.title, reference_no: s(t.reference_no), authority: s(t.authority), portal: s(t.portal),
    portal_url: s(t.portal_url), tender_type: t.tender_type, work_type: s(t.work_type), state: s(t.state),
    district: s(t.district), location: s(t.location), site_id: s(t.site_id), capacity_kwp: s(t.capacity_kwp),
    estimated_value: s(t.estimated_value), tender_fee: s(t.tender_fee), emd_amount: s(t.emd_amount),
    emd_mode: s(t.emd_mode), emd_status: t.emd_status, emd_submitted_on: s(t.emd_submitted_on),
    emd_valid_until: s(t.emd_valid_until), emd_refunded_on: s(t.emd_refunded_on), published_on: s(t.published_on),
    prebid_at: toLocalInput(t.prebid_at), clarification_due: s(t.clarification_due),
    submission_due_at: toLocalInput(t.submission_due_at), technical_opening_at: toLocalInput(t.technical_opening_at),
    financial_opening_at: toLocalInput(t.financial_opening_at), status: t.status, assigned_to: s(t.assigned_to),
    notes: s(t.notes), our_bid_value: s(t.our_bid_value), our_rank: s(t.our_rank), l1_value: s(t.l1_value),
    l1_bidder: s(t.l1_bidder), total_bidders: s(t.total_bidders), result_declared_on: s(t.result_declared_on),
    lost_reason: s(t.lost_reason), loa_no: s(t.loa_no), loa_date: s(t.loa_date), work_order_no: s(t.work_order_no),
    contract_value: s(t.contract_value), completion_days: s(t.completion_days),
  };
}

export function TenderFormDialog({
  open,
  onOpenChange,
  tender,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tender: Tender | null;
  onSaved?: (id: string) => void;
}) {
  const isNew = !tender;
  const can = useCan('crm.tenders');
  const { access } = useAccess();
  const qc = useQueryClient();
  const sites = useSites();
  const people = usePeople();
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setF(fromTender(tender));
      setTouched(false);
    }
  }, [open, tender]);

  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const titleError = !f.title.trim() ? 'A title is required.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (titleError) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: f.title.trim(),
      reference_no: f.reference_no.trim() || null,
      authority: f.authority.trim() || null,
      portal: f.portal || null,
      portal_url: f.portal_url.trim() || null,
      tender_type: f.tender_type,
      work_type: f.work_type || null,
      state: f.state.trim() || null,
      district: f.district.trim() || null,
      location: f.location.trim() || null,
      site_id: f.site_id || null,
      capacity_kwp: num(f.capacity_kwp),
      estimated_value: num(f.estimated_value) ?? 0,
      tender_fee: num(f.tender_fee) ?? 0,
      emd_amount: num(f.emd_amount) ?? 0,
      emd_mode: f.emd_mode || null,
      emd_status: f.emd_status,
      emd_submitted_on: f.emd_submitted_on || null,
      emd_valid_until: f.emd_valid_until || null,
      emd_refunded_on: f.emd_refunded_on || null,
      published_on: f.published_on || null,
      prebid_at: fromLocalInput(f.prebid_at),
      clarification_due: f.clarification_due || null,
      submission_due_at: fromLocalInput(f.submission_due_at),
      technical_opening_at: fromLocalInput(f.technical_opening_at),
      financial_opening_at: fromLocalInput(f.financial_opening_at),
      status: f.status,
      notes: f.notes.trim() || null,
      our_bid_value: num(f.our_bid_value),
      our_rank: num(f.our_rank),
      l1_value: num(f.l1_value),
      l1_bidder: f.l1_bidder.trim() || null,
      total_bidders: num(f.total_bidders),
      result_declared_on: f.result_declared_on || null,
      lost_reason: f.lost_reason.trim() || null,
      loa_no: f.loa_no.trim() || null,
      loa_date: f.loa_date || null,
      work_order_no: f.work_order_no.trim() || null,
      contract_value: num(f.contract_value),
      completion_days: num(f.completion_days),
    };
    // Assigning to someone else needs the ASSIGN permission; the database
    // enforces this too. New tenders default to the creator.
    if (can.assign) payload.assigned_to = f.assigned_to || null;
    else if (isNew) payload.assigned_to = access?.profile?.id ?? null;

    const res = isNew
      ? await supabase.from('tenders').insert(payload).select('id').single()
      : await supabase.from('tenders').update(payload).eq('id', tender.id).select('id').single();
    setBusy(false);
    if (res.error) return toast.error(errorMessage(res.error));
    toast.success(isNew ? 'Tender added' : 'Tender updated');
    await qc.invalidateQueries({ queryKey: ['tenders'] });
    await qc.invalidateQueries({ queryKey: ['tender'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    onSaved?.(res.data.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add tender' : `Edit ${tender.tender_code}`}</DialogTitle>
          <DialogDescription>Track the bid from the published notice to the award.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit}>
          <Tabs defaultValue="basics">
            <TabsList>
              <TabsTrigger value="basics">Tender</TabsTrigger>
              <TabsTrigger value="dates">Dates</TabsTrigger>
              <TabsTrigger value="money">Fee & EMD</TabsTrigger>
              <TabsTrigger value="result">Bid & result</TabsTrigger>
            </TabsList>

            <TabsContent value="basics" className="grid gap-4 sm:grid-cols-2">
              <Field label="Tender title" htmlFor="t_title" required error={touched ? titleError : null} className="sm:col-span-2">
                <Input id="t_title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Supply & installation of 2 MW solar plant" autoFocus />
              </Field>
              <Field label="Authority / department" htmlFor="t_auth">
                <Input id="t_auth" value={f.authority} onChange={(e) => set('authority', e.target.value)} placeholder="Jal Jeevan Mission, RVPN, Nagar Nigam…" />
              </Field>
              <Field label="Tender / NIT number" htmlFor="t_ref">
                <Input id="t_ref" value={f.reference_no} onChange={(e) => set('reference_no', e.target.value)} />
              </Field>
              <Field label="Portal">
                <FilterSelect value={f.portal || NONE} onChange={(v) => set('portal', v === NONE ? '' : v)} options={[[NONE, '— Select —'], ...PORTALS.map((p) => [p, p] as [string, string])]} />
              </Field>
              <Field label="Portal link" htmlFor="t_url">
                <Input id="t_url" value={f.portal_url} onChange={(e) => set('portal_url', e.target.value)} placeholder="https://" />
              </Field>
              <Field label="Tender type">
                <FilterSelect value={f.tender_type} onChange={(v) => set('tender_type', v)} options={TENDER_TYPES.map((t) => [t, TENDER_TYPE_LABEL[t]] as [string, string])} />
              </Field>
              <Field label="Scope of work">
                <FilterSelect value={f.work_type || NONE} onChange={(v) => set('work_type', v === NONE ? '' : v)} options={[[NONE, '— Select —'], ...WORK_TYPES.map((w) => [w, w] as [string, string])]} />
              </Field>
              <Field label="Capacity (kWp)" htmlFor="t_cap">
                <Input id="t_cap" inputMode="decimal" value={f.capacity_kwp} onChange={(e) => set('capacity_kwp', e.target.value)} />
              </Field>
              <Field label="Estimated value (₹)" htmlFor="t_est">
                <Input id="t_est" inputMode="decimal" value={f.estimated_value} onChange={(e) => set('estimated_value', e.target.value)} />
              </Field>
              <Field label="District" htmlFor="t_dist">
                <Input id="t_dist" value={f.district} onChange={(e) => set('district', e.target.value)} />
              </Field>
              <Field label="State" htmlFor="t_state">
                <Input id="t_state" value={f.state} onChange={(e) => set('state', e.target.value)} />
              </Field>
              <Field label="Linked site" hint="Only for work at one of our own sites.">
                <FilterSelect
                  value={f.site_id || NONE}
                  onChange={(v) => set('site_id', v === NONE ? '' : v)}
                  options={[[NONE, '— Not site specific —'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]}
                />
              </Field>
              <Field label="Status">
                <FilterSelect value={f.status} onChange={(v) => set('status', v)} options={Object.entries(TENDER_STATUS).map(([k, v]) => [k, v.label] as [string, string])} />
              </Field>
              {can.assign && (
                <Field label="Bid manager">
                  <FilterSelect
                    value={f.assigned_to || NONE}
                    onChange={(v) => set('assigned_to', v === NONE ? '' : v)}
                    options={[[NONE, '— Unassigned —'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
                  />
                </Field>
              )}
              <Field label="Notes" htmlFor="t_notes" className="sm:col-span-2">
                <Textarea id="t_notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </TabsContent>

            <TabsContent value="dates" className="grid gap-4 sm:grid-cols-2">
              <Field label="Published on" htmlFor="t_pub">
                <Input id="t_pub" type="date" value={f.published_on} onChange={(e) => set('published_on', e.target.value)} />
              </Field>
              <Field label="Pre-bid meeting" htmlFor="t_prebid">
                <Input id="t_prebid" type="datetime-local" value={f.prebid_at} onChange={(e) => set('prebid_at', e.target.value)} />
              </Field>
              <Field label="Clarifications due" htmlFor="t_clar">
                <Input id="t_clar" type="date" value={f.clarification_due} onChange={(e) => set('clarification_due', e.target.value)} />
              </Field>
              <Field label="Bid submission deadline" htmlFor="t_due" hint="Drives the reminders and the dashboard.">
                <Input id="t_due" type="datetime-local" value={f.submission_due_at} onChange={(e) => set('submission_due_at', e.target.value)} />
              </Field>
              <Field label="Technical opening" htmlFor="t_tech">
                <Input id="t_tech" type="datetime-local" value={f.technical_opening_at} onChange={(e) => set('technical_opening_at', e.target.value)} />
              </Field>
              <Field label="Financial opening" htmlFor="t_fin">
                <Input id="t_fin" type="datetime-local" value={f.financial_opening_at} onChange={(e) => set('financial_opening_at', e.target.value)} />
              </Field>
            </TabsContent>

            <TabsContent value="money" className="grid gap-4 sm:grid-cols-2">
              <Field label="Tender fee (₹)" htmlFor="t_fee">
                <Input id="t_fee" inputMode="decimal" value={f.tender_fee} onChange={(e) => set('tender_fee', e.target.value)} />
              </Field>
              <Field label="EMD amount (₹)" htmlFor="t_emd">
                <Input id="t_emd" inputMode="decimal" value={f.emd_amount} onChange={(e) => set('emd_amount', e.target.value)} />
              </Field>
              <Field label="EMD mode">
                <FilterSelect value={f.emd_mode || NONE} onChange={(v) => set('emd_mode', v === NONE ? '' : v)} options={[[NONE, '— Select —'], ...EMD_MODES.map((m) => [m, m] as [string, string])]} />
              </Field>
              <Field label="EMD status">
                <FilterSelect value={f.emd_status} onChange={(v) => set('emd_status', v)} options={Object.entries(EMD_STATUS).map(([k, v]) => [k, v.label] as [string, string])} />
              </Field>
              <Field label="EMD paid on" htmlFor="t_emd_on">
                <Input id="t_emd_on" type="date" value={f.emd_submitted_on} onChange={(e) => set('emd_submitted_on', e.target.value)} />
              </Field>
              <Field label="EMD valid until" htmlFor="t_emd_val">
                <Input id="t_emd_val" type="date" value={f.emd_valid_until} onChange={(e) => set('emd_valid_until', e.target.value)} />
              </Field>
              <Field label="EMD refunded on" htmlFor="t_emd_ref">
                <Input id="t_emd_ref" type="date" value={f.emd_refunded_on} onChange={(e) => set('emd_refunded_on', e.target.value)} />
              </Field>
            </TabsContent>

            <TabsContent value="result" className="grid gap-4 sm:grid-cols-2">
              <Field label="Our bid value (₹)" htmlFor="t_bid">
                <Input id="t_bid" inputMode="decimal" value={f.our_bid_value} onChange={(e) => set('our_bid_value', e.target.value)} />
              </Field>
              <Field label="Our rank (L1 = 1)" htmlFor="t_rank">
                <Input id="t_rank" inputMode="numeric" value={f.our_rank} onChange={(e) => set('our_rank', e.target.value)} />
              </Field>
              <Field label="L1 value (₹)" htmlFor="t_l1">
                <Input id="t_l1" inputMode="decimal" value={f.l1_value} onChange={(e) => set('l1_value', e.target.value)} />
              </Field>
              <Field label="L1 bidder" htmlFor="t_l1b">
                <Input id="t_l1b" value={f.l1_bidder} onChange={(e) => set('l1_bidder', e.target.value)} />
              </Field>
              <Field label="Total bidders" htmlFor="t_tb">
                <Input id="t_tb" inputMode="numeric" value={f.total_bidders} onChange={(e) => set('total_bidders', e.target.value)} />
              </Field>
              <Field label="Result declared on" htmlFor="t_res">
                <Input id="t_res" type="date" value={f.result_declared_on} onChange={(e) => set('result_declared_on', e.target.value)} />
              </Field>
              <Field label="Reason for loss" htmlFor="t_lost" className="sm:col-span-2">
                <Input id="t_lost" value={f.lost_reason} onChange={(e) => set('lost_reason', e.target.value)} placeholder="Price, technical, documentation…" />
              </Field>
              <Field label="LOA / LOI number" htmlFor="t_loa">
                <Input id="t_loa" value={f.loa_no} onChange={(e) => set('loa_no', e.target.value)} />
              </Field>
              <Field label="LOA date" htmlFor="t_load">
                <Input id="t_load" type="date" value={f.loa_date} onChange={(e) => set('loa_date', e.target.value)} />
              </Field>
              <Field label="Work order number" htmlFor="t_wo">
                <Input id="t_wo" value={f.work_order_no} onChange={(e) => set('work_order_no', e.target.value)} />
              </Field>
              <Field label="Contract value (₹)" htmlFor="t_cv">
                <Input id="t_cv" inputMode="decimal" value={f.contract_value} onChange={(e) => set('contract_value', e.target.value)} />
              </Field>
              <Field label="Completion period (days)" htmlFor="t_days">
                <Input id="t_days" inputMode="numeric" value={f.completion_days} onChange={(e) => set('completion_days', e.target.value)} />
              </Field>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {isNew ? 'Add tender' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
