import { useState } from 'react';
import { toast } from 'sonner';
import { Download, FileSearch, RotateCcw, ScrollText } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDateTime, titleCase } from '@/lib/format';
import type { AuditLog } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Field, PageHeader, Pagination, SearchInput, TableSkeleton } from '@/components/common';
import { fetchAudit, useAudit, usePeople, type AuditFilters } from '@/features/admin/api';
import { FilterSelect } from '@/features/admin/users/UsersPage';

const PAGE_SIZE = 50;

const ACTIONS: [string, string][] = [
  ['all', 'All actions'],
  ['login', 'Login'],
  ['logout', 'Logout'],
  ['create', 'Record created'],
  ['update', 'Record modified'],
  ['delete', 'Record deleted'],
  ['user.create', 'User created'],
  ['user.invite', 'User invited'],
  ['user.activate', 'User activated'],
  ['user.deactivate', 'User deactivated'],
  ['user.password_reset', 'Password reset sent'],
  ['role.assign', 'Role assignment'],
  ['permission.change', 'Permission change'],
  ['site.assign', 'Site assignment'],
  ['approve', 'Approval'],
  ['export', 'Data export'],
  ['password.change', 'Password changed'],
];

function actionTone(action: string): BadgeProps['variant'] {
  if (action === 'login' || action === 'logout') return 'info';
  if (action.includes('delete') || action.includes('deactivate')) return 'destructive';
  if (action.startsWith('permission') || action.startsWith('role') || action.startsWith('site')) return 'default';
  if (action === 'create' || action.includes('create') || action.includes('activate')) return 'success';
  if (action === 'export') return 'warning';
  return 'secondary';
}

const EMPTY: AuditFilters = { search: '', actorId: 'all', module: 'all', action: 'all', from: '', to: '', page: 0, pageSize: PAGE_SIZE };

export function AuditLogPage() {
  const can = useCan('admin.audit');
  const { access } = useAccess();
  const people = usePeople();
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const audit = useAudit(filters);
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const update = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));

  const moduleOptions: [string, string][] = [
    ['all', 'All modules'],
    ['auth', 'Authentication'],
    ...(access?.modules ?? []).map((m) => [m.key, m.label] as [string, string]),
  ];

  async function onExport() {
    try {
      const { rows } = await fetchAudit(filters, true);
      await exportCsv('admin.audit', `audit-log-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Time (IST)', value: (r) => fmtDateTime(r.occurred_at) },
        { header: 'User', value: (r) => r.actor_name ?? 'System' },
        { header: 'Email', value: (r) => r.actor_email },
        { header: 'Action', value: (r) => r.action },
        { header: 'Module', value: (r) => r.module_key },
        { header: 'Record', value: (r) => (r.entity_table ? `${r.entity_table}:${r.entity_id ?? ''}` : '') },
        { header: 'Summary', value: (r) => r.summary },
        { header: 'Changes', value: (r) => r.changes },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const filtered = JSON.stringify({ ...filters, page: 0 }) !== JSON.stringify(EMPTY);

  return (
    <>
      <PageHeader
        icon={ScrollText}
        title="Audit Log"
        description="Tamper-proof record of sign-ins, administration and data changes. Entries cannot be edited or deleted."
        actions={
          can.export && (
            <Button variant="outline" onClick={onExport}>
              <Download /> Export
            </Button>
          )
        }
      />

      <Card>
        <div className="grid gap-3 border-b p-4 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_0.8fr_auto] xl:items-end">
          <Field label="Search">
            <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Summary, user…" className="sm:w-full" />
          </Field>
          <Field label="User">
            <FilterSelect
              value={filters.actorId}
              onChange={(v) => update({ actorId: v })}
              options={[['all', 'All users'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
            />
          </Field>
          <Field label="Module">
            <FilterSelect value={filters.module} onChange={(v) => update({ module: v })} options={moduleOptions} />
          </Field>
          <Field label="Action">
            <FilterSelect value={filters.action} onChange={(v) => update({ action: v })} options={ACTIONS} />
          </Field>
          <Field label="From">
            <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
          </Field>
          <Button variant="ghost" disabled={!filtered} onClick={() => setFilters(EMPTY)}>
            <RotateCcw /> Reset
          </Button>
        </div>

        {audit.isLoading ? (
          <TableSkeleton rows={10} />
        ) : audit.error ? (
          <ErrorState message={errorMessage(audit.error)} onRetry={() => audit.refetch()} />
        ) : !audit.data?.rows.length ? (
          <EmptyState icon={FileSearch} title="No audit entries" description={filtered ? 'No entries match these filters.' : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Time (IST)</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="hidden md:table-cell">Module</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.data.rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetail(r)}>
                  <TableCell className="tabular whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(r.occurred_at)}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{r.actor_name ?? 'System'}</div>
                    <div className="text-xs text-muted-foreground">{r.actor_email ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionTone(r.action)}>{titleCase(r.action)}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{r.module_key ?? '—'}</TableCell>
                  <TableCell className="max-w-md truncate text-sm">{r.summary ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={audit.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.summary ?? titleCase(detail?.action)}</DialogTitle>
            <DialogDescription>
              {fmtDateTime(detail?.occurred_at)} · {detail?.actor_name ?? 'System'} {detail?.actor_email ? `(${detail.actor_email})` : ''}
            </DialogDescription>
          </DialogHeader>
          {detail && <AuditDetail log={detail} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function AuditDetail({ log }: { log: AuditLog }) {
  const changes = log.changes as Record<string, unknown> | null;
  const isDiff =
    changes && typeof changes === 'object' && !Array.isArray(changes) && Object.values(changes).every((v) => v && typeof v === 'object' && ('from' in (v as object) || 'changed' in (v as object)));

  return (
    <div className="grid gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Action</dt>
          <dd className="font-medium">{log.action}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Module</dt>
          <dd className="font-medium">{log.module_key ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Table</dt>
          <dd className="font-medium">{log.entity_table ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Record ID</dt>
          <dd className="truncate font-mono">{log.entity_id ?? '—'}</dd>
        </div>
      </dl>
      {!changes ? (
        <p className="text-muted-foreground">No field-level details recorded.</p>
      ) : isDiff ? (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Field</th>
                <th className="px-3 py-2 text-left font-semibold">Before</th>
                <th className="px-3 py-2 text-left font-semibold">After</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {Object.entries(changes).map(([field, v]) => {
                const d = v as { from?: unknown; to?: unknown; changed?: boolean };
                return (
                  <tr key={field}>
                    <td className="px-3 py-2 font-medium">{field}</td>
                    <td className="break-all px-3 py-2 text-red-700">{d.changed ? '(hidden)' : show(d.from)}</td>
                    <td className="break-all px-3 py-2 text-green-700">{d.changed ? '(changed)' : show(d.to)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(changes, null, 2)}</pre>
      )}
      {log.user_agent && <p className="truncate text-xs text-muted-foreground">Client: {log.user_agent}</p>}
    </div>
  );
}
