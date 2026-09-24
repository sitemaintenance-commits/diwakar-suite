// Breakdown tickets: raise, assign, work, resolve, close.
// The workflow rules (ASSIGN to reassign, APPROVE to close, server-stamped
// timestamps and downtime) are enforced by the database.
import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Download, Loader2, Play, Plus, Ticket as TicketIcon, TriangleAlert, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDateTime, fmtNumber, safeNum } from '@/lib/format';
import type { Ticket, TicketStatus } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Field, PageHeader, Pagination, SearchInput, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople, useSites } from '@/features/admin/api';
import { useDashboardSummary } from '@/features/dashboard/api';
import { fetchTickets, useEquipment, useTickets, type TicketFilters } from '@/features/om/api';
import { PRIORITY, TICKET_CATEGORIES, TICKET_STATUS } from '@/features/om/shared';
import { StatusChip } from '@/features/crm/shared';

const PAGE_SIZE = 20;
const NONE = '__none__';

export function TicketsPage() {
  const can = useCan('om.tickets');
  const qc = useQueryClient();
  const sites = useSites();
  const people = usePeople();
  const summary = useDashboardSummary();
  const [filters, setFilters] = useState<TicketFilters>({
    search: '',
    status: 'open',
    priority: 'all',
    siteId: 'all',
    assignedTo: 'all',
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const tickets = useTickets(filters);
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<Ticket | null>(null);
  const update = (patch: Partial<TicketFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  const t = summary.data?.tickets;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['tickets'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    await qc.invalidateQueries({ queryKey: ['generation-summary'] });
  };

  async function setStatus(ticket: Ticket, status: TicketStatus, extra: Record<string, unknown> = {}) {
    const { error } = await supabase.from('maintenance_tickets').update({ status, ...extra }).eq('id', ticket.id);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success(`${ticket.ticket_no} — ${TICKET_STATUS[status].label.toLowerCase()}`);
    await refresh();
    setDetail(null);
  }

  async function onExport() {
    try {
      const { rows } = await fetchTickets(filters, true);
      await exportCsv('om.tickets', `tickets-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Ticket', value: (r) => r.ticket_no },
        { header: 'Site', value: (r) => r.sites?.name },
        { header: 'Equipment', value: (r) => r.equipment?.name },
        { header: 'Title', value: (r) => r.title },
        { header: 'Issue', value: (r) => r.issue },
        { header: 'Category', value: (r) => r.category },
        { header: 'Priority', value: (r) => r.priority },
        { header: 'Status', value: (r) => TICKET_STATUS[r.status].label },
        { header: 'Reported', value: (r) => r.reported_at },
        { header: 'Resolved', value: (r) => r.resolved_at },
        { header: 'Downtime (h)', value: (r) => r.downtime_hours },
        { header: 'Generation loss (kWh)', value: (r) => r.generation_loss_kwh },
        { header: 'Root cause', value: (r) => r.root_cause },
        { header: 'Resolution', value: (r) => r.resolution },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={TicketIcon}
        title="Tickets"
        description="Breakdowns and complaints for your sites, from report to closure."
        actions={
          <>
            {can.export && (
              <Button variant="outline" onClick={onExport}>
                <Download /> Export
              </Button>
            )}
            {can.create && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus /> Raise ticket
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open tickets" value={safeNum(t?.open)} icon={TicketIcon} tone="red" loading={summary.isLoading} />
        <StatCard label="Critical" value={safeNum(t?.critical)} icon={TriangleAlert} tone="red" loading={summary.isLoading} />
        <StatCard label="Unassigned" value={safeNum(t?.unassigned)} icon={Wrench} tone="amber" loading={summary.isLoading} />
        <StatCard label="Resolved today" value={safeNum(t?.resolved_today)} icon={CheckCircle2} tone="green" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center">
          <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Search ticket, issue…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v })}
              options={[['open', 'Open (all stages)'], ['all', 'All statuses'], ...Object.entries(TICKET_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect
              value={filters.priority}
              onChange={(v) => update({ priority: v })}
              options={[['all', 'Any priority'], ...Object.entries(PRIORITY).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect value={filters.siteId} onChange={(v) => update({ siteId: v })} options={[['all', 'All my sites'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
            <FilterSelect value={filters.assignedTo} onChange={(v) => update({ assignedTo: v })} options={[['all', 'Anyone'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]} />
          </div>
        </div>

        {tickets.isLoading ? (
          <TableSkeleton cols={6} />
        ) : tickets.error ? (
          <ErrorState message={errorMessage(tickets.error)} onRetry={() => tickets.refetch()} />
        ) : !tickets.data?.rows.length ? (
          <EmptyState icon={TicketIcon} title="No tickets" description="Nothing matches these filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead className="hidden md:table-cell">Site / equipment</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Reported</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.data.rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => setDetail(row)}>
                  <TableCell>
                    <div className="font-medium">{row.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.ticket_no}
                      {row.category ? ` · ${row.category}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">
                    <div>{row.sites?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{row.equipment?.name ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    <StatusChip map={PRIORITY} value={row.priority} />
                  </TableCell>
                  <TableCell>
                    <StatusChip map={TICKET_STATUS} value={row.status} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{fmtDateTime(row.reported_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={tickets.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <TicketFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={refresh} />
      <TicketDetailDialog ticket={detail} onClose={() => setDetail(null)} onStatus={setStatus} onSaved={refresh} />
    </>
  );
}

function TicketFormDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<void> }) {
  const can = useCan('om.tickets');
  const { access } = useAccess();
  const sites = useSites();
  const people = usePeople();
  const [f, setF] = useState({ site_id: '', equipment_id: '', title: '', issue: '', category: '', priority: 'medium', assigned_to: '' });
  const equipment = useEquipment(f.site_id || undefined);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setF({ site_id: '', equipment_id: '', title: '', issue: '', category: '', priority: 'medium', assigned_to: '' });
      setTouched(false);
    }
  }, [open]);

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const siteError = !f.site_id ? 'Choose the site.' : null;
  const titleError = !f.title.trim() ? 'Describe the problem in a few words.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (siteError || titleError) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      site_id: f.site_id,
      equipment_id: f.equipment_id || null,
      title: f.title.trim(),
      issue: f.issue.trim() || null,
      category: f.category || null,
      priority: f.priority,
      reported_by: access?.profile?.id ?? null,
    };
    if (can.assign && f.assigned_to) payload.assigned_to = f.assigned_to;
    const { error } = await supabase.from('maintenance_tickets').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Ticket raised');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Raise ticket</DialogTitle>
          <DialogDescription>Report a breakdown or complaint at one of your sites.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Site" required error={touched ? siteError : null}>
            <FilterSelect
              value={f.site_id || NONE}
              onChange={(v) => set('site_id', v === NONE ? '' : v)}
              options={[[NONE, '— Select site —'], ...(sites.data ?? []).filter((s) => s.status === 'active').map((s) => [s.id, s.name] as [string, string])]}
            />
          </Field>
          <Field label="Equipment" hint={f.site_id ? undefined : 'Choose a site first.'}>
            <FilterSelect
              value={f.equipment_id || NONE}
              onChange={(v) => set('equipment_id', v === NONE ? '' : v)}
              options={[[NONE, '— Not specific —'], ...(equipment.data ?? []).map((e) => [e.id, e.name] as [string, string])]}
            />
          </Field>
          <Field label="Problem" htmlFor="t_title" required error={touched ? titleError : null} className="sm:col-span-2">
            <Input id="t_title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Inverter 2 not starting" autoFocus />
          </Field>
          <Field label="Category">
            <FilterSelect value={f.category || NONE} onChange={(v) => set('category', v === NONE ? '' : v)} options={[[NONE, '— Select —'], ...TICKET_CATEGORIES.map((c) => [c, c] as [string, string])]} />
          </Field>
          <Field label="Priority">
            <FilterSelect value={f.priority} onChange={(v) => set('priority', v)} options={Object.entries(PRIORITY).map(([k, v]) => [k, v.label] as [string, string])} />
          </Field>
          {can.assign && (
            <Field label="Assign to" className="sm:col-span-2">
              <FilterSelect
                value={f.assigned_to || NONE}
                onChange={(v) => set('assigned_to', v === NONE ? '' : v)}
                options={[[NONE, '— Unassigned —'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
              />
            </Field>
          )}
          <Field label="Details" htmlFor="t_issue" className="sm:col-span-2">
            <Textarea id="t_issue" rows={3} value={f.issue} onChange={(e) => set('issue', e.target.value)} placeholder="Fault code, when it started, what was tried…" />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Raise ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketDetailDialog({
  ticket,
  onClose,
  onStatus,
  onSaved,
}: {
  ticket: Ticket | null;
  onClose: () => void;
  onStatus: (t: Ticket, s: TicketStatus, extra?: Record<string, unknown>) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const can = useCan('om.tickets');
  const people = usePeople();
  const [resolution, setResolution] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [loss, setLoss] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setResolution(ticket?.resolution ?? '');
    setRootCause(ticket?.root_cause ?? '');
    setLoss(ticket?.generation_loss_kwh ? String(safeNum(ticket.generation_loss_kwh)) : '');
    setAssignee(ticket?.assigned_to ?? '');
  }, [ticket]);

  if (!ticket) return null;
  const open = ['open', 'assigned', 'in_progress'].includes(ticket.status);

  async function assign() {
    setBusy(true);
    const { error } = await supabase.from('maintenance_tickets').update({ assigned_to: assignee || null }).eq('id', ticket!.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Ticket assigned');
    await onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {ticket.title}
            <StatusChip map={TICKET_STATUS} value={ticket.status} />
            <StatusChip map={PRIORITY} value={ticket.priority} />
          </DialogTitle>
          <DialogDescription>
            {ticket.ticket_no} · {ticket.sites?.name}
            {ticket.equipment?.name ? ` · ${ticket.equipment.name}` : ''} · reported {fmtDateTime(ticket.reported_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {ticket.issue && <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{ticket.issue}</p>}

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Started</dt>
              <dd>{ticket.started_at ? fmtDateTime(ticket.started_at) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Resolved</dt>
              <dd>{ticket.resolved_at ? fmtDateTime(ticket.resolved_at) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Downtime</dt>
              <dd>{ticket.downtime_hours ? `${fmtNumber(ticket.downtime_hours, 2)} h` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Generation loss</dt>
              <dd>{ticket.generation_loss_kwh ? `${fmtNumber(ticket.generation_loss_kwh, 1)} kWh` : '—'}</dd>
            </div>
          </dl>

          {can.assign && open && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-60">
                <Field label="Assign to">
                  <FilterSelect
                    value={assignee || NONE}
                    onChange={(v) => setAssignee(v === NONE ? '' : v)}
                    options={[[NONE, '— Unassigned —'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
                  />
                </Field>
              </div>
              <Button variant="outline" onClick={assign} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Save assignment
              </Button>
            </div>
          )}

          {can.edit && open && (
            <div className="grid gap-3 rounded-lg border p-3">
              <Field label="Root cause" htmlFor="tk_root">
                <Input id="tk_root" value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
              </Field>
              <Field label="What was done" htmlFor="tk_res">
                <Textarea id="tk_res" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />
              </Field>
              <Field label="Estimated generation loss (kWh)" htmlFor="tk_loss">
                <Input id="tk_loss" inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} className="sm:w-48" />
              </Field>
            </div>
          )}

          {ticket.resolution && !open && (
            <div className="rounded-lg border p-3 text-sm">
              <div className="text-xs text-muted-foreground">Resolution</div>
              <p className="whitespace-pre-wrap">{ticket.resolution}</p>
              {ticket.root_cause && <p className="mt-1 text-muted-foreground">Root cause: {ticket.root_cause}</p>}
            </div>
          )}

          {!can.approve && ticket.status === 'resolved' && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Closing a ticket requires the APPROVE permission on Tickets.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close window
          </Button>
          {can.edit && ticket.status === 'assigned' && (
            <Button variant="outline" onClick={() => onStatus(ticket, 'in_progress')}>
              <Play /> Start work
            </Button>
          )}
          {can.edit && open && (
            <Button
              onClick={() =>
                onStatus(ticket, 'resolved', {
                  resolution: resolution.trim() || null,
                  root_cause: rootCause.trim() || null,
                  generation_loss_kwh: loss ? safeNum(loss) : null,
                })
              }
            >
              <CheckCircle2 /> Mark resolved
            </Button>
          )}
          {can.approve && ticket.status === 'resolved' && (
            <Button onClick={() => onStatus(ticket, 'closed')}>
              <CheckCircle2 /> Close ticket
            </Button>
          )}
          {ticket.status === 'closed' && <Badge variant="secondary">Closed {fmtDateTime(ticket.closed_at)}</Badge>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
