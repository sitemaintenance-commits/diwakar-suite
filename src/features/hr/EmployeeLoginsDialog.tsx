// Employee logins: who can sign in, and giving logins to the rest -- one or
// many at a time -- linked to their existing employee record, with the
// Employee role (their own Daily Work sheet, score, attendance and leave).
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Loader2, Mail } from 'lucide-react';
import { callAdminUsers, supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtRelative } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, Field, SearchInput, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { passwordProblem } from '@/pages/ResetPasswordPage';

interface LoginRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  user_id: string | null;
  login_email: string | null;
  login_status: 'invited' | 'active' | 'inactive' | null;
  last_sign_in_at: string | null;
  roles: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmployeeLoginsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const logins = useQuery({
    queryKey: ['employee-logins'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('employee_logins');
      if (error) throw error;
      return (data ?? []) as LoginRow[];
    },
  });
  const roles = useQuery({
    queryKey: ['roles-for-logins'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('id, key, name').eq('is_active', true).order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; key: string; name: string }[];
    },
  });

  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'none' | 'has'>('none');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'invite' | 'create'>('invite');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const employeeRole = roles.data?.find((r) => r.key === 'employee')?.id ?? '';
  const role = roleId || employeeRole;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (logins.data ?? []).filter((r) =>
      (show === 'all' || (show === 'none' ? !r.user_id : !!r.user_id))
      && (!q || `${r.full_name} ${r.employee_code} ${r.email ?? ''} ${r.department ?? ''}`.toLowerCase().includes(q)));
  }, [logins.data, search, show]);
  const eligible = (r: LoginRow) => !r.user_id && !!r.email && EMAIL_RE.test(r.email);
  const pickable = rows.filter(eligible);
  const counts = {
    has: (logins.data ?? []).filter((r) => r.user_id).length,
    none: (logins.data ?? []).filter((r) => !r.user_id).length,
    noEmail: (logins.data ?? []).filter((r) => !r.user_id && !r.email).length,
  };

  function toggle(id: string, on: boolean) {
    setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  }

  async function give() {
    const targets = (logins.data ?? []).filter((r) => picked.has(r.employee_id) && eligible(r));
    if (!targets.length) return;
    if (!role) return toast.error('Choose the role the new logins get.');
    if (mode === 'create' && passwordProblem(password)) return toast.error(passwordProblem(password)!);
    setProgress({ done: 0, total: targets.length });
    let ok = 0;
    for (const [i, r] of targets.entries()) {
      try {
        await callAdminUsers({
          action: mode,
          email: r.email,
          full_name: r.full_name,
          ...(mode === 'create' ? { password } : { redirect_to: `${window.location.origin}/accept-invite` }),
          data: { employee_id: r.employee_id, role_ids: [role] },
        });
        ok += 1;
      } catch (e) {
        toast.error(`${r.full_name}: ${errorMessage(e)}`);
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null);
    setPicked(new Set());
    if (ok) {
      toast.success(mode === 'invite'
        ? `${ok} invitation${ok === 1 ? '' : 's'} sent. Each person sets their own password from the email.`
        : `${ok} login${ok === 1 ? '' : 's'} created. Share the temporary password; they should change it in My profile.`);
    }
    await qc.invalidateQueries({ queryKey: ['employee-logins'] });
    await qc.invalidateQueries({ queryKey: ['employees'] });
  }

  const status = (r: LoginRow) =>
    !r.user_id ? (r.email ? <Badge variant="secondary">No login</Badge> : <Badge variant="warning">No email</Badge>)
      : r.login_status === 'active' ? <Badge variant="success">Active</Badge>
        : r.login_status === 'invited' ? <Badge variant="info">Invited</Badge>
          : <Badge variant="destructive">Inactive</Badge>;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!progress) onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Employee logins</DialogTitle>
          <DialogDescription>
            {counts.has} with a login · {counts.none} without{counts.noEmail ? ` (${counts.noEmail} have no email yet: import the HR sheet or add it on the employee)` : ''}.
            A login is linked to the person’s existing employee record; with the Employee role they see only their own
            Daily Work sheet, score, attendance and leave.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, number, email…" />
          <div className="sm:w-56">
            <FilterSelect value={show} onChange={(v) => { setShow(v as typeof show); setPicked(new Set()); }}
              options={[['none', 'Without a login'], ['has', 'With a login'], ['all', 'Everyone']]} />
          </div>
        </div>

        {logins.isLoading ? (
          <TableSkeleton cols={5} rows={6} />
        ) : logins.error ? (
          <ErrorState message={errorMessage(logins.error)} onRetry={() => logins.refetch()} />
        ) : (
          <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all"
                      checked={pickable.length > 0 && pickable.every((r) => picked.has(r.employee_id))}
                      onCheckedChange={(v) => setPicked(v === true ? new Set(pickable.map((r) => r.employee_id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead className="hidden lg:table-cell">Role</TableHead>
                  <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.employee_id}>
                    <TableCell>
                      <Checkbox aria-label={`Select ${r.full_name}`} disabled={!eligible(r)}
                        checked={picked.has(r.employee_id)} onCheckedChange={(v) => toggle(r.employee_id, v === true)} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.full_name}</div>
                      <div className="text-xs text-muted-foreground">{r.employee_code}{r.department ? ` · ${r.department}` : ''}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{r.login_email ?? r.email ?? '—'}</TableCell>
                    <TableCell>{status(r)}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">{r.roles.join(', ') || '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {r.user_id ? fmtRelative(r.last_sign_in_at, 'Never') : ''}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Nobody here.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
          <Field label="How they get in">
            <FilterSelect value={mode} onChange={(v) => setMode(v as typeof mode)}
              options={[['invite', 'Email an invitation'], ['create', 'Temporary password']]} />
          </Field>
          {mode === 'create' ? (
            <Field label="Temporary password" hint="At least 8 characters. They change it in My profile.">
              <Input type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : (
            <p className="text-xs text-muted-foreground sm:col-span-1 sm:self-center">
              Each person gets an email to set their own password. Supabase’s built-in mailer sends only a few emails an
              hour: for many people at once, set up the company mail server in Supabase first, or use a temporary password.
            </p>
          )}
          <Field label="Role">
            <FilterSelect value={role} onChange={setRoleId}
              options={(roles.data ?? []).filter((r) => r.key !== 'super_admin').map((r) => [r.id, r.name] as [string, string])} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={!!progress} onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={!!progress || picked.size === 0} onClick={() => void give()}>
            {progress ? <Loader2 className="animate-spin" /> : mode === 'invite' ? <Mail /> : <KeyRound />}
            {progress ? `Working ${progress.done} of ${progress.total}…` : `Give login${picked.size === 1 ? '' : 's'} to ${picked.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
