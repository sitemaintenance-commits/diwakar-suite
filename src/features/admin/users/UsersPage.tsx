import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Eye, KeyRound, MailPlus, MoreHorizontal, Pencil, Power, UserCog, UserPlus, Users } from 'lucide-react';
import { callAdminUsers } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import type { UserRow, UserStatus } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  StatCard,
  TableSkeleton,
  UserAvatar,
  UserStatusBadge,
} from '@/components/common';
import { fetchUsers, useDepartments, useRoles, useSites, useUsers, type UserFilters } from '@/features/admin/api';
import { UserFormDialog } from '@/features/admin/users/UserFormDialog';
import { UserDetailSheet } from '@/features/admin/users/UserDetailSheet';
import { useDashboardSummary } from '@/features/dashboard/api';

const PAGE_SIZE = 20;

export function UsersPage() {
  const can = useCan('admin.users');
  const { access } = useAccess();
  const qc = useQueryClient();
  const roles = useRoles();
  const sites = useSites();
  const departments = useDepartments();
  const summary = useDashboardSummary();

  const [filters, setFilters] = useState<UserFilters>({
    search: '',
    status: 'all',
    roleId: 'all',
    departmentId: 'all',
    siteId: 'all',
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const users = useUsers(filters);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserRow | null>(null);

  const update = (patch: Partial<UserFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  const me = access?.profile?.id;
  const callerIsSuper = access?.is_super_admin ?? false;
  const isProtected = (u: UserRow) => u.user_roles.some((r) => r.roles?.is_system) && !callerIsSuper;

  async function changeStatus(u: UserRow) {
    const next: UserStatus = u.status === 'inactive' ? 'active' : 'inactive';
    try {
      await callAdminUsers({ action: 'set_status', user_id: u.id, status: next });
      toast.success(next === 'active' ? `${u.full_name} activated` : `${u.full_name} deactivated and signed out`);
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function sendReset(u: UserRow) {
    try {
      await callAdminUsers({ action: 'reset_password', user_id: u.id, redirect_to: `${window.location.origin}/reset-password` });
      toast.success(`Password reset email sent to ${u.email}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function resendInvite(u: UserRow) {
    try {
      await callAdminUsers({ action: 'resend_invite', user_id: u.id, redirect_to: `${window.location.origin}/reset-password` });
      toast.success(`Invitation re-sent to ${u.email}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function onExport() {
    try {
      const { rows } = await fetchUsers(filters, true);
      await exportCsv('admin.users', `users-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Full Name', value: (r) => r.full_name },
        { header: 'Email', value: (r) => r.email },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Employee ID', value: (r) => r.employees?.employee_code },
        { header: 'Department', value: (r) => r.employees?.departments?.name },
        { header: 'Designation', value: (r) => r.employees?.designations?.name },
        { header: 'Status', value: (r) => r.status },
        { header: 'Roles', value: (r) => r.user_roles.map((x) => x.roles?.name) },
        { header: 'Sites', value: (r) => (r.all_sites ? 'All sites' : r.user_sites.map((x) => x.sites?.name)) },
        { header: 'Joining Date', value: (r) => r.employees?.joining_date },
        { header: 'Created', value: (r) => fmtDateTime(r.created_at) },
        { header: 'Last Login', value: (r) => fmtDateTime(r.last_login_at, '') },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const u = summary.data?.users;

  return (
    <>
      <PageHeader
        icon={UserCog}
        title="User Management"
        description="Accounts, roles, departments and site access for everyone using the suite."
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
                <UserPlus /> Add user
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total users" value={u?.total ?? 0} icon={Users} loading={summary.isLoading} />
        <StatCard label="Active" value={u?.active ?? 0} icon={Power} tone="green" loading={summary.isLoading} />
        <StatCard label="Pending invitations" value={u?.invited ?? 0} icon={MailPlus} tone="blue" loading={summary.isLoading} />
        <StatCard label="Inactive" value={u?.inactive ?? 0} icon={Power} tone="slate" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Search name, email, phone…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v as UserFilters['status'] })}
              placeholder="Status"
              options={[
                ['all', 'All statuses'],
                ['active', 'Active'],
                ['invited', 'Invited'],
                ['inactive', 'Inactive'],
              ]}
            />
            <FilterSelect
              value={filters.roleId}
              onChange={(v) => update({ roleId: v })}
              options={[['all', 'All roles'], ...(roles.data ?? []).map((r) => [r.id, r.name] as [string, string])]}
            />
            <FilterSelect
              value={filters.departmentId}
              onChange={(v) => update({ departmentId: v })}
              options={[['all', 'All departments'], ...(departments.data ?? []).map((d) => [d.id, d.name] as [string, string])]}
            />
            <FilterSelect
              value={filters.siteId}
              onChange={(v) => update({ siteId: v })}
              options={[['all', 'All sites'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]}
            />
          </div>
        </div>

        {users.isLoading ? (
          <TableSkeleton />
        ) : users.error ? (
          <ErrorState message={errorMessage(users.error)} onRetry={() => users.refetch()} />
        ) : users.data?.rows.length === 0 ? (
          <EmptyState icon={Users} title="No users found" description="Try a different search or filter." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead className="hidden lg:table-cell">Sites</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden xl:table-cell">Last login</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <button className="flex cursor-pointer items-center gap-3 text-left" onClick={() => setViewing(row.id)}>
                      <UserAvatar name={row.full_name} path={row.avatar_path} />
                      <div className="min-w-0">
                        <div className="truncate font-medium hover:text-primary">
                          {row.full_name}
                          {row.id === me && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {row.email}
                          {row.employees?.employee_code ? ` · ${row.employees.employee_code}` : ''}
                        </div>
                      </div>
                    </button>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm">{row.employees?.departments?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{row.employees?.designations?.name ?? ''}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {row.user_roles.length ? (
                        row.user_roles.map((r) => (
                          <Badge key={r.role_id} variant={r.roles?.is_system ? 'default' : 'secondary'}>
                            {r.roles?.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">No role</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {row.all_sites ? (
                      <Badge variant="info">All sites</Badge>
                    ) : row.user_sites.length ? (
                      <span className="text-sm" title={row.user_sites.map((s) => s.sites?.name).join(', ')}>
                        {row.user_sites
                          .slice(0, 2)
                          .map((s) => s.sites?.name)
                          .join(', ')}
                        {row.user_sites.length > 2 && <span className="text-muted-foreground"> +{row.user_sites.length - 2}</span>}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground xl:table-cell" title={fmtDateTime(row.last_login_at)}>
                    {fmtRelative(row.last_login_at)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.full_name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-52">
                        <DropdownMenuItem onSelect={() => setViewing(row.id)}>
                          <Eye /> View profile
                        </DropdownMenuItem>
                        {can.edit && !isProtected(row) && (
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(row);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil /> Edit
                          </DropdownMenuItem>
                        )}
                        {can.create && row.status === 'invited' && (
                          <DropdownMenuItem onSelect={() => resendInvite(row)}>
                            <MailPlus /> Resend invitation
                          </DropdownMenuItem>
                        )}
                        {can.edit && row.status === 'active' && !isProtected(row) && (
                          <DropdownMenuItem onSelect={() => sendReset(row)}>
                            <KeyRound /> Send password reset
                          </DropdownMenuItem>
                        )}
                        {can.edit && row.id !== me && !isProtected(row) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive={row.status !== 'inactive'} onSelect={() => setStatusTarget(row)}>
                              <Power /> {row.status === 'inactive' ? 'Activate' : 'Deactivate'}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={users.data?.total ?? 0}
          onPage={(p) => setFilters((f) => ({ ...f, page: p }))}
        />
      </Card>

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />
      <UserDetailSheet userId={viewing} onOpenChange={(o) => !o && setViewing(null)} />
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={statusTarget?.status === 'inactive' ? 'Activate user?' : 'Deactivate user?'}
        description={
          statusTarget?.status === 'inactive'
            ? `${statusTarget?.full_name} will be able to sign in again with their existing roles.`
            : `${statusTarget?.full_name} will be signed out everywhere and lose all access immediately. Their records and history are kept.`
        }
        confirmLabel={statusTarget?.status === 'inactive' ? 'Activate' : 'Deactivate'}
        destructive={statusTarget?.status !== 'inactive'}
        onConfirm={() => statusTarget && void changeStatus(statusTarget)}
      />
    </>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
