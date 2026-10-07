// Workflow settings (admins): the approval levels for each type of
// request, and the department heads that "Department Head" levels go to.
// A request copies its levels when submitted, so changes here apply to
// new submissions only.
import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Pencil, Plus, Save, Settings2, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDateTime } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Field, PageHeader, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import {
  CATEGORIES, approvalKeys, saveWorkflow, setDepartmentHead, useApprovalSettings,
  type ApprovalSettings, type Workflow, type WorkflowLevel,
} from '@/features/approvals/api';

const DEFAULT = '__default__';
const NONE = '__none__';

export function WorkflowSettingsPage() {
  const settings = useApprovalSettings();
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null);
  const s = settings.data;

  return (
    <>
      <Link to="/approvals" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Approvals
      </Link>
      <PageHeader
        icon={Settings2}
        title="Approval workflow settings"
        description="The levels each type of request goes through. Changes apply to requests submitted from now on; requests already in approval keep their levels."
        actions={s && <Button onClick={() => setEditing('new')}><Plus /> New workflow</Button>}
      />

      {settings.isLoading ? (
        <Card><TableSkeleton rows={5} cols={3} /></Card>
      ) : settings.error || !s ? (
        <Card><ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid content-start gap-3 lg:col-span-2">
            {s.workflows.length === 0 && (
              <Card><EmptyState icon={WorkflowIcon} title="No workflows yet" description="Add the default workflow first; types without their own use it." /></Card>
            )}
            {s.workflows.map((w) => (
              <Card key={w.id} className={w.is_active ? 'p-5' : 'p-5 opacity-60'}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{w.name}</h2>
                      <Badge variant={w.category ? 'default' : 'info'}>{w.category ? CATEGORIES[w.category] ?? w.category : 'Default · any other type'}</Badge>
                      {!w.is_active && <Badge variant="secondary">Off</Badge>}
                    </div>
                    {w.description && <p className="mt-0.5 text-sm text-muted-foreground">{w.description}</p>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setEditing(w)}><Pencil /> Edit</Button>
                </div>
                <ol className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {w.levels.map((l, i) => (
                    <li key={l.id ?? i} className="flex items-center gap-2">
                      {i > 0 && <span className="text-muted-foreground">→</span>}
                      <span className="rounded-lg border bg-muted/40 px-2.5 py-1">
                        <span className="font-medium">L{l.level_no} {l.name}</span>
                        <span className="block text-xs text-muted-foreground">{l.approver ?? '—'}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">Updated {fmtDateTime(w.updated_at)}</p>
              </Card>
            ))}
          </div>
          <DepartmentHeads s={s} />
        </div>
      )}

      {editing && s && (
        <WorkflowDialog workflow={editing === 'new' ? null : editing} settings={s} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function DepartmentHeads({ s }: { s: ApprovalSettings }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const roleless = s.roles.filter((r) => ['finance', 'director'].includes(r.key) && r.members === 0);
  async function change(dept: string, emp: string) {
    setBusy(dept);
    try {
      await setDepartmentHead(dept, emp === NONE ? null : emp);
      await qc.invalidateQueries({ queryKey: approvalKeys.settings });
      toast.success('Department head saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="grid content-start gap-4">
      {roleless.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Nobody has the {roleless.map((r) => r.name).join(' or ')} role yet, so those levels wait for an admin to assign someone.
          Give the role to the right people in <Link to="/admin/users" className="font-medium underline">Users</Link>.
        </Card>
      )}
      <Card className="p-5">
        <h2 className="font-semibold">Department heads</h2>
        <p className="mb-3 text-sm text-muted-foreground">A “Department Head” level goes to the head of the requester’s department.</p>
        <div className="grid gap-3">
          {s.departments.map((d) => (
            <Field key={d.id} label={d.name}>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <FilterSelect value={d.head_employee_id ?? NONE} onChange={(v) => void change(d.id, v)}
                    options={[[NONE, 'No head set'], ...s.employees.map((e) => [e.id, `${e.name}${e.has_login ? '' : ' (no login)'}`] as [string, string])]} />
                </div>
                {busy === d.id && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
            </Field>
          ))}
        </div>
      </Card>
    </div>
  );
}

function WorkflowDialog({ workflow, settings, onClose }: { workflow: Workflow | null; settings: ApprovalSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(workflow?.name ?? '');
  const [category, setCategory] = useState(workflow ? workflow.category ?? DEFAULT : 'purchase');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [active, setActive] = useState(workflow?.is_active ?? true);
  const [levels, setLevels] = useState<WorkflowLevel[]>(
    workflow?.levels.map((l) => ({ ...l })) ?? [{ name: 'Department Head', approver_type: 'department_head', approver_employee_id: null, approver_role_id: null }],
  );
  const [busy, setBusy] = useState(false);

  const setLevel = (i: number, patch: Partial<WorkflowLevel>) => setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, by: number) => setLevels((ls) => {
    const next = [...ls];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    return next;
  });

  async function save() {
    setBusy(true);
    try {
      await saveWorkflow({ id: workflow?.id, name, category: category === DEFAULT ? null : category, description, is_active: active, levels });
      await qc.invalidateQueries({ queryKey: ['approvals'] });
      toast.success('Workflow saved');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{workflow ? `Edit ${workflow.name}` : 'New workflow'}</DialogTitle>
          <DialogDescription>Levels approve in order: Level 2 opens only after Level 1 approves.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Purchase approval" /></Field>
          <Field label="Used for">
            <FilterSelect value={category} onChange={setCategory}
              options={[[DEFAULT, 'Default (any type without its own)'], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v] as [string, string])]} />
          </Field>
          <Field label="Description" className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} /> In use
          </label>
        </div>

        <div className="grid gap-2">
          <div className="text-sm font-semibold">Approval levels</div>
          {levels.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_1fr_1fr_auto] sm:items-end">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{i + 1}</div>
              <Field label="Level name"><Input value={l.name} onChange={(e) => setLevel(i, { name: e.target.value })} placeholder="e.g. Finance Head" /></Field>
              <Field label="Approved by">
                <FilterSelect value={l.approver_type} onChange={(v) => setLevel(i, { approver_type: v as WorkflowLevel['approver_type'] })}
                  options={[['department_head', 'Requester’s department head'], ['employee', 'A specific person'], ['role', 'Anyone with a role']]} />
              </Field>
              <Field label={l.approver_type === 'role' ? 'Role' : 'Person'}>
                {l.approver_type === 'department_head' ? (
                  <Input value="Set per department" disabled />
                ) : l.approver_type === 'employee' ? (
                  <FilterSelect value={l.approver_employee_id ?? ''} onChange={(v) => setLevel(i, { approver_employee_id: v })} placeholder="Choose"
                    options={settings.employees.map((e) => [e.id, `${e.name}${e.has_login ? '' : ' (no login)'}`] as [string, string])} />
                ) : (
                  <FilterSelect value={l.approver_role_id ?? ''} onChange={(v) => setLevel(i, { approver_role_id: v })} placeholder="Choose"
                    options={settings.roles.map((r) => [r.id, `${r.name} (${r.members})`] as [string, string])} />
                )}
              </Field>
              <div className="flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === levels.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label="Remove level" disabled={levels.length === 1}
                  onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="justify-self-start" disabled={levels.length >= 20}
            onClick={() => setLevels((ls) => [...ls, { name: '', approver_type: 'role', approver_employee_id: null, approver_role_id: null }])}>
            <Plus /> Add level
          </Button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="animate-spin" /> : <Save />} Save workflow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
