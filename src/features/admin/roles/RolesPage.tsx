import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Lock, Pencil, Plus, RotateCcw, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { PERM_ACTIONS, type ModuleRow, type PermAction, type PermScope, type Role } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { ACTION_LABELS, BUILT_MODULES } from '@/app/registry';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog, EmptyState, ErrorState, Field, PageHeader } from '@/components/common';
import { qk, useModulesCatalogue, useRolePermissions, useRoles, useRoleUserCounts } from '@/features/admin/api';

type Grants = Record<string, Set<PermAction>>; // module_id -> actions
type Scopes = Record<string, PermScope>; // module_id -> scope

const SCOPE_LABEL: Record<PermScope, string> = { own: 'Own records', team: 'Team', all: 'All records' };

export function RolesPage() {
  const can = useCan('admin.roles');
  const { access } = useAccess();
  const qc = useQueryClient();
  const roles = useRoles();
  const counts = useRoleUserCounts();
  const modules = useModulesCatalogue();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; role: Role | null }>({ open: false, role: null });
  const [deleting, setDeleting] = useState<Role | null>(null);

  useEffect(() => {
    if (!selectedId && roles.data?.length) setSelectedId(roles.data[0].id);
  }, [roles.data, selectedId]);

  const selected = roles.data?.find((r) => r.id === selectedId) ?? null;

  async function deleteRole(role: Role) {
    const { error } = await supabase.from('roles').delete().eq('id', role.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Role "${role.name}" deleted`);
    setSelectedId(null);
    await qc.invalidateQueries({ queryKey: qk.roles });
  }

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="Role Management"
        description="Define what each role can see and do. A user's access is the combination of all their roles."
        actions={
          can.create && (
            <Button onClick={() => setRoleDialog({ open: true, role: null })}>
              <Plus /> Create role
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
        {/* Roles list */}
        <Card className="h-fit overflow-hidden">
          <div className="border-b px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</div>
          {roles.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y overflow-y-auto">
              {roles.data?.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60',
                      r.id === selectedId && 'bg-primary-soft hover:bg-primary-soft',
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn('block truncate font-medium', r.id === selectedId && 'text-primary')}>{r.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" /> {counts.data?.[r.id] ?? 0} user{(counts.data?.[r.id] ?? 0) === 1 ? '' : 's'}
                      </span>
                    </span>
                    {r.is_system ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : !r.is_active ? (
                      <Badge variant="secondary">Inactive</Badge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Matrix */}
        <div className="min-w-0">
          {!selected ? (
            <Card>
              <EmptyState icon={ShieldCheck} title="Select a role" />
            </Card>
          ) : modules.error ? (
            <Card>
              <ErrorState message={errorMessage(modules.error)} />
            </Card>
          ) : (
            <PermissionMatrix
              key={selected.id}
              role={selected}
              modules={modules.data ?? []}
              modulesLoading={modules.isLoading}
              readOnly={!can.edit || selected.is_system}
              userCount={counts.data?.[selected.id] ?? 0}
              callerIsSuper={access?.is_super_admin ?? false}
              onEdit={can.edit && !selected.is_system ? () => setRoleDialog({ open: true, role: selected }) : undefined}
              onDelete={can.delete && !selected.is_system ? () => setDeleting(selected) : undefined}
            />
          )}
        </div>
      </div>

      <RoleDialog
        open={roleDialog.open}
        role={roleDialog.role}
        onOpenChange={(o) => setRoleDialog((s) => ({ ...s, open: o }))}
        onSaved={(id) => setSelectedId(id)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete role "${deleting?.name}"?`}
        description={
          (counts.data?.[deleting?.id ?? ''] ?? 0) > 0
            ? 'This role is still assigned to users. Remove it from those users first, then delete it.'
            : 'This custom role and its permission matrix will be removed. This cannot be undone.'
        }
        confirmLabel="Delete role"
        destructive
        onConfirm={() => deleting && void deleteRole(deleting)}
      />
    </>
  );
}

// ------------------------------------------------------------------ matrix
function PermissionMatrix({
  role,
  modules,
  modulesLoading,
  readOnly,
  userCount,
  callerIsSuper,
  onEdit,
  onDelete,
}: {
  role: Role;
  modules: ModuleRow[];
  modulesLoading: boolean;
  readOnly: boolean;
  userCount: number;
  callerIsSuper: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const qc = useQueryClient();
  const { can: callerCan } = useAccess();
  const perms = useRolePermissions(role.id);
  const [grants, setGrants] = useState<Grants>({});
  const [scopes, setScopes] = useState<Scopes>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    const g: Grants = {};
    const s: Scopes = {};
    if (role.is_system) {
      for (const m of modules) {
        g[m.id] = new Set(m.supported_actions);
        s[m.id] = 'all';
      }
    } else {
      for (const p of perms.data ?? []) {
        (g[p.module_id] ??= new Set()).add(p.action);
        const prev = s[p.module_id];
        if (!prev || (prev === 'own' && p.scope !== 'own') || (prev === 'team' && p.scope === 'all')) s[p.module_id] = p.scope;
      }
    }
    setGrants(g);
    setScopes(s);
    setDirty(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [perms.data, modules, role.is_system]);

  // Non-super-admins cannot grant what they do not hold (the DB enforces this too).
  const grantable = (m: ModuleRow, a: PermAction) => callerIsSuper || callerCan(m.key, a) || grants[m.id]?.has(a);

  const toggle = (m: ModuleRow, a: PermAction, on: boolean) => {
    setGrants((g) => {
      const next = { ...g, [m.id]: new Set(g[m.id] ?? []) };
      if (on) {
        next[m.id].add(a);
        if (a !== 'view') next[m.id].add('view'); // any action implies view
      } else {
        next[m.id].delete(a);
        if (a === 'view') next[m.id].clear(); // no view => nothing else is usable
      }
      return next;
    });
    setDirty(true);
  };

  const rowState = (m: ModuleRow): boolean | 'indeterminate' => {
    const n = grants[m.id]?.size ?? 0;
    return n === 0 ? false : n >= m.supported_actions.length ? true : 'indeterminate';
  };
  const setRow = (m: ModuleRow, on: boolean) => {
    setGrants((g) => ({ ...g, [m.id]: new Set(on ? m.supported_actions.filter((a) => grantable(m, a)) : []) }));
    setDirty(true);
  };

  const colModules = (a: PermAction) => modules.filter((m) => m.supported_actions.includes(a));
  const colState = (a: PermAction): boolean | 'indeterminate' => {
    const ms = colModules(a);
    const on = ms.filter((m) => grants[m.id]?.has(a)).length;
    return on === 0 ? false : on === ms.length ? true : 'indeterminate';
  };
  const setCol = (a: PermAction, on: boolean) => {
    setGrants((g) => {
      const next = { ...g };
      for (const m of colModules(a)) {
        if (on && !grantable(m, a)) continue;
        next[m.id] = new Set(next[m.id] ?? []);
        if (on) {
          next[m.id].add(a);
          next[m.id].add('view');
        } else {
          next[m.id].delete(a);
          if (a === 'view') next[m.id].clear();
        }
      }
      return next;
    });
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    const payload = modules.flatMap((m) =>
      [...(grants[m.id] ?? [])].map((action) => ({ module: m.key, action, scope: m.supports_scope ? (scopes[m.id] ?? 'all') : 'all' })),
    );
    const { error } = await supabase.rpc('set_role_permissions', { p_role_id: role.id, p_grants: payload });
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Permissions saved for ${role.name}`);
    await qc.invalidateQueries({ queryKey: qk.rolePermissions(role.id) });
    await qc.invalidateQueries({ queryKey: ['my-access'] });
  }

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: ModuleRow[] }[] = [];
    for (const m of modules) {
      const key = m.module_groups?.key ?? 'other';
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, label: m.module_groups?.label ?? 'Other', items: [] }));
      g.items.push(m);
    }
    return out;
  }, [modules]);

  const loading = modulesLoading || perms.isLoading;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{role.name}</h2>
            {role.is_system && (
              <Badge>
                <Lock className="h-3 w-3" /> System role
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {role.description || 'No description'} · {userCount} user{userCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil /> Edit role
            </Button>
          )}
          {onDelete && (
            <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>

      {role.is_system && (
        <div className="flex items-center gap-2 border-b bg-primary-soft/60 px-5 py-2.5 text-sm text-accent-foreground">
          <Lock className="h-4 w-4" /> Super Admin always has full access to every module. These permissions cannot be changed.
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="sticky top-0 bg-slate-50/95">
              <tr className="border-b">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Module</th>
                {PERM_ACTIONS.map((a) => (
                  <th key={a} className="w-[62px] px-1 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <div className="flex flex-col items-center gap-1.5">
                      {ACTION_LABELS[a]}
                      {!readOnly && (
                        <Checkbox
                          checked={colState(a)}
                          onCheckedChange={(v) => setCol(a, v === true)}
                          aria-label={`Select all ${ACTION_LABELS[a]}`}
                        />
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data scope</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows
                  key={g.key}
                  label={g.label}
                  items={g.items}
                  grants={grants}
                  scopes={scopes}
                  readOnly={readOnly}
                  grantable={grantable}
                  toggle={toggle}
                  rowState={rowState}
                  setRow={setRow}
                  setScope={(id, s) => {
                    setScopes((x) => ({ ...x, [id]: s }));
                    setDirty(true);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-card/95 px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Granting any action also grants View. Changes apply to every user with this role on their next page load.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={!dirty || saving}>
              <RotateCcw /> Reset
            </Button>
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Save permissions
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function GroupRows({
  label,
  items,
  grants,
  scopes,
  readOnly,
  grantable,
  toggle,
  rowState,
  setRow,
  setScope,
}: {
  label: string;
  items: ModuleRow[];
  grants: Grants;
  scopes: Scopes;
  readOnly: boolean;
  grantable: (m: ModuleRow, a: PermAction) => boolean;
  toggle: (m: ModuleRow, a: PermAction, on: boolean) => void;
  rowState: (m: ModuleRow) => boolean | 'indeterminate';
  setRow: (m: ModuleRow, on: boolean) => void;
  setScope: (moduleId: string, s: PermScope) => void;
}) {
  return (
    <>
      <tr className="border-b bg-slate-50/60">
        <td colSpan={PERM_ACTIONS.length + 2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </td>
      </tr>
      {items.map((m) => {
        const built = BUILT_MODULES.has(m.key);
        const hasAny = (grants[m.id]?.size ?? 0) > 0;
        return (
          <tr key={m.id} className="border-b last:border-0 hover:bg-slate-50/50">
            <td className="px-5 py-2.5">
              <div className="flex items-center gap-3">
                {!readOnly && (
                  <Checkbox checked={rowState(m)} onCheckedChange={(v) => setRow(m, v === true)} aria-label={`Select all for ${m.label}`} />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium">
                    {m.label}
                    {!m.is_enabled && <Badge variant="secondary">{built ? 'Disabled' : `Phase ${m.phase}`}</Badge>}
                    {m.is_site_scoped && <Badge variant="info">Site-scoped</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.key}</div>
                </div>
              </div>
            </td>
            {PERM_ACTIONS.map((a) => (
              <td key={a} className="px-2 py-2.5 text-center">
                {m.supported_actions.includes(a) ? (
                  <Checkbox
                    checked={grants[m.id]?.has(a) ?? false}
                    disabled={readOnly || !grantable(m, a)}
                    onCheckedChange={(v) => toggle(m, a, v === true)}
                    aria-label={`${m.label} ${ACTION_LABELS[a]}`}
                  />
                ) : (
                  <span className="text-slate-300">–</span>
                )}
              </td>
            ))}
            <td className="px-3 py-2">
              {m.supports_scope ? (
                <Select
                  value={scopes[m.id] ?? 'all'}
                  onValueChange={(v) => setScope(m.id, v as PermScope)}
                  disabled={readOnly || !hasAny}
                >
                  <SelectTrigger className="h-8 w-[118px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['own', 'team', 'all'] as PermScope[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {SCOPE_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs text-muted-foreground">{m.is_site_scoped ? 'Assigned sites' : '—'}</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ create / edit role
function RoleDialog({
  open,
  role,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  role: Role | null;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(role?.name ?? '');
      setDescription(role?.description ?? '');
      setActive(role?.is_active ?? true);
    }
  }, [open, role]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const key =
      role?.key ??
      (name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^(\d)/, 'r_$1') || `role_${Date.now()}`);
    const res = role
      ? await supabase.from('roles').update({ name: name.trim(), description: description.trim() || null, is_active: active }).eq('id', role.id).select('id').single()
      : await supabase.from('roles').insert({ key, name: name.trim(), description: description.trim() || null }).select('id').single();
    setBusy(false);
    if (res.error) return toast.error(errorMessage(res.error));
    toast.success(role ? 'Role updated' : 'Role created — now choose its permissions');
    await qc.invalidateQueries({ queryKey: qk.roles });
    onSaved(res.data.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{role ? 'Edit role' : 'Create role'}</DialogTitle>
          <DialogDescription>Roles are reusable permission sets. Assign them to users in User Management.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Role name" htmlFor="r_name" required>
            <Input id="r_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Site Supervisor" autoFocus />
          </Field>
          <Field label="Description" htmlFor="r_desc">
            <Textarea id="r_desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          {role && (
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
              Role is active (inactive roles grant no permissions)
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />} {role ? 'Save' : 'Create role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
