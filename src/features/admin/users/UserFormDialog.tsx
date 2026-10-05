import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Lock } from 'lucide-react';
import { callAdminUsers, supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, safeNum } from '@/lib/format';
import type { UserRow } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CheckList, Field } from '@/components/common';
import { useDepartments, useDesignations, useRoles, useSites } from '@/features/admin/api';

const NONE = '__none__';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  /** An employee already on the list this login belongs to (new users only). */
  employee_id: string;
  full_name: string;
  email: string;
  phone: string;
  employee_code: string;
  department_id: string;
  designation_id: string;
  joining_date: string;
  role_ids: string[];
  site_ids: string[];
  all_sites: boolean;
  method: 'invite' | 'password';
  password: string;
}

function initial(user: UserRow | null): FormState {
  return {
    employee_id: '',
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    employee_code: user?.employees?.employee_code ?? '',
    department_id: user?.employees?.department_id ?? '',
    designation_id: user?.employees?.designation_id ?? '',
    joining_date: user?.employees?.joining_date ?? '',
    role_ids: user?.user_roles.map((r) => r.role_id) ?? [],
    site_ids: user?.user_sites.map((s) => s.site_id) ?? [],
    all_sites: user?.all_sites ?? false,
    method: 'invite',
    password: '',
  };
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: UserRow | null; // null = create
}) {
  const isNew = !user;
  const qc = useQueryClient();
  const { access, refresh } = useAccess();
  const can = useCan('admin.users');
  const roles = useRoles();
  const sites = useSites();
  const departments = useDepartments();
  const designations = useDesignations();
  const [f, setF] = useState<FormState>(() => initial(user));
  // People on the employee list without a login: a new login should belong to
  // one of them, not create a second record for the same person.
  const withoutLogin = useQuery({
    queryKey: ['employee-logins'],
    enabled: open && isNew && can.view,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('employee_logins');
      if (error) throw error;
      return ((data ?? []) as { employee_id: string; employee_code: string; full_name: string; email: string | null;
        phone: string | null; user_id: string | null; site_id: string | null; site: string | null }[]);
    },
  });
  const candidates = (withoutLogin.data ?? []).filter((e) => !e.user_id);
  function pickEmployee(id: string) {
    const e = candidates.find((c) => c.employee_id === id);
    setF((s) => ({
      ...s,
      employee_id: e ? e.employee_id : '',
      full_name: e ? e.full_name : s.full_name,
      email: e && !s.email ? (e.email ?? '') : s.email,
      phone: e && !s.phone ? (e.phone ?? '') : s.phone,
      employee_code: e ? '' : s.employee_code,
      // Their plant, from the work location; anything else is ticked by hand.
      site_ids: e?.site_id && !s.all_sites ? [e.site_id] : s.site_ids,
    }));
  }
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setF(initial(user));
      setTouched(false);
    }
  }, [open, user]);

  const isSelf = user?.id === access?.profile?.id;
  const callerIsSuper = access?.is_super_admin ?? false;
  const canAssign = can.assign && (!isSelf || callerIsSuper);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!f.full_name.trim()) e.full_name = 'Full name is required.';
    if (isNew && !EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.';
    if (isNew && f.method === 'password' && f.password.length < 8) e.password = 'At least 8 characters.';
    // A technician files for their plants only: they must have at least one.
    const technician = (roles.data ?? []).find((r) => r.key === 'technician');
    if (technician && f.role_ids.includes(technician.id) && !f.all_sites && !f.site_ids.length) {
      e.site_ids = 'Tick the plants this technician works at.';
    }
    return e;
  }, [f, isNew, roles.data]);

  const designationOptions = (designations.data ?? []).filter(
    (d) => d.status === 'active' && (!f.department_id || !d.department_id || d.department_id === f.department_id),
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    const data: Record<string, unknown> = {
      phone: f.phone.trim(),
      ...(isNew && f.employee_id ? { employee_id: f.employee_id } : { employee_code: f.employee_code.trim() }),
      department_id: f.department_id,
      designation_id: f.designation_id,
      joining_date: f.joining_date,
    };
    if (canAssign) {
      data.role_ids = f.role_ids;
      data.site_ids = f.all_sites ? [] : f.site_ids;
      data.all_sites = f.all_sites;
    }
    try {
      if (isNew) {
        await callAdminUsers({
          action: f.method === 'invite' ? 'invite' : 'create',
          email: f.email.trim().toLowerCase(),
          full_name: f.full_name.trim(),
          password: f.method === 'password' ? f.password : undefined,
          // An invitation lands on /accept-invite so the URL matches what is
          // happening; both routes render the same choose-a-password page.
          redirect_to: `${window.location.origin}/${f.method === 'invite' ? 'accept-invite' : 'reset-password'}`,
          data,
        });
        toast.success(f.method === 'invite' ? `Invitation sent to ${f.email.trim()}` : 'User created');
      } else {
        const { error } = await supabase.rpc('admin_save_user', {
          p_user_id: user.id,
          p_data: { ...data, full_name: f.full_name.trim() },
          p_is_new: false,
        });
        if (error) throw error;
        toast.success('User updated');
        if (isSelf) await refresh();
      }
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['user'] });
      await qc.invalidateQueries({ queryKey: ['role-user-counts'] });
      await qc.invalidateQueries({ queryKey: ['people'] });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof FormState) => (touched ? errors[k] : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add user' : `Edit ${user.full_name}`}</DialogTitle>
          <DialogDescription>
            {isNew ? 'Create an account and decide exactly what this person can access.' : user.email}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-6">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isNew && candidates.length > 0 && (
              <Field label="Employee" className="sm:col-span-2"
                hint="Already on the employee list? Pick them, so the login joins their record instead of creating a second one.">
                <Select value={f.employee_id || NONE} onValueChange={(v) => pickEmployee(v === NONE ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Not on the list yet" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— New person, not on the employee list —</SelectItem>
                    {candidates.map((c) => (
                      <SelectItem key={c.employee_id} value={c.employee_id}>
                        {c.full_name} · {c.employee_code}{c.site ? ` · ${c.site}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Full name" htmlFor="u_name" required error={err('full_name')}>
              <Input id="u_name" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="u_email" required={isNew} error={err('email')} hint={!isNew ? 'Email cannot be changed here.' : undefined}>
              <Input id="u_email" type="email" value={f.email} disabled={!isNew} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="u_phone">
              <Input id="u_phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Employee ID" htmlFor="u_emp"
              hint={isNew && f.employee_id ? 'Kept from their employee record.' : 'Leave blank to auto-generate.'}>
              <Input id="u_emp" value={isNew && f.employee_id ? (candidates.find((c) => c.employee_id === f.employee_id)?.employee_code ?? '') : f.employee_code}
                disabled={isNew && !!f.employee_id} onChange={(e) => set('employee_code', e.target.value)} />
            </Field>
            <Field label="Department">
              <Select value={f.department_id || NONE} onValueChange={(v) => set('department_id', v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {(departments.data ?? [])
                    .filter((d) => d.status === 'active' || d.id === f.department_id)
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Designation">
              <Select value={f.designation_id || NONE} onValueChange={(v) => set('designation_id', v === NONE ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select designation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {designationOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Joining date" htmlFor="u_join">
              <Input id="u_join" type="date" value={f.joining_date} onChange={(e) => set('joining_date', e.target.value)} />
            </Field>
          </section>

          {isNew && (
            <section className="grid gap-3 rounded-xl border bg-slate-50/60 p-4">
              <p className="text-sm font-semibold">How should this person sign in?</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ['invite', 'Send invitation email', 'They choose their own password from the email link.'],
                    ['password', 'Set a password now', 'Share the password with them securely.'],
                  ] as const
                ).map(([value, title, desc]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-lg border bg-card p-3 text-sm ${f.method === value ? 'border-primary ring-2 ring-primary/20' : ''}`}
                  >
                    <input type="radio" className="sr-only" checked={f.method === value} onChange={() => set('method', value)} />
                    <span className="font-medium">{title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
                  </label>
                ))}
              </div>
              {f.method === 'password' && (
                <Field label="Temporary password" htmlFor="u_pw" required error={err('password')}>
                  <Input id="u_pw" type="text" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
                </Field>
              )}
            </section>
          )}

          {canAssign ? (
            <section className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                <p className="text-sm font-semibold">Roles</p>
                <p className="text-xs text-muted-foreground">Permissions are the combination of all selected roles.</p>
                <CheckList
                  items={(roles.data ?? []).filter((r) => r.is_active)}
                  selected={f.role_ids}
                  onChange={(ids) => {
                    // A Super Technician works at every plant.
                    const superTech = (roles.data ?? []).find((r) => r.key === 'super_technician');
                    setF((s) => ({
                      ...s,
                      role_ids: ids,
                      all_sites: superTech && ids.includes(superTech.id) && !s.role_ids.includes(superTech.id) ? true : s.all_sites,
                    }));
                  }}
                  disabled={(r) => r.is_system && !callerIsSuper}
                  render={(r) => (
                    <span className="flex items-center gap-2">
                      {r.name}
                      {r.is_system && <Badge variant="default">System</Badge>}
                    </span>
                  )}
                />
              </div>
              <div className="grid content-start gap-2">
                <p className="text-sm font-semibold">Site access</p>
                {err('site_ids') && <p className="text-xs text-destructive">{err('site_ids')}</p>}
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span>
                    <span className="font-medium">All sites</span>
                    <span className="block text-xs text-muted-foreground">Includes sites added in the future.</span>
                  </span>
                  <Switch checked={f.all_sites} onCheckedChange={(v) => set('all_sites', v)} />
                </label>
                {!f.all_sites && (
                  <CheckList
                    items={sites.data ?? []}
                    selected={f.site_ids}
                    onChange={(ids) => set('site_ids', ids)}
                    emptyText="No sites yet. Add sites in Site Management."
                    searchable={(s) => s.name}
                    render={(s) => (
                      <span className="flex items-center justify-between gap-2">
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.status === 'inactive' ? 'Inactive' : safeNum(s.capacity_kwp) ? fmtCapacity(s.capacity_kwp) : ''}
                        </span>
                      </span>
                    )}
                  />
                )}
              </div>
            </section>
          ) : (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              {isSelf ? 'You cannot change your own roles or site access.' : 'Assigning roles and sites requires the ASSIGN permission.'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {isNew ? (f.method === 'invite' ? 'Send invitation' : 'Create user') : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
