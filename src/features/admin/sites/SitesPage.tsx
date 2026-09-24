import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Loader2, MapPin, MoreHorizontal, Pencil, Plus, Power, Sun, Trash2, UserPlus, Users, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtCapacity, fmtDateTime, fmtNumber, safeNum } from '@/lib/format';
import type { Site } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CheckList,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  RecordStatusBadge,
  SearchInput,
  StatCard,
  TableSkeleton,
} from '@/components/common';
import { qk, usePeople, useSites } from '@/features/admin/api';
import { FilterSelect } from '@/features/admin/users/UsersPage';

function useSiteAssignments() {
  return useQuery({
    queryKey: ['site-assignments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_sites').select('site_id, user_id');
      if (error) throw error;
      const bySite: Record<string, string[]> = {};
      for (const r of data ?? []) (bySite[r.site_id] ??= []).push(r.user_id);
      return bySite;
    },
  });
}

export function SitesPage() {
  const can = useCan('admin.sites');
  const qc = useQueryClient();
  const sites = useSites();
  const assignments = useSiteAssignments();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [editing, setEditing] = useState<Site | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [assigning, setAssigning] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState<Site | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (sites.data ?? []).filter(
      (s) =>
        (status === 'all' || s.status === status) &&
        (!q || [s.name, s.code, s.location, s.district, s.state].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [sites.data, search, status]);

  const active = (sites.data ?? []).filter((s) => s.status === 'active');
  const totalCapacity = active.reduce((sum, s) => sum + safeNum(s.capacity_kwp), 0);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: qk.sites });
    await qc.invalidateQueries({ queryKey: ['site-assignments'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  async function toggleStatus(site: Site) {
    const next = site.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('sites').update({ status: next }).eq('id', site.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${site.name} ${next === 'active' ? 'activated' : 'deactivated'}`);
    await refresh();
  }

  async function remove(site: Site) {
    const { error } = await supabase.from('sites').delete().eq('id', site.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${site.name} deleted`);
    await refresh();
  }

  async function onExport() {
    try {
      await exportCsv('admin.sites', `sites-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Site', value: (s) => s.name },
        { header: 'Code', value: (s) => s.code },
        { header: 'Location', value: (s) => s.location },
        { header: 'District', value: (s) => s.district },
        { header: 'State', value: (s) => s.state },
        { header: 'Capacity (kWp)', value: (s) => safeNum(s.capacity_kwp) },
        { header: 'Status', value: (s) => s.status },
        { header: 'Assigned users', value: (s) => assignments.data?.[s.id]?.length ?? 0 },
        { header: 'Updated', value: (s) => fmtDateTime(s.updated_at) },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={MapPin}
        title="Site Management"
        description="Solar sites and who can access them. Site access limits every site-based record in the suite."
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
                <Plus /> Add site
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total sites" value={sites.data?.length ?? 0} icon={MapPin} loading={sites.isLoading} />
        <StatCard label="Active sites" value={active.length} icon={Sun} tone="green" loading={sites.isLoading} />
        <StatCard label="Active capacity" value={fmtCapacity(totalCapacity)} icon={Zap} tone="amber" loading={sites.isLoading} />
        <StatCard
          label="Users with site access"
          value={new Set(Object.values(assignments.data ?? {}).flat()).size}
          hint="Explicit assignments (excludes all-site users)"
          icon={Users}
          tone="blue"
          loading={assignments.isLoading}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search site, code, location…" />
          <div className="w-full sm:w-44">
            <FilterSelect
              value={status}
              onChange={(v) => setStatus(v as typeof status)}
              options={[
                ['all', 'All statuses'],
                ['active', 'Active'],
                ['inactive', 'Inactive'],
              ]}
            />
          </div>
        </div>

        {sites.isLoading ? (
          <TableSkeleton />
        ) : sites.error ? (
          <ErrorState message={errorMessage(sites.error)} onRetry={() => sites.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={sites.data?.length ? 'No sites match your filters' : 'No sites yet'}
            description={can.create && !sites.data?.length ? 'Add your first site to start assigning users.' : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Users</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const count = assignments.data?.[s.id]?.length ?? 0;
                const missing = !safeNum(s.capacity_kwp) || !s.location;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.code ?? '—'}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {[s.location, s.district, s.state].filter(Boolean).join(', ') || (
                        <span className="text-xs text-amber-600">Location not set</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {safeNum(s.capacity_kwp) ? fmtCapacity(s.capacity_kwp) : <span className="text-xs text-amber-600">Not set</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <RecordStatusBadge status={s.status} />
                        {missing && can.edit && <Badge variant="warning">Incomplete</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <button
                        className="flex cursor-pointer items-center gap-1.5 text-sm hover:text-primary"
                        onClick={() => setAssigning(s)}
                        title="View assigned users"
                      >
                        <Users className="h-4 w-4 text-muted-foreground" /> {fmtNumber(count)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-48">
                          <DropdownMenuItem onSelect={() => setAssigning(s)}>
                            <UserPlus /> {can.assign ? 'Assign users' : 'View users'}
                          </DropdownMenuItem>
                          {can.edit && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(s);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => toggleStatus(s)}>
                                <Power /> {s.status === 'active' ? 'Deactivate' : 'Activate'}
                              </DropdownMenuItem>
                            </>
                          )}
                          {can.delete && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem destructive onSelect={() => setDeleting(s)}>
                                <Trash2 /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <SiteFormDialog open={formOpen} onOpenChange={setFormOpen} site={editing} onSaved={refresh} />
      <SiteUsersDialog site={assigning} assigned={assigning ? (assignments.data?.[assigning.id] ?? []) : []} onClose={() => setAssigning(null)} onSaved={refresh} canAssign={can.assign} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Only sites without any linked records can be deleted. To keep history, deactivate the site instead."
        confirmLabel="Delete site"
        destructive
        onConfirm={() => deleting && void remove(deleting)}
      />
    </>
  );
}

// ------------------------------------------------------------------ add / edit
function SiteFormDialog({
  open,
  onOpenChange,
  site,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  site: Site | null;
  onSaved: () => Promise<void>;
}) {
  const empty = { name: '', code: '', location: '', district: '', state: 'Rajasthan', capacity_kwp: '', latitude: '', longitude: '', notes: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(
      site
        ? {
            name: site.name,
            code: site.code ?? '',
            location: site.location ?? '',
            district: site.district ?? '',
            state: site.state ?? '',
            capacity_kwp: safeNum(site.capacity_kwp) ? String(safeNum(site.capacity_kwp)) : '',
            latitude: site.latitude != null ? String(site.latitude) : '',
            longitude: site.longitude != null ? String(site.longitude) : '',
            notes: site.notes ?? '',
          }
        : empty,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, site]);

  const set = (k: keyof typeof empty, v: string) => setF((s) => ({ ...s, [k]: v }));
  const capacityError = f.capacity_kwp && (!Number.isFinite(Number(f.capacity_kwp)) || Number(f.capacity_kwp) < 0) ? 'Enter a positive number.' : null;
  const latError = f.latitude && (Math.abs(Number(f.latitude)) > 90 || !Number.isFinite(Number(f.latitude))) ? 'Between -90 and 90.' : null;
  const lngError = f.longitude && (Math.abs(Number(f.longitude)) > 180 || !Number.isFinite(Number(f.longitude))) ? 'Between -180 and 180.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || capacityError || latError || lngError) return;
    setBusy(true);
    const payload = {
      name: f.name.trim(),
      code: f.code.trim().toUpperCase() || null,
      location: f.location.trim() || null,
      district: f.district.trim() || null,
      state: f.state.trim() || null,
      capacity_kwp: f.capacity_kwp ? Number(f.capacity_kwp) : 0,
      latitude: f.latitude ? Number(f.latitude) : null,
      longitude: f.longitude ? Number(f.longitude) : null,
      notes: f.notes.trim() || null,
    };
    const { error } = site ? await supabase.from('sites').update(payload).eq('id', site.id) : await supabase.from('sites').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(site ? 'Site updated' : 'Site added');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{site ? `Edit ${site.name}` : 'Add site'}</DialogTitle>
          <DialogDescription>Technical plant details (inverters, commissioning) are managed in Solar Sites once O&amp;M is released.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Site name" htmlFor="s_name" required>
            <Input id="s_name" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label="Site code" htmlFor="s_code" hint="Short unique code, e.g. SADAS">
            <Input id="s_code" value={f.code} onChange={(e) => set('code', e.target.value)} />
          </Field>
          <Field label="Capacity (kWp)" htmlFor="s_cap" error={capacityError}>
            <Input id="s_cap" inputMode="decimal" value={f.capacity_kwp} onChange={(e) => set('capacity_kwp', e.target.value)} placeholder="0" />
          </Field>
          <Field label="Location / village" htmlFor="s_loc">
            <Input id="s_loc" value={f.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label="District" htmlFor="s_dist">
            <Input id="s_dist" value={f.district} onChange={(e) => set('district', e.target.value)} />
          </Field>
          <Field label="State" htmlFor="s_state">
            <Input id="s_state" value={f.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <Field label="Latitude" htmlFor="s_lat" error={latError}>
            <Input id="s_lat" inputMode="decimal" value={f.latitude} onChange={(e) => set('latitude', e.target.value)} />
          </Field>
          <Field label="Longitude" htmlFor="s_lng" error={lngError}>
            <Input id="s_lng" inputMode="decimal" value={f.longitude} onChange={(e) => set('longitude', e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="s_notes" className="sm:col-span-2">
            <Textarea id="s_notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !f.name.trim()}>
              {busy && <Loader2 className="animate-spin" />} {site ? 'Save changes' : 'Add site'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ assign users
function SiteUsersDialog({
  site,
  assigned,
  onClose,
  onSaved,
  canAssign,
}: {
  site: Site | null;
  assigned: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  canAssign: boolean;
}) {
  const people = usePeople();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (site) setSelected(assigned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id]);

  async function save() {
    if (!site) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_site_users', { p_site_id: site.id, p_user_ids: selected });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Assignments saved for ${site.name}`);
    await onSaved();
    onClose();
  }

  const assignedPeople = (people.data ?? []).filter((p) => assigned.includes(p.id));

  return (
    <Dialog open={Boolean(site)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{canAssign ? `Assign users to ${site?.name}` : `Users assigned to ${site?.name}`}</DialogTitle>
          <DialogDescription>
            Users with “All sites” access can always see this site and are not listed here.
          </DialogDescription>
        </DialogHeader>
        {canAssign ? (
          <CheckList
            items={people.data ?? []}
            selected={selected}
            onChange={setSelected}
            searchable={(p) => `${p.full_name} ${p.email}`}
            emptyText="No active users yet."
            render={(p) => (
              <span className="block">
                <span className="font-medium">{p.full_name}</span>
                <span className="block text-xs text-muted-foreground">{p.designation ?? p.email}</span>
              </span>
            )}
          />
        ) : assignedPeople.length ? (
          <ul className="divide-y rounded-lg border">
            {assignedPeople.map((p) => (
              <li key={p.id} className="px-3 py-2 text-sm">
                <span className="font-medium">{p.full_name}</span>
                <span className="block text-xs text-muted-foreground">{p.designation ?? p.email}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Users} title="No users assigned" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {canAssign ? 'Cancel' : 'Close'}
          </Button>
          {canAssign && (
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save assignments
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
