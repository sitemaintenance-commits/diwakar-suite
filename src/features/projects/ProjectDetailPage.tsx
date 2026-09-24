// One project, end to end: the execution plan, approvals, materials,
// vendor bills, client money and the site engineer's day-wise update.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, Plus, Send, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtINR, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, Field, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import {
  useApprovals, useBills, useMaterials, usePayments, useProject, useProjectTasks,
  useProjectUpdates, useTemplates, useVendors, type WorkStatus,
} from '@/features/projects/api';
import {
  APPROVAL, APPROVAL_KINDS, BILL, CLIENT_PAY, FRONT_LABELS, MATERIAL, stageOf, WORK, WORK_FRONTS,
} from '@/features/projects/shared';

const TASK_STATUS: [string, string][] = [
  ['todo', 'To do'],
  ['in_progress', 'In progress'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
];

export function ProjectDetailPage() {
  const { id } = useParams();
  const project = useProject(id);
  const p = project.data;

  if (project.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (project.error)
    return (
      <Card>
        <ErrorState message={errorMessage(project.error)} onRetry={() => project.refetch()} />
      </Card>
    );
  if (!p)
    return (
      <Card>
        <EmptyState icon={ArrowLeft} title="Project not found" description="It may have been removed, or you may not have access to it." />
      </Card>
    );

  return (
    <>
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        All projects
      </Link>

      <PageHeader
        title={p.name}
        description={`${p.project_code} · ${p.client_name ?? 'No client recorded'} · ${p.district ?? ''} ${p.state ?? ''}`}
        actions={<Badge variant={stageOf(p.stage).tone}>{stageOf(p.stage).label}</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Capacity" value={fmtCapacity(p.capacity_kwp)} hint={`${fmtNumber(p.capacity_ac_kw)} kW AC`} />
        <StatCard label="Contract value" value={fmtINR(p.contract_value, true)} tone="green" />
        <StatCard label="Started" value={p.start_date ? fmtDate(p.start_date) : '—'} tone="slate" />
        <StatCard
          label="Target commissioning"
          value={p.target_commissioning ? fmtDate(p.target_commissioning) : '—'}
          hint={p.actual_commissioning ? `Commissioned ${fmtDate(p.actual_commissioning)}` : undefined}
          tone="amber"
        />
      </div>

      <Tabs defaultValue="plan" className="mt-6">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="updates">Daily updates</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="bills">Vendor bills</TabsTrigger>
          <TabsTrigger value="money">Client payments</TabsTrigger>
        </TabsList>
        <TabsContent value="plan"><PlanTab projectId={p.id} /></TabsContent>
        <TabsContent value="updates"><UpdatesTab projectId={p.id} /></TabsContent>
        <TabsContent value="approvals"><ApprovalsTab projectId={p.id} /></TabsContent>
        <TabsContent value="materials"><MaterialsTab projectId={p.id} /></TabsContent>
        <TabsContent value="bills"><BillsTab projectId={p.id} /></TabsContent>
        <TabsContent value="money"><PaymentsTab projectId={p.id} /></TabsContent>
      </Tabs>
    </>
  );
}

// -------------------------------------------------------------------- plan
function PlanTab({ projectId }: { projectId: string }) {
  const can = useCan('projects.milestones');
  const qc = useQueryClient();
  const tasks = useProjectTasks(projectId);
  const templates = useTemplates();
  const [templateId, setTemplateId] = useState('');

  async function applyTemplate() {
    if (!templateId) return toast.error('Choose a plan first.');
    const { data, error } = await supabase.rpc('apply_project_template', {
      p_project_id: projectId,
      p_template_id: templateId,
    });
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['project_tasks'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success(`${fmtNumber(data)} task(s) added from the plan.`);
  }

  async function setStatus(taskId: string, status: string) {
    const { error } = await supabase.from('project_tasks').update({ status }).eq('id', taskId);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['project_tasks'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
  }

  const list = tasks.data ?? [];
  const done = list.filter((t) => t.status === 'done').length;

  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle>Execution plan</CardTitle>
          <CardDescription>
            {done}/{list.length} tasks complete
          </CardDescription>
        </div>
        {can.create && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <FilterSelect
                value={templateId}
                onChange={setTemplateId}
                options={(templates.data ?? []).map((t) => [t.id, `${t.name} (${t.project_template_tasks?.length ?? 0} tasks)`] as [string, string])}
                placeholder="Choose a plan template"
              />
            </div>
            <Button size="sm" variant="outline" onClick={applyTemplate}>
              <Plus className="mr-2 h-4 w-4" />
              Apply plan
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!list.length ? (
          <EmptyState icon={Check} title="No tasks yet" description="Apply a plan template to create the standard task list with its due dates." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="w-44">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t, i) => {
                const overdue = t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date(new Date().toDateString());
                return (
                  <TableRow key={t.id}>
                    <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>
                      <Badge variant={stageOf(t.stage).tone}>{stageOf(t.stage).label}</Badge>
                    </TableCell>
                    <TableCell className={overdue ? 'text-destructive' : ''}>
                      {t.due_date ? fmtDate(t.due_date) : '—'}
                      {overdue && ' · overdue'}
                    </TableCell>
                    <TableCell>
                      {can.edit ? (
                        <FilterSelect value={t.status} onChange={(v) => setStatus(t.id, v)} options={TASK_STATUS} />
                      ) : (
                        <Badge variant={t.status === 'done' ? 'success' : 'secondary'}>
                          {TASK_STATUS.find(([k]) => k === t.status)?.[1] ?? t.status}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- updates
const BLANK_FRONTS: Record<string, WorkStatus> = {
  tl_work: 'not_started', gss_bay: 'not_started', piling: 'not_started', panel: 'not_started',
  module_work: 'not_started', inverter: 'not_started', material: 'not_started',
};
const WORK_OPTIONS: [string, string][] = (Object.keys(WORK) as WorkStatus[]).map((k) => [k, WORK[k].label]);

function UpdatesTab({ projectId }: { projectId: string }) {
  const can = useCan('projects.projects');
  const qc = useQueryClient();
  const updates = useProjectUpdates(projectId);
  const [date, setDate] = useState(todayIST());
  const [fronts, setFronts] = useState({ ...BLANK_FRONTS });
  const [work, setWork] = useState('');
  const [challenges, setChallenges] = useState('');
  const [engineer, setEngineer] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the chosen day's update once, so typing is never overwritten.
  useEffect(() => {
    const row = (updates.data ?? []).find((u) => u.update_date === date);
    setFronts(
      row
        ? {
            tl_work: row.tl_work, gss_bay: row.gss_bay, piling: row.piling, panel: row.panel,
            module_work: row.module_work, inverter: row.inverter, material: row.material,
          }
        : { ...BLANK_FRONTS },
    );
    setWork(row?.work_description ?? '');
    setChallenges(row?.challenges ?? '');
    setEngineer(row?.engineer_name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, updates.data?.length]);

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc('save_project_update', {
      p_project_id: projectId,
      p_date: date,
      p_stages: fronts,
      p_work_description: work.trim() || null,
      p_challenges: challenges.trim() || null,
      p_remarks: null,
      p_engineer_name: engineer.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['project_updates'] });
    await qc.invalidateQueries({ queryKey: ['project', projectId] });
    toast.success('Site update saved.');
  }

  return (
    <>
      {can.create && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Day-wise site update</CardTitle>
            <CardDescription>Where each work front stands today</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Date">
                <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Site engineer">
                <Input value={engineer} onChange={(e) => setEngineer(e.target.value)} placeholder="Name" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {WORK_FRONTS.map(([key, label]) => (
                <Field key={key} label={label}>
                  <FilterSelect
                    value={fronts[key]}
                    onChange={(v) => setFronts((f) => ({ ...f, [key]: v as WorkStatus }))}
                    options={WORK_OPTIONS}
                  />
                </Field>
              ))}
            </div>
            <Field label="Work description">
              <Textarea rows={2} value={work} onChange={(e) => setWork(e.target.value)} />
            </Field>
            <Field label="Challenges">
              <Textarea rows={2} value={challenges} onChange={(e) => setChallenges(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button onClick={save} disabled={busy}>
                <Send className="mr-2 h-4 w-4" />
                Save update
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Update history</CardTitle>
          <CardDescription>{fmtNumber(updates.data?.length)} day(s) recorded</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!updates.data?.length ? (
            <EmptyState icon={Send} title="No site updates yet" description="The day's update appears here once it is filed." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Engineer</TableHead>
                    {WORK_FRONTS.map(([k, l]) => (
                      <TableHead key={k}>{l}</TableHead>
                    ))}
                    <TableHead>Work description</TableHead>
                    <TableHead>Challenges</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {updates.data.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="whitespace-nowrap">{fmtDate(u.update_date)}</TableCell>
                      <TableCell className="text-sm">{u.engineer_name ?? '—'}</TableCell>
                      {WORK_FRONTS.map(([k]) => {
                        const v = u[k as keyof typeof FRONT_LABELS] as WorkStatus;
                        return (
                          <TableCell key={k}>
                            <Badge variant={WORK[v].tone}>{WORK[v].label}</Badge>
                          </TableCell>
                        );
                      })}
                      <TableCell className="max-w-[16rem] text-sm">{u.work_description ?? '—'}</TableCell>
                      <TableCell className="max-w-[14rem] text-sm text-muted-foreground">{u.challenges ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// --------------------------------------------------------------- approvals
function ApprovalsTab({ projectId }: { projectId: string }) {
  const can = useCan('projects.approvals');
  const qc = useQueryClient();
  const approvals = useApprovals(projectId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: APPROVAL_KINDS[0], authority: '', reference_no: '', applied_on: '', expected_on: '', status: 'not_started', remarks: '' });

  async function add() {
    const { error } = await supabase.from('project_approvals').insert({
      project_id: projectId,
      kind: form.kind,
      authority: form.authority.trim() || null,
      reference_no: form.reference_no.trim() || null,
      applied_on: form.applied_on || null,
      expected_on: form.expected_on || null,
      status: form.status,
      remarks: form.remarks.trim() || null,
    });
    if (error) return toast.error(errorMessage(error));
    setOpen(false);
    await qc.invalidateQueries({ queryKey: ['project_approvals'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Approval added.');
  }

  async function setStatus(rowId: string, status: string) {
    const patch: Record<string, unknown> = { status };
    if (status === 'approved') patch.approved_on = todayIST();
    const { error } = await supabase.from('project_approvals').update(patch).eq('id', rowId);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['project_approvals'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Approvals</CardTitle>
          <CardDescription>DISCOM, CEIG, net metering, subsidy and the rest</CardDescription>
        </div>
        {can.create && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add approval
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!approvals.data?.length ? (
          <EmptyState icon={Check} title="No approvals tracked" description="Add the approvals this project needs so nothing is forgotten." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Approval</TableHead>
                <TableHead>Authority</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead className="w-44">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.kind}</TableCell>
                  <TableCell className="text-sm">{a.authority ?? '—'}</TableCell>
                  <TableCell className="tabular text-sm">{a.reference_no ?? '—'}</TableCell>
                  <TableCell className="text-sm">{a.applied_on ? fmtDate(a.applied_on) : '—'}</TableCell>
                  <TableCell className="text-sm">{a.expected_on ? fmtDate(a.expected_on) : '—'}</TableCell>
                  <TableCell>
                    {can.edit ? (
                      <FilterSelect
                        value={a.status}
                        onChange={(v) => setStatus(a.id, v)}
                        options={(Object.keys(APPROVAL) as (keyof typeof APPROVAL)[]).map((k) => [k, APPROVAL[k].label])}
                      />
                    ) : (
                      <Badge variant={APPROVAL[a.status].tone}>{APPROVAL[a.status].label}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add approval</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Approval" className="sm:col-span-2">
              <FilterSelect value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={APPROVAL_KINDS.map((k) => [k, k])} />
            </Field>
            <Field label="Authority">
              <Input value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })} />
            </Field>
            <Field label="Reference number">
              <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
            </Field>
            <Field label="Applied on">
              <Input type="date" value={form.applied_on} onChange={(e) => setForm({ ...form, applied_on: e.target.value })} />
            </Field>
            <Field label="Expected on">
              <Input type="date" value={form.expected_on} onChange={(e) => setForm({ ...form, expected_on: e.target.value })} />
            </Field>
            <Field label="Remarks" className="sm:col-span-2">
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --------------------------------------------------------------- materials
function MaterialsTab({ projectId }: { projectId: string }) {
  const can = useCan('projects.materials');
  const qc = useQueryClient();
  const materials = useMaterials(projectId);
  const vendors = useVendors();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ item: '', uom: 'nos', qty_required: '', rate: '', vendor_id: '', status: 'pending', po_no: '', expected_on: '' });

  async function add() {
    if (!form.item.trim()) return toast.error('The item is required.');
    const { error } = await supabase.from('project_materials').insert({
      project_id: projectId,
      item: form.item.trim(),
      uom: form.uom.trim() || 'nos',
      qty_required: safeNum(form.qty_required),
      rate: safeNum(form.rate),
      vendor_id: form.vendor_id || null,
      status: form.status,
      po_no: form.po_no.trim() || null,
      expected_on: form.expected_on || null,
    });
    if (error) return toast.error(errorMessage(error));
    setOpen(false);
    await qc.invalidateQueries({ queryKey: ['project_materials'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Material line added.');
  }

  async function setStatus(rowId: string, status: string) {
    const { error } = await supabase.from('project_materials').update({ status }).eq('id', rowId);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['project_materials'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
  }

  const vendorName = (vid: string | null) => vendors.data?.find((v) => v.id === vid)?.name ?? '—';
  const total = (materials.data ?? []).reduce((n, m) => n + safeNum(m.amount), 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Materials</CardTitle>
          <CardDescription>
            {fmtNumber(materials.data?.length)} line(s) · {fmtINR(total, true)}
          </CardDescription>
        </div>
        {can.create && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add material
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!materials.data?.length ? (
          <EmptyState icon={Check} title="No material lines" description="Add the bill of materials to track dispatch, receipt and shortages." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="w-44">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.item}
                      {m.po_no && <div className="text-xs text-muted-foreground">PO {m.po_no}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{vendorName(m.vendor_id)}</TableCell>
                    <TableCell className="tabular text-right">
                      {fmtNumber(m.qty_required)} {m.uom}
                    </TableCell>
                    <TableCell className="tabular text-right">{fmtNumber(m.qty_received)}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(m.rate)}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(m.amount, true)}</TableCell>
                    <TableCell>
                      {can.edit ? (
                        <FilterSelect
                          value={m.status}
                          onChange={(v) => setStatus(m.id, v)}
                          options={(Object.keys(MATERIAL) as (keyof typeof MATERIAL)[]).map((k) => [k, MATERIAL[k].label])}
                        />
                      ) : (
                        <Badge variant={MATERIAL[m.status].tone}>{MATERIAL[m.status].label}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add material line</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Item" required className="sm:col-span-2">
              <Input value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} />
            </Field>
            <Field label="Quantity">
              <Input type="number" value={form.qty_required} onChange={(e) => setForm({ ...form, qty_required: e.target.value })} />
            </Field>
            <Field label="Unit">
              <Input value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} />
            </Field>
            <Field label="Rate (₹)">
              <Input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </Field>
            <Field label="Vendor">
              <FilterSelect
                value={form.vendor_id}
                onChange={(v) => setForm({ ...form, vendor_id: v })}
                options={[['', 'Not assigned'], ...(vendors.data ?? []).map((v) => [v.id, v.name] as [string, string])]}
              />
            </Field>
            <Field label="PO number">
              <Input value={form.po_no} onChange={(e) => setForm({ ...form, po_no: e.target.value })} />
            </Field>
            <Field label="Expected on">
              <Input type="date" value={form.expected_on} onChange={(e) => setForm({ ...form, expected_on: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ------------------------------------------------------------- vendor bills
function BillsTab({ projectId }: { projectId: string }) {
  const canBill = useCan('projects.bills');
  const canPay = useCan('projects.payments');
  const qc = useQueryClient();
  const bills = useBills(projectId);
  const vendors = useVendors();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', bill_no: '', bill_date: todayIST(), amount: '', deductions: '', description: '' });

  async function add() {
    if (!form.vendor_id || !form.bill_no.trim()) return toast.error('Vendor and bill number are required.');
    const { error } = await supabase.from('vendor_bills').insert({
      project_id: projectId,
      vendor_id: form.vendor_id,
      bill_no: form.bill_no.trim(),
      bill_date: form.bill_date,
      amount: safeNum(form.amount),
      deductions: safeNum(form.deductions),
      description: form.description.trim() || null,
    });
    if (error) return toast.error(errorMessage(error));
    setOpen(false);
    await qc.invalidateQueries({ queryKey: ['vendor_bills'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Bill recorded.');
  }

  async function move(rowId: string, status: string) {
    const { error } = await supabase.from('vendor_bills').update({ status }).eq('id', rowId);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['vendor_bills'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Bill updated.');
  }

  const vendorName = (vid: string) => vendors.data?.find((v) => v.id === vid)?.name ?? '—';

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Vendor bills</CardTitle>
          <CardDescription>Bill verification, project-manager approval, then accounts</CardDescription>
        </div>
        {canBill.create && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add bill
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!bills.data?.length ? (
          <EmptyState icon={Wallet} title="No vendor bills" description="Bills appear here for approval once they are recorded." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net payable</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.data.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.bill_no}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(b.bill_date)}</div>
                    </TableCell>
                    <TableCell className="text-sm">{vendorName(b.vendor_id)}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(b.amount, true)}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(b.deductions, true)}</TableCell>
                    <TableCell className="tabular text-right font-medium">{fmtINR(b.net_amount, true)}</TableCell>
                    <TableCell>
                      <Badge variant={BILL[b.status].tone}>{BILL[b.status].label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status === 'submitted' && canBill.approve && (
                        <Button size="sm" variant="outline" onClick={() => move(b.id, 'pm_approved')}>
                          PM approve
                        </Button>
                      )}
                      {b.status === 'pm_approved' && canPay.approve && (
                        <Button size="sm" variant="outline" onClick={() => move(b.id, 'accounts_approved')}>
                          Accounts approve
                        </Button>
                      )}
                      {b.status === 'accounts_approved' && canPay.approve && (
                        <Button size="sm" onClick={() => move(b.id, 'paid')}>
                          Mark paid
                        </Button>
                      )}
                      {b.status === 'paid' && <span className="text-xs text-muted-foreground">{b.paid_on ? fmtDate(b.paid_on) : ''}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record a vendor bill</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor" required className="sm:col-span-2">
              <FilterSelect
                value={form.vendor_id}
                onChange={(v) => setForm({ ...form, vendor_id: v })}
                options={(vendors.data ?? []).map((v) => [v.id, v.name] as [string, string])}
                placeholder="Choose the vendor"
              />
            </Field>
            <Field label="Bill number" required>
              <Input value={form.bill_no} onChange={(e) => setForm({ ...form, bill_no: e.target.value })} />
            </Field>
            <Field label="Bill date">
              <Input type="date" value={form.bill_date} max={todayIST()} onChange={(e) => setForm({ ...form, bill_date: e.target.value })} />
            </Field>
            <Field label="Amount (₹)">
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Deductions (₹)" hint="Retention, TDS, penalties">
              <Input type="number" value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Record bill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------- client payments
function PaymentsTab({ projectId }: { projectId: string }) {
  const can = useCan('projects.payments');
  const qc = useQueryClient();
  const payments = usePayments(projectId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ milestone: '', invoice_no: '', invoice_date: '', amount: '' });

  const invoiced = (payments.data ?? []).reduce((n, p) => n + safeNum(p.amount), 0);
  const received = (payments.data ?? []).reduce((n, p) => n + safeNum(p.received_amount), 0);

  async function add() {
    if (!form.milestone.trim()) return toast.error('The milestone is required.');
    const { error } = await supabase.from('client_payments').insert({
      project_id: projectId,
      milestone: form.milestone.trim(),
      invoice_no: form.invoice_no.trim() || null,
      invoice_date: form.invoice_date || null,
      amount: safeNum(form.amount),
    });
    if (error) return toast.error(errorMessage(error));
    setOpen(false);
    await qc.invalidateQueries({ queryKey: ['client_payments'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Milestone added.');
  }

  async function receive(rowId: string, amount: string) {
    const { error } = await supabase
      .from('client_payments')
      .update({ received_amount: safeNum(amount), received_on: todayIST() })
      .eq('id', rowId);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['client_payments'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Invoiced" value={fmtINR(invoiced, true)} />
        <StatCard label="Received" value={fmtINR(received, true)} tone="green" />
        <StatCard label="Outstanding" value={fmtINR(invoiced - received, true)} tone={invoiced - received > 0 ? 'amber' : 'slate'} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Client payments</CardTitle>
            <CardDescription>Milestones, invoices and what has actually arrived</CardDescription>
          </div>
          {can.create && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add milestone
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!payments.data?.length ? (
            <EmptyState icon={Wallet} title="No milestones" description="Add the payment milestones so the outstanding figure is real." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead>Status</TableHead>
                  {can.edit && <TableHead className="w-44 text-right">Record receipt</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.milestone}</TableCell>
                    <TableCell className="text-sm">
                      {p.invoice_no ?? '—'}
                      {p.invoice_date && <div className="text-xs text-muted-foreground">{fmtDate(p.invoice_date)}</div>}
                    </TableCell>
                    <TableCell className="tabular text-right">{fmtINR(p.amount, true)}</TableCell>
                    <TableCell className="tabular text-right">{fmtINR(p.received_amount, true)}</TableCell>
                    <TableCell>
                      <Badge variant={CLIENT_PAY[p.status].tone}>{CLIENT_PAY[p.status].label}</Badge>
                    </TableCell>
                    {can.edit && (
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          defaultValue={safeNum(p.received_amount) || ''}
                          onBlur={(e) => receive(p.id, e.target.value)}
                          className="tabular h-8 w-36 text-right"
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add a payment milestone</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Milestone" required className="sm:col-span-2" hint="For example: Supply — 40%">
                <Input value={form.milestone} onChange={(e) => setForm({ ...form, milestone: e.target.value })} />
              </Field>
              <Field label="Invoice number">
                <Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
              </Field>
              <Field label="Invoice date">
                <Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
              </Field>
              <Field label="Amount (₹)" className="sm:col-span-2">
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={add}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </>
  );
}
