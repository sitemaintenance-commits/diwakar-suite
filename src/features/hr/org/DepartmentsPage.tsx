import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Briefcase, Loader2, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import type { Department, Designation, RecordStatus } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog, EmptyState, Field, PageHeader, RecordStatusBadge, TableSkeleton } from '@/components/common';
import { qk, useDepartments, useDesignations } from '@/features/admin/api';
import { FilterSelect } from '@/features/admin/users/UsersPage';

const COLORS = ['#E8740C', '#0284C7', '#0F766E', '#4F46E5', '#F59E0B', '#059669', '#64748B', '#DB2777', '#7C3AED', '#DC2626'];
const NONE = '__none__';

type Editing =
  | { kind: 'department'; row: Department | null }
  | { kind: 'designation'; row: Designation | null }
  | null;

export function DepartmentsPage() {
  const can = useCan('hr.org');
  const qc = useQueryClient();
  const departments = useDepartments();
  const designations = useDesignations();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<{ kind: 'departments' | 'designations'; id: string; name: string } | null>(null);

  const deptName = (id: string | null) => departments.data?.find((d) => d.id === id)?.name ?? '—';

  async function remove() {
    if (!deleting) return;
    const { error } = await supabase.from(deleting.kind).delete().eq('id', deleting.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${deleting.name} deleted`);
    await qc.invalidateQueries({ queryKey: deleting.kind === 'departments' ? qk.departments : qk.designations });
  }

  return (
    <>
      <PageHeader icon={Network} title="Departments" description="Organisation structure used across HR, users and daily reviews." />
      <Tabs defaultValue="departments">
        <TabsList>
          <TabsTrigger value="departments">
            <Network className="h-4 w-4" /> Departments
          </TabsTrigger>
          <TabsTrigger value="designations">
            <Briefcase className="h-4 w-4" /> Designations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <Card>
            <div className="flex items-center justify-between border-b p-4">
              <p className="text-sm text-muted-foreground">{departments.data?.length ?? 0} departments</p>
              {can.create && (
                <Button size="sm" onClick={() => setEditing({ kind: 'department', row: null })}>
                  <Plus /> Add department
                </Button>
              )}
            </div>
            {departments.isLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : !departments.data?.length ? (
              <EmptyState icon={Network} title="No departments yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <span className="flex items-center gap-2.5 font-medium">
                          <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
                          {d.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{d.code ?? '—'}</TableCell>
                      <TableCell>
                        <RecordStatusBadge status={d.status} />
                      </TableCell>
                      <TableCell>
                        <RowActions
                          canEdit={can.edit}
                          canDelete={can.delete}
                          onEdit={() => setEditing({ kind: 'department', row: d })}
                          onDelete={() => setDeleting({ kind: 'departments', id: d.id, name: d.name })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="designations">
          <Card>
            <div className="flex items-center justify-between border-b p-4">
              <p className="text-sm text-muted-foreground">{designations.data?.length ?? 0} designations</p>
              {can.create && (
                <Button size="sm" onClick={() => setEditing({ kind: 'designation', row: null })}>
                  <Plus /> Add designation
                </Button>
              )}
            </div>
            {designations.isLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : !designations.data?.length ? (
              <EmptyState icon={Briefcase} title="No designations yet" description="Add titles such as Site Engineer, O&M Technician or Sales Manager." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Designation</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {designations.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-muted-foreground">{d.department_id ? deptName(d.department_id) : 'Any department'}</TableCell>
                      <TableCell>
                        <RecordStatusBadge status={d.status} />
                      </TableCell>
                      <TableCell>
                        <RowActions
                          canEdit={can.edit}
                          canDelete={can.delete}
                          onEdit={() => setEditing({ kind: 'designation', row: d })}
                          onDelete={() => setDeleting({ kind: 'designations', id: d.id, name: d.name })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <OrgDialog editing={editing} departments={departments.data ?? []} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Employees linked to it will keep their records but lose this value. To keep history, set it to Inactive instead."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}

function RowActions({ canEdit, canDelete, onEdit, onDelete }: { canEdit: boolean; canDelete: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      {canEdit && (
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit">
          <Pencil />
        </Button>
      )}
      {canDelete && (
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete" className="text-destructive hover:text-destructive">
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

function OrgDialog({ editing, departments, onClose }: { editing: Editing; departments: Department[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [departmentId, setDepartmentId] = useState(NONE);
  const [status, setStatus] = useState<RecordStatus>('active');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setName(editing.row?.name ?? '');
    setStatus(editing.row?.status ?? 'active');
    if (editing.kind === 'department') {
      setCode(editing.row?.code ?? '');
      setColor(editing.row?.color ?? COLORS[0]);
    } else {
      setDepartmentId(editing.row?.department_id ?? NONE);
    }
  }, [editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing || !name.trim()) return;
    setBusy(true);
    const table = editing.kind === 'department' ? 'departments' : 'designations';
    const payload: Record<string, unknown> =
      editing.kind === 'department'
        ? { name: name.trim(), code: code.trim().toUpperCase() || null, color, status }
        : { name: name.trim(), department_id: departmentId === NONE ? null : departmentId, status };
    const { error } = editing.row
      ? await supabase.from(table).update(payload).eq('id', editing.row.id)
      : await supabase.from(table).insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${name.trim()} saved`);
    await qc.invalidateQueries({ queryKey: editing.kind === 'department' ? qk.departments : qk.designations });
    onClose();
  }

  const noun = editing?.kind === 'designation' ? 'designation' : 'department';

  return (
    <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing?.row ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name" htmlFor="o_name" required>
            <Input id="o_name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          {editing?.kind === 'department' ? (
            <>
              <Field label="Code" htmlFor="o_code">
                <Input id="o_code" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field label="Colour">
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-7 w-7 cursor-pointer rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-slate-900' : ''}`}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                    />
                  ))}
                </div>
              </Field>
            </>
          ) : (
            <Field label="Department" hint="Optional — limits where this designation is offered.">
              <FilterSelect
                value={departmentId}
                onChange={setDepartmentId}
                options={[[NONE, 'Any department'], ...departments.map((d) => [d.id, d.name] as [string, string])]}
              />
            </Field>
          )}
          <Field label="Status">
            <FilterSelect
              value={status}
              onChange={(v) => setStatus(v as RecordStatus)}
              options={[
                ['active', 'Active'],
                ['inactive', 'Inactive'],
              ]}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
