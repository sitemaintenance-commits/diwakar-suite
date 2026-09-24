import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Loader2, Mail, MoreHorizontal, Pencil, Phone, Plus, Target, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtCapacity, fmtDate, fmtINR, safeNum } from '@/lib/format';
import type { Lead } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, Pagination, SearchInput, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople } from '@/features/admin/api';
import { useDashboardSummary } from '@/features/dashboard/api';
import { fetchLeads, useLeads, type LeadFilters } from '@/features/crm/api';
import { LEAD_STATUS, StatusChip } from '@/features/crm/shared';

const PAGE_SIZE = 20;
const NONE = '__none__';
const SOURCES = ['Referral', 'Website', 'Phone enquiry', 'Site visit', 'Exhibition', 'Existing client', 'Other'];

export function LeadsPage() {
  const can = useCan('crm.leads');
  const people = usePeople();
  const summary = useDashboardSummary();
  const [filters, setFilters] = useState<LeadFilters>({ search: '', status: 'all', assignedTo: 'all', page: 0, pageSize: PAGE_SIZE });
  const leads = useLeads(filters);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const qc = useQueryClient();

  const update = (patch: Partial<LeadFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  const l = summary.data?.leads;

  async function remove(lead: Lead) {
    const { error } = await supabase.rpc('soft_delete_record', { p_table: 'leads', p_id: lead.id });
    if (error) return toast.error(errorMessage(error));
    toast.success('Lead deleted');
    await qc.invalidateQueries({ queryKey: ['leads'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  }

  async function onExport() {
    try {
      const { rows } = await fetchLeads(filters, true);
      await exportCsv('crm.leads', `leads-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Code', value: (r) => r.lead_code },
        { header: 'Company', value: (r) => r.company },
        { header: 'Contact', value: (r) => r.contact_person },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Email', value: (r) => r.email },
        { header: 'Location', value: (r) => [r.location, r.district, r.state].filter(Boolean).join(', ') },
        { header: 'Source', value: (r) => r.source },
        { header: 'Requirement', value: (r) => r.requirement },
        { header: 'Capacity (kWp)', value: (r) => safeNum(r.capacity_kwp) },
        { header: 'Value', value: (r) => safeNum(r.lead_value) },
        { header: 'Status', value: (r) => LEAD_STATUS[r.status].label },
        { header: 'Next follow-up', value: (r) => r.next_follow_up },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={Target}
        title="Leads"
        description="Direct enquiries and private-sector opportunities outside the tender pipeline."
        actions={
          <>
            {can.export && (
              <Button variant="outline" onClick={onExport}>
                <Download /> Export
              </Button>
            )}
            {can.create && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus /> Add lead
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open leads" value={safeNum(l?.open)} icon={Target} loading={summary.isLoading} />
        <StatCard label="Open value" value={fmtINR(l?.value, true)} icon={Target} tone="green" loading={summary.isLoading} />
        <StatCard label="Interested / quoted" value={safeNum(l?.interested) + safeNum(l?.quoted)} icon={Target} tone="amber" loading={summary.isLoading} />
        <StatCard label="Converted" value={safeNum(l?.converted)} hint={`${safeNum(l?.lost)} lost`} icon={Target} tone="violet" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Search company, contact, phone…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v })}
              options={[['all', 'All statuses'], ...Object.entries(LEAD_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect
              value={filters.assignedTo}
              onChange={(v) => update({ assignedTo: v })}
              options={[['all', 'Anyone'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
            />
          </div>
        </div>

        {leads.isLoading ? (
          <TableSkeleton cols={5} />
        ) : leads.error ? (
          <ErrorState message={errorMessage(leads.error)} onRetry={() => leads.refetch()} />
        ) : !leads.data?.rows.length ? (
          <EmptyState icon={Target} title="No leads yet" description={can.create ? 'Add the first enquiry to start tracking it.' : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden lg:table-cell">Next follow-up</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.company || row.contact_person}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.lead_code}
                      {row.requirement ? ` · ${row.requirement}` : ''}
                      {safeNum(row.capacity_kwp) ? ` · ${fmtCapacity(row.capacity_kwp)}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm">{row.contact_person}</div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      {row.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {row.phone}
                        </span>
                      )}
                      {row.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {row.email}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">{fmtINR(row.lead_value, true)}</TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{row.next_follow_up ? fmtDate(row.next_follow_up) : '—'}</TableCell>
                  <TableCell>
                    <StatusChip map={LEAD_STATUS} value={row.status} />
                  </TableCell>
                  <TableCell>
                    {(can.edit || can.delete) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.company || row.contact_person}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {can.edit && (
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(row);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil /> Edit
                            </DropdownMenuItem>
                          )}
                          {can.delete && (
                            <DropdownMenuItem destructive onSelect={() => setDeleting(row)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={leads.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} lead={editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.company || deleting?.contact_person}?`}
        description="The lead is removed from the list. Its history stays in the audit log."
        confirmLabel="Delete lead"
        destructive
        onConfirm={() => deleting && void remove(deleting)}
      />
    </>
  );
}

function LeadFormDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead | null }) {
  const isNew = !lead;
  const can = useCan('crm.leads');
  const { access } = useAccess();
  const qc = useQueryClient();
  const people = usePeople();
  const empty = {
    company: '', contact_person: '', phone: '', email: '', location: '', district: '', state: 'Rajasthan',
    source: '', status: 'new', requirement: '', capacity_kwp: '', lead_value: '', next_follow_up: '',
    assigned_to: '', notes: '', lost_reason: '',
  };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    setF(
      lead
        ? {
            company: s(lead.company), contact_person: lead.contact_person, phone: s(lead.phone), email: s(lead.email),
            location: s(lead.location), district: s(lead.district), state: s(lead.state), source: s(lead.source),
            status: lead.status, requirement: s(lead.requirement), capacity_kwp: s(lead.capacity_kwp),
            lead_value: s(lead.lead_value), next_follow_up: s(lead.next_follow_up), assigned_to: s(lead.assigned_to),
            notes: s(lead.notes), lost_reason: s(lead.lost_reason),
          }
        : empty,
    );
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead]);

  const set = (k: keyof typeof empty, v: string) => setF((s) => ({ ...s, [k]: v }));
  const contactError = !f.contact_person.trim() ? 'A contact person is required.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (contactError) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      company: f.company.trim() || null,
      contact_person: f.contact_person.trim(),
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      location: f.location.trim() || null,
      district: f.district.trim() || null,
      state: f.state.trim() || null,
      source: f.source || null,
      status: f.status,
      requirement: f.requirement.trim() || null,
      capacity_kwp: f.capacity_kwp ? Number(f.capacity_kwp) : null,
      lead_value: f.lead_value ? Number(f.lead_value) : 0,
      next_follow_up: f.next_follow_up || null,
      notes: f.notes.trim() || null,
      lost_reason: f.lost_reason.trim() || null,
    };
    if (can.assign) payload.assigned_to = f.assigned_to || null;
    else if (isNew) payload.assigned_to = access?.profile?.id ?? null;

    const { error } = isNew ? await supabase.from('leads').insert(payload) : await supabase.from('leads').update(payload).eq('id', lead.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(isNew ? 'Lead added' : 'Lead updated');
    await qc.invalidateQueries({ queryKey: ['leads'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add lead' : `Edit ${lead.lead_code}`}</DialogTitle>
          <DialogDescription>Enquiries that are not government tenders.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Company / organisation" htmlFor="l_company">
            <Input id="l_company" value={f.company} onChange={(e) => set('company', e.target.value)} autoFocus />
          </Field>
          <Field label="Contact person" htmlFor="l_contact" required error={touched ? contactError : null}>
            <Input id="l_contact" value={f.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="l_phone">
            <Input id="l_phone" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="l_email">
            <Input id="l_email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Requirement" htmlFor="l_req">
            <Input id="l_req" value={f.requirement} onChange={(e) => set('requirement', e.target.value)} placeholder="20 kW rooftop, solar pump…" />
          </Field>
          <Field label="Capacity (kWp)" htmlFor="l_cap">
            <Input id="l_cap" inputMode="decimal" value={f.capacity_kwp} onChange={(e) => set('capacity_kwp', e.target.value)} />
          </Field>
          <Field label="Estimated value (₹)" htmlFor="l_val">
            <Input id="l_val" inputMode="decimal" value={f.lead_value} onChange={(e) => set('lead_value', e.target.value)} />
          </Field>
          <Field label="Source">
            <FilterSelect value={f.source || NONE} onChange={(v) => set('source', v === NONE ? '' : v)} options={[[NONE, '— Select —'], ...SOURCES.map((s) => [s, s] as [string, string])]} />
          </Field>
          <Field label="District" htmlFor="l_dist">
            <Input id="l_dist" value={f.district} onChange={(e) => set('district', e.target.value)} />
          </Field>
          <Field label="State" htmlFor="l_state">
            <Input id="l_state" value={f.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <Field label="Status">
            <FilterSelect value={f.status} onChange={(v) => set('status', v)} options={Object.entries(LEAD_STATUS).map(([k, v]) => [k, v.label] as [string, string])} />
          </Field>
          <Field label="Next follow-up" htmlFor="l_next">
            <Input id="l_next" type="date" value={f.next_follow_up} onChange={(e) => set('next_follow_up', e.target.value)} />
          </Field>
          {can.assign && (
            <Field label="Assigned to">
              <FilterSelect
                value={f.assigned_to || NONE}
                onChange={(v) => set('assigned_to', v === NONE ? '' : v)}
                options={[[NONE, '— Unassigned —'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
              />
            </Field>
          )}
          {f.status === 'lost' && (
            <Field label="Reason for loss" htmlFor="l_lost" className="sm:col-span-2">
              <Input id="l_lost" value={f.lost_reason} onChange={(e) => set('lost_reason', e.target.value)} />
            </Field>
          )}
          <Field label="Notes" htmlFor="l_notes" className="sm:col-span-2">
            <Textarea id="l_notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {isNew ? 'Add lead' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
