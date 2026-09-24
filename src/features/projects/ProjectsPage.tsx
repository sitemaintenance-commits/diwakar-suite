// Projects — the Project CRM dashboard and the site list in one page:
// the portfolio tiles, execution progress per site, the capacity
// comparison and the project master.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Blocks, Download, FolderKanban, Gauge, Handshake, ListChecks, Plus, ShieldCheck, Sun, TriangleAlert,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtINR, fmtNumber, safeNum } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, Field, PageHeader, SearchInput, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSites } from '@/features/admin/api';
import { useProjectDashboard, type Project } from '@/features/projects/api';
import { PROJECT_TYPES, SEGMENTS, STAGE, stageOf, STAGES } from '@/features/projects/shared';

const BLANK = {
  name: '',
  client_name: '',
  segment: 'commercial',
  project_type: 'ground_mount',
  capacity_kwp: '',
  capacity_ac_kw: '',
  contract_value: '',
  stage: 'design',
  site_id: '',
  start_date: '',
  target_commissioning: '',
  district: '',
  state: 'Rajasthan',
  notes: '',
};

export function ProjectsPage() {
  const can = useCan('projects.projects');
  const qc = useQueryClient();
  const dash = useProjectDashboard();
  const sites = useSites();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);

  const d = dash.data;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (d?.projects ?? []).filter(
      (p) =>
        (stage === 'all' || p.stage === stage) &&
        (!q || `${p.name} ${p.client ?? ''} ${p.code}`.toLowerCase().includes(q)),
    );
  }, [d, search, stage]);

  const maxCap = Math.max(...(d?.projects ?? []).map((p) => safeNum(p.capacity_kwp)), 1);

  async function create() {
    if (!form.name.trim()) return toast.error('A project name is required.');
    setBusy(true);
    const { error } = await supabase.from('projects').insert({
      name: form.name.trim(),
      client_name: form.client_name.trim() || null,
      segment: form.segment,
      project_type: form.project_type,
      capacity_kwp: safeNum(form.capacity_kwp),
      capacity_ac_kw: safeNum(form.capacity_ac_kw),
      contract_value: safeNum(form.contract_value),
      stage: form.stage as Project['stage'],
      site_id: form.site_id || null,
      start_date: form.start_date || null,
      target_commissioning: form.target_commissioning || null,
      district: form.district.trim() || null,
      state: form.state.trim() || null,
      notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    setOpen(false);
    setForm({ ...BLANK });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Project created.');
  }

  async function onExport() {
    if (!rows.length) return;
    try {
      await exportCsv('projects.projects', 'projects', rows, [
        { header: 'Code', value: (r) => r.code },
        { header: 'Project', value: (r) => r.name },
        { header: 'Client', value: (r) => r.client ?? '' },
        { header: 'Segment', value: (r) => r.segment },
        { header: 'Type', value: (r) => r.project_type },
        { header: 'Capacity (kWp)', value: (r) => safeNum(r.capacity_kwp) },
        { header: 'AC (kW)', value: (r) => safeNum(r.capacity_ac_kw) },
        { header: 'Stage', value: (r) => r.stage },
        { header: 'Progress %', value: (r) => safeNum(r.progress) },
        { header: 'Contract value', value: (r) => safeNum(r.contract_value) },
        { header: 'Target commissioning', value: (r) => r.target_commissioning ?? '' },
        { header: 'Manager', value: (r) => r.manager ?? '' },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description="Site progress, approvals, materials, vendor bills and client payments."
        actions={
          <>
            {can.export && (
              <Button variant="outline" size="sm" onClick={onExport} disabled={!rows.length}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
            {can.create && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add project
              </Button>
            )}
          </>
        }
      />

      {dash.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : dash.error ? (
        <Card>
          <ErrorState message={errorMessage(dash.error)} onRetry={() => dash.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Projects" value={fmtNumber(d?.project_count)} hint={`${fmtNumber(d?.commissioned)} commissioned`} icon={FolderKanban} />
            <StatCard label="Portfolio capacity" value={fmtCapacity(d?.capacity_kwp)} hint={`${fmtNumber(d?.capacity_ac_kw)} kW AC`} icon={Sun} tone="amber" />
            <StatCard label="Average progress" value={`${fmtNumber(d?.average_progress)}%`} hint="Across every project" icon={Gauge} tone="green" />
            <StatCard label="Open tasks" value={fmtNumber(d?.open_tasks)} hint={`${fmtNumber(d?.overdue_tasks)} overdue`} icon={ListChecks} tone={safeNum(d?.overdue_tasks) > 0 ? 'red' : 'slate'} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Approvals pending" value={fmtNumber(d?.approvals_pending)} icon={ShieldCheck} tone="violet" />
            <StatCard label="Material lines open" value={fmtNumber(d?.materials_open)} hint={`${fmtNumber(d?.material_shortage)} shortage`} icon={Blocks} tone="blue" />
            <StatCard
              label="Vendor bills waiting"
              value={fmtNumber(d?.bills_waiting)}
              hint={fmtINR(d?.bills_waiting_value, true)}
              icon={TriangleAlert}
              tone={safeNum(d?.bills_waiting) > 0 ? 'amber' : 'slate'}
            />
            <StatCard
              label="Client outstanding"
              value={fmtINR(d?.client_outstanding, true)}
              hint={`${fmtINR(d?.client_received, true)} received`}
              icon={Handshake}
              tone="green"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Execution progress</CardTitle>
                <CardDescription>Completed tasks against the plan for each project</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {d?.projects.length ? (
                  d.projects.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`} className="grid gap-1 rounded-lg p-1 transition hover:bg-muted">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="tabular shrink-0 text-muted-foreground">
                          {stageOf(p.stage).label} · {fmtNumber(p.progress)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className={`h-2 rounded-full ${safeNum(p.progress) >= 100 ? 'bg-green-500' : 'bg-primary'}`}
                          style={{ width: `${Math.max(1, Math.min(100, safeNum(p.progress)))}%` }}
                        />
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Capacity by project</CardTitle>
                <CardDescription>DC capacity, largest first</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {d?.projects.length ? (
                  [...d.projects]
                    .sort((a, b) => safeNum(b.capacity_kwp) - safeNum(a.capacity_kwp))
                    .map((p) => (
                      <div key={p.id} className="grid gap-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate">{p.name}</span>
                          <span className="tabular shrink-0 text-muted-foreground">
                            {fmtNumber(p.capacity_kwp)} kWp · {fmtNumber(p.capacity_ac_kw)} AC
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(1, (safeNum(p.capacity_kwp) / maxCap) * 100)}%` }} />
                        </div>
                      </div>
                    ))
                ) : (
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {d?.attention.length ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Tasks needing attention</CardTitle>
                <CardDescription>The next items due across every project</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.attention.map((t) => {
                  const overdue = t.due_date && new Date(t.due_date) < new Date(new Date().toDateString());
                  return (
                    <div key={t.id} className="rounded-lg border px-3 py-2">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.project} · {t.due_date ? fmtDate(t.due_date) : 'No due date'}
                        {overdue && <span className="ml-1 text-destructive">overdue</span>}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <Card className="mt-6">
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Project sites</CardTitle>
                <CardDescription>
                  {fmtNumber(rows.length)} project(s) · {fmtCapacity(d?.capacity_kwp)} · {fmtINR(d?.contract_value, true)}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput value={search} onChange={setSearch} placeholder="Search project or client" />
                <div className="w-44">
                  <FilterSelect
                    value={stage}
                    onChange={setStage}
                    options={[['all', 'All stages'], ...STAGES.map((s) => [s, STAGE[s].label] as [string, string])]}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!rows.length ? (
                <EmptyState
                  icon={FolderKanban}
                  title="No projects"
                  description={can.create ? 'Add the first project to start tracking its plan.' : 'No projects match this filter.'}
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead className="text-right">Capacity</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">Progress</TableHead>
                        <TableHead className="text-right">Contract value</TableHead>
                        <TableHead>Target</TableHead>
                        <TableHead>Manager</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Link to={`/projects/${p.id}`} className="font-medium text-primary hover:underline">
                              {p.name}
                            </Link>
                            <div className="text-xs text-muted-foreground">{p.code}</div>
                          </TableCell>
                          <TableCell className="text-sm">{p.client ?? '—'}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(p.capacity_kwp)} kWp</TableCell>
                          <TableCell>
                            <Badge variant={stageOf(p.stage).tone}>{stageOf(p.stage).label}</Badge>
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {fmtNumber(p.progress)}%
                            <div className="text-xs text-muted-foreground">
                              {p.task_done}/{p.task_total} tasks
                            </div>
                          </TableCell>
                          <TableCell className="tabular text-right">{fmtINR(p.contract_value, true)}</TableCell>
                          <TableCell className="text-sm">{p.target_commissioning ? fmtDate(p.target_commissioning) : '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.manager ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Client">
              <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
            </Field>
            <Field label="Linked site" hint="Optional — connects the project to its O&M site">
              <FilterSelect
                value={form.site_id}
                onChange={(v) => setForm({ ...form, site_id: v })}
                options={[['', 'Not linked'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]}
              />
            </Field>
            <Field label="Segment">
              <FilterSelect value={form.segment} onChange={(v) => setForm({ ...form, segment: v })} options={SEGMENTS} />
            </Field>
            <Field label="Type">
              <FilterSelect value={form.project_type} onChange={(v) => setForm({ ...form, project_type: v })} options={PROJECT_TYPES} />
            </Field>
            <Field label="DC capacity (kWp)">
              <Input type="number" value={form.capacity_kwp} onChange={(e) => setForm({ ...form, capacity_kwp: e.target.value })} />
            </Field>
            <Field label="AC capacity (kW)">
              <Input type="number" value={form.capacity_ac_kw} onChange={(e) => setForm({ ...form, capacity_ac_kw: e.target.value })} />
            </Field>
            <Field label="Contract value (₹)">
              <Input type="number" value={form.contract_value} onChange={(e) => setForm({ ...form, contract_value: e.target.value })} />
            </Field>
            <Field label="Stage">
              <FilterSelect
                value={form.stage}
                onChange={(v) => setForm({ ...form, stage: v })}
                options={STAGES.map((s) => [s, STAGE[s].label] as [string, string])}
              />
            </Field>
            <Field label="Start date">
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="Target commissioning">
              <Input type="date" value={form.target_commissioning} onChange={(e) => setForm({ ...form, target_commissioning: e.target.value })} />
            </Field>
            <Field label="District">
              <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
            </Field>
            <Field label="State">
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy}>
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
