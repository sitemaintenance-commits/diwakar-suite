// Preventive and corrective maintenance schedule.
import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, Download, Loader2, Plus, TriangleAlert, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDate, safeNum, titleCase, todayIST } from '@/lib/format';
import type { MaintenanceRecord } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Field, PageHeader, Pagination, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople, useSites } from '@/features/admin/api';
import { useDashboardSummary } from '@/features/dashboard/api';
import { fetchMaintenance, useEquipment, useMaintenance, type MaintenanceFilters } from '@/features/om/api';
import { MAINTENANCE_TYPES, TASK_STATUS } from '@/features/om/shared';
import { StatusChip } from '@/features/crm/shared';

const PAGE_SIZE = 20;
const NONE = '__none__';

export function MaintenancePage() {
  const can = useCan('om.maintenance');
  const qc = useQueryClient();
  const sites = useSites();
  const summary = useDashboardSummary();
  const [filters, setFilters] = useState<MaintenanceFilters>({ status: 'pending', siteId: 'all', type: 'all', page: 0, pageSize: PAGE_SIZE });
  const list = useMaintenance(filters);
  const [formOpen, setFormOpen] = useState(false);
  const [completing, setCompleting] = useState<MaintenanceRecord | null>(null);
  const update = (patch: Partial<MaintenanceFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  const m = summary.data?.maintenance;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['maintenance'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  async function onExport() {
    try {
      const { rows } = await fetchMaintenance(filters, true);
      await exportCsv('om.maintenance', `maintenance-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Site', value: (r) => r.sites?.name },
        { header: 'Equipment', value: (r) => r.equipment?.name },
        { header: 'Type', value: (r) => r.type },
        { header: 'Activity', value: (r) => r.title },
        { header: 'Scheduled', value: (r) => r.scheduled_date },
        { header: 'Done', value: (r) => r.done_date },
        { header: 'Status', value: (r) => TASK_STATUS[r.status].label },
        { header: 'Findings', value: (r) => r.findings },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={Wrench}
        title="Maintenance"
        description="Preventive schedules and corrective work for your sites."
        actions={
          <>
            {can.export && (
              <Button variant="outline" onClick={onExport}>
                <Download /> Export
              </Button>
            )}
            {can.create && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus /> Schedule maintenance
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Pending activities" value={safeNum(m?.pending)} icon={CalendarClock} loading={summary.isLoading} />
        <StatCard label="Overdue" value={safeNum(m?.overdue)} icon={TriangleAlert} tone="red" loading={summary.isLoading} />
        <StatCard label="Sites covered" value={(sites.data ?? []).filter((s) => s.status === 'active').length} icon={Wrench} tone="violet" loading={sites.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v })}
              options={[['pending', 'Pending'], ['all', 'All statuses'], ...Object.entries(TASK_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect value={filters.siteId} onChange={(v) => update({ siteId: v })} options={[['all', 'All my sites'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
            <FilterSelect value={filters.type} onChange={(v) => update({ type: v })} options={[['all', 'All types'], ...MAINTENANCE_TYPES.map((t) => [t, titleCase(t)] as [string, string])]} />
          </div>
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={5} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : !list.data?.rows.length ? (
          <EmptyState icon={Wrench} title="Nothing scheduled" description={can.create ? 'Schedule cleaning, inspections and preventive checks.' : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Activity</TableHead>
                <TableHead className="hidden md:table-cell">Site</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((r) => {
                const overdue = r.scheduled_date && r.status !== 'done' && r.scheduled_date < todayIST();
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">{r.equipment?.name ?? ''}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{r.sites?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{titleCase(r.type)}</TableCell>
                    <TableCell className={`text-sm ${overdue ? 'text-destructive' : ''}`}>
                      {r.scheduled_date ? fmtDate(r.scheduled_date) : '—'}
                      {r.done_date && <div className="text-xs text-muted-foreground">Done {fmtDate(r.done_date)}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusChip map={TASK_STATUS} value={r.status} />
                    </TableCell>
                    <TableCell>
                      {can.edit && r.status !== 'done' && (
                        <Button size="sm" variant="ghost" onClick={() => setCompleting(r)}>
                          <CheckCircle2 /> Done
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <MaintenanceFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={refresh} />
      <CompleteDialog record={completing} onClose={() => setCompleting(null)} onSaved={refresh} />
    </>
  );
}

function MaintenanceFormDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<void> }) {
  const can = useCan('om.maintenance');
  const sites = useSites();
  const people = usePeople();
  const [f, setF] = useState({ site_id: '', equipment_id: '', type: 'preventive', title: '', scheduled_date: '', assigned_to: '', findings: '' });
  const equipment = useEquipment(f.site_id || undefined);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setF({ site_id: '', equipment_id: '', type: 'preventive', title: '', scheduled_date: '', assigned_to: '', findings: '' });
      setTouched(false);
    }
  }, [open]);

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const siteError = !f.site_id ? 'Choose the site.' : null;
  const titleError = !f.title.trim() ? 'Name the activity.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (siteError || titleError) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      site_id: f.site_id,
      equipment_id: f.equipment_id || null,
      type: f.type,
      title: f.title.trim(),
      scheduled_date: f.scheduled_date || null,
      findings: f.findings.trim() || null,
    };
    if (can.assign && f.assigned_to) payload.assigned_to = f.assigned_to;
    const { error } = await supabase.from('maintenance_records').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Maintenance scheduled');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Schedule maintenance</DialogTitle>
          <DialogDescription>Cleaning, inspection, calibration or a planned repair.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Site" required error={touched ? siteError : null}>
            <FilterSelect
              value={f.site_id || NONE}
              onChange={(v) => set('site_id', v === NONE ? '' : v)}
              options={[[NONE, '— Select site —'], ...(sites.data ?? []).filter((s) => s.status === 'active').map((s) => [s.id, s.name] as [string, string])]}
            />
          </Field>
          <Field label="Equipment">
            <FilterSelect
              value={f.equipment_id || NONE}
              onChange={(v) => set('equipment_id', v === NONE ? '' : v)}
              options={[[NONE, '— Whole site —'], ...(equipment.data ?? []).map((e) => [e.id, e.name] as [string, string])]}
            />
          </Field>
          <Field label="Activity" htmlFor="m_title" required error={touched ? titleError : null} className="sm:col-span-2">
            <Input id="m_title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Quarterly module cleaning" autoFocus />
          </Field>
          <Field label="Type">
            <FilterSelect value={f.type} onChange={(v) => set('type', v)} options={MAINTENANCE_TYPES.map((t) => [t, titleCase(t)] as [string, string])} />
          </Field>
          <Field label="Scheduled date" htmlFor="m_date">
            <Input id="m_date" type="date" value={f.scheduled_date} onChange={(e) => set('scheduled_date', e.target.value)} />
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
          <Field label="Notes" htmlFor="m_notes" className="sm:col-span-2">
            <Textarea id="m_notes" rows={2} value={f.findings} onChange={(e) => set('findings', e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ record, onClose, onSaved }: { record: MaintenanceRecord | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [findings, setFindings] = useState('');
  const [date, setDate] = useState(todayIST());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFindings(record?.findings ?? '');
    setDate(record?.done_date ?? todayIST());
  }, [record]);

  if (!record) return null;

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from('maintenance_records')
      .update({ status: 'done', done_date: date, findings: findings.trim() || null })
      .eq('id', record!.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Marked as done');
    await onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record.title}</DialogTitle>
          <DialogDescription>{record.sites?.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Completed on" htmlFor="c_date">
            <Input id="c_date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Findings / work done" htmlFor="c_find">
            <Textarea id="c_find" rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} autoFocus />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
