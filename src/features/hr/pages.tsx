// HR / PMS pages: Employees, Attendance, Leave, Performance and the Task Log.
// Self-service is deliberate: anyone can see their own attendance, leave and
// review without an HR permission — the database enforces that boundary.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarCheck, CalendarOff, CheckCircle2, Contact, Download, ListChecks, Loader2, Plus, Save, Star, TrendingUp, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDate, fmtNumber, safeNum, titleCase, todayIST } from '@/lib/format';
import type { AttendanceStatus, BadgeTone, LeaveRequest, PerformanceReview, Task } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import {
  ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, Pagination, RecordStatusBadge, SearchInput, StatCard, TableSkeleton, UserAvatar,
} from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useDepartments, usePeople, useSites } from '@/features/admin/api';
import { StatusChip } from '@/features/crm/shared';
import { PRIORITY, TASK_STATUS } from '@/features/om/shared';
import { fetchTasks, useAttendance, useEmployees, useHrSummary, useLeaveRequests, useReviewGoals, useReviews, useTasks, type TaskFilters } from '@/features/hr/api';

const NONE = '__none__';

const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: BadgeTone }> = {
  present: { label: 'Present', tone: 'success' },
  absent: { label: 'Absent', tone: 'destructive' },
  half_day: { label: 'Half day', tone: 'warning' },
  leave: { label: 'On leave', tone: 'info' },
  holiday: { label: 'Holiday', tone: 'secondary' },
  week_off: { label: 'Week off', tone: 'secondary' },
};

const LEAVE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

const REVIEW_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  self_review: { label: 'Self review', tone: 'info' },
  manager_review: { label: 'Manager review', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
};

const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'comp-off'];

// ==================================================================== Employees
export function EmployeesPage() {
  const can = useCan('hr.employees');
  const departments = useDepartments();
  const summary = useHrSummary();
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('all');
  const [status, setStatus] = useState('active');
  const employees = useEmployees(search, departmentId, status);

  async function onExport() {
    try {
      await exportCsv('hr.employees', `employees-${todayIST()}`, employees.data ?? [], [
        { header: 'Employee ID', value: (r) => r.employee_code },
        { header: 'Name', value: (r) => r.full_name },
        { header: 'Email', value: (r) => r.email },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Department', value: (r) => r.departments?.name },
        { header: 'Designation', value: (r) => r.designations?.name },
        { header: 'Joining date', value: (r) => r.joining_date },
        { header: 'Status', value: (r) => r.status },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={Contact}
        title="Employees"
        description="The people directory. Accounts and access are managed in User Management; salary and identity data sit behind a separate permission."
        actions={
          can.export && (
            <Button variant="outline" onClick={onExport}>
              <Download /> Export
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active employees" value={safeNum(summary.data?.employees)} icon={Contact} loading={summary.isLoading} />
        <StatCard label="Present today" value={safeNum(summary.data?.present)} icon={CalendarCheck} tone="green" loading={summary.isLoading} />
        <StatCard label="On leave today" value={safeNum(summary.data?.on_leave)} icon={CalendarOff} tone="blue" loading={summary.isLoading} />
        <StatCard label="Leave approvals pending" value={safeNum(summary.data?.leave_pending)} icon={CalendarOff} tone="amber" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, employee ID, phone…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md">
            <FilterSelect
              value={departmentId}
              onChange={setDepartmentId}
              options={[['all', 'All departments'], ...(departments.data ?? []).map((d) => [d.id, d.name] as [string, string])]}
            />
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[
                ['active', 'Active'],
                ['inactive', 'Inactive'],
                ['all', 'All'],
              ]}
            />
          </div>
        </div>

        {employees.isLoading ? (
          <TableSkeleton cols={5} />
        ) : employees.error ? (
          <ErrorState message={errorMessage(employees.error)} onRetry={() => employees.refetch()} />
        ) : !employees.data?.length ? (
          <EmptyState icon={Contact} title="No employees found" description="Employees are created together with their user account." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden lg:table-cell">Contact</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={e.full_name} />
                      <div>
                        <div className="font-medium">{e.full_name}</div>
                        <div className="text-xs text-muted-foreground">{e.employee_code}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm">{e.departments?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{e.designations?.name ?? ''}</div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    <div>{e.email ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{e.phone ?? ''}</div>
                  </TableCell>
                  <TableCell className="text-sm">{e.joining_date ? fmtDate(e.joining_date) : '—'}</TableCell>
                  <TableCell>
                    <RecordStatusBadge status={e.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

// ==================================================================== Attendance
export function AttendancePage() {
  const can = useCan('hr.attendance');
  const qc = useQueryClient();
  const { access } = useAccess();
  const employees = useEmployees('', 'all', 'active');
  const sites = useSites();
  const [date, setDate] = useState(todayIST());
  const dayRecords = useAttendance(date, date);
  const summary = useHrSummary(date);
  const [marks, setMarks] = useState<Record<string, { status: AttendanceStatus; remarks: string }>>({});
  const [saving, setSaving] = useState(false);

  const canMarkOthers = can.create || can.edit;

  useEffect(() => {
    const byEmployee = Object.fromEntries((dayRecords.data ?? []).map((r) => [r.employee_id, r]));
    setMarks(
      Object.fromEntries(
        (employees.data ?? []).map((e) => [
          e.id,
          { status: (byEmployee[e.id]?.status ?? 'present') as AttendanceStatus, remarks: byEmployee[e.id]?.remarks ?? '' },
        ]),
      ),
    );
  }, [employees.data, dayRecords.data]);

  async function save() {
    const rows = (employees.data ?? []).map((e) => ({
      employee_id: e.id,
      att_date: date,
      status: marks[e.id]?.status ?? 'present',
      remarks: marks[e.id]?.remarks || null,
    }));
    if (!rows.length) return;
    setSaving(true);
    const { data, error } = await supabase.rpc('save_attendance', { p_rows: rows });
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Attendance saved for ${fmtNumber(data ?? rows.length)} employee(s)`);
    await qc.invalidateQueries({ queryKey: ['attendance'] });
    await qc.invalidateQueries({ queryKey: ['hr-summary'] });
  }

  const myEmployeeId = access?.profile?.employee_id;
  const myRecord = (dayRecords.data ?? []).find((r) => r.employee_id === myEmployeeId);

  return (
    <>
      <PageHeader icon={CalendarCheck} title="Attendance" description="Daily attendance. You can always see your own record." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Present" value={safeNum(summary.data?.present)} icon={CalendarCheck} tone="green" loading={summary.isLoading} />
        <StatCard label="Absent" value={safeNum(summary.data?.absent)} icon={X} tone="red" loading={summary.isLoading} />
        <StatCard label="On leave" value={safeNum(summary.data?.on_leave)} icon={CalendarOff} tone="blue" loading={summary.isLoading} />
        <StatCard label="Marked" value={`${fmtNumber(summary.data?.marked)} / ${fmtNumber(summary.data?.employees)}`} icon={ListChecks} tone="slate" loading={summary.isLoading} />
      </div>

      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{fmtDate(date)}</CardTitle>
            <CardDescription>
              {canMarkOthers ? 'Mark the team and save.' : 'Your own attendance for the selected day.'}
            </CardDescription>
          </div>
          <div className="flex items-end gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Date</span>
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </label>
            {canMarkOthers && (
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save attendance
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {employees.isLoading || dayRecords.isLoading ? (
            <TableSkeleton cols={3} />
          ) : !canMarkOthers ? (
            myRecord ? (
              <div className="p-6">
                <StatusChip map={ATTENDANCE_STATUS} value={myRecord.status} />
                {myRecord.remarks && <p className="mt-2 text-sm text-muted-foreground">{myRecord.remarks}</p>}
              </div>
            ) : (
              <EmptyState icon={CalendarCheck} title="Not marked yet" description="Your attendance for this day has not been recorded." />
            )
          ) : !employees.data?.length ? (
            <EmptyState icon={Contact} title="No employees" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="w-48">Status</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.full_name}</div>
                      <div className="text-xs text-muted-foreground">{e.employee_code}</div>
                    </TableCell>
                    <TableCell>
                      <FilterSelect
                        value={marks[e.id]?.status ?? 'present'}
                        onChange={(v) => setMarks((m) => ({ ...m, [e.id]: { ...m[e.id], status: v as AttendanceStatus } }))}
                        options={Object.entries(ATTENDANCE_STATUS).map(([k, v]) => [k, v.label] as [string, string])}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={marks[e.id]?.remarks ?? ''}
                        onChange={(ev) => setMarks((m) => ({ ...m, [e.id]: { ...m[e.id], remarks: ev.target.value } }))}
                        className="h-8"
                        placeholder="Optional"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {sites.data && null}
    </>
  );
}

// ==================================================================== Leave
export function LeavePage() {
  const can = useCan('hr.leave');
  const qc = useQueryClient();
  const { access } = useAccess();
  const [status, setStatus] = useState('all');
  const list = useLeaveRequests(status);
  const summary = useHrSummary();
  const [applyOpen, setApplyOpen] = useState(false);
  const [decision, setDecision] = useState<{ row: LeaveRequest; approve: boolean } | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['leave-requests'] });
    await qc.invalidateQueries({ queryKey: ['hr-summary'] });
  };

  async function decide() {
    if (!decision) return;
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: decision.approve ? 'approved' : 'rejected' })
      .eq('id', decision.row.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(decision.approve ? 'Leave approved' : 'Leave rejected');
    await refresh();
    setDecision(null);
  }

  return (
    <>
      <PageHeader
        icon={CalendarOff}
        title="Leave"
        description="Apply for leave and track approvals. Approving needs the APPROVE permission — nobody can approve their own."
        actions={
          access?.profile?.employee_id && (
            <Button onClick={() => setApplyOpen(true)}>
              <Plus /> Apply for leave
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Pending approvals" value={safeNum(summary.data?.leave_pending)} icon={CalendarOff} tone="amber" loading={summary.isLoading} />
        <StatCard label="On leave today" value={safeNum(summary.data?.on_leave)} icon={CalendarOff} tone="blue" loading={summary.isLoading} />
        <StatCard label="Active employees" value={safeNum(summary.data?.employees)} icon={Contact} loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex items-center gap-3 border-b p-4">
          <div className="w-full sm:w-56">
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[['all', 'All requests'], ...Object.entries(LEAVE_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
          </div>
        </div>
        {list.isLoading ? (
          <TableSkeleton cols={5} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState icon={CalendarOff} title="No leave requests" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.employees?.full_name ?? 'You'}</div>
                    <div className="text-xs text-muted-foreground">{r.reason ?? ''}</div>
                  </TableCell>
                  <TableCell className="text-sm">{titleCase(r.leave_type)}</TableCell>
                  <TableCell className="text-sm">
                    {fmtDate(r.from_date)} – {fmtDate(r.to_date)}
                    <div className="text-xs text-muted-foreground">{fmtNumber(r.days, 1)} day(s)</div>
                  </TableCell>
                  <TableCell>
                    <StatusChip map={LEAVE_STATUS} value={r.status} />
                  </TableCell>
                  <TableCell>
                    {can.approve && r.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDecision({ row: r, approve: true })}>
                          <CheckCircle2 /> Approve
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDecision({ row: r, approve: false })}>
                          <X /> Reject
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(decision)}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision?.approve ? 'Approve this leave?' : 'Reject this leave?'}
        description={`${decision?.row.employees?.full_name ?? ''} · ${fmtDate(decision?.row.from_date)} – ${fmtDate(decision?.row.to_date)}`}
        confirmLabel={decision?.approve ? 'Approve' : 'Reject'}
        destructive={!decision?.approve}
        onConfirm={() => void decide()}
      />
    </>
  );
}

function ApplyLeaveDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<void> }) {
  const { access } = useAccess();
  const [f, setF] = useState({ leave_type: 'casual', from_date: todayIST(), to_date: todayIST(), reason: '' });
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    const from = new Date(f.from_date);
    const to = new Date(f.to_date);
    const d = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
    return d > 0 ? d : 0;
  }, [f.from_date, f.to_date]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!access?.profile?.employee_id || days <= 0) return;
    setBusy(true);
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: access.profile.employee_id,
      leave_type: f.leave_type,
      from_date: f.from_date,
      to_date: f.to_date,
      days,
      reason: f.reason.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Leave request submitted');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>Your request goes to whoever holds the approval permission.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Leave type">
            <FilterSelect value={f.leave_type} onChange={(v) => setF((s) => ({ ...s, leave_type: v }))} options={LEAVE_TYPES.map((t) => [t, titleCase(t)] as [string, string])} />
          </Field>
          <Field label="Days">
            <Input value={days > 0 ? String(days) : '—'} disabled />
          </Field>
          <Field label="From" htmlFor="l_from">
            <Input id="l_from" type="date" value={f.from_date} onChange={(e) => setF((s) => ({ ...s, from_date: e.target.value }))} />
          </Field>
          <Field label="To" htmlFor="l_to">
            <Input id="l_to" type="date" min={f.from_date} value={f.to_date} onChange={(e) => setF((s) => ({ ...s, to_date: e.target.value }))} />
          </Field>
          <Field label="Reason" htmlFor="l_reason" className="sm:col-span-2">
            <Textarea id="l_reason" rows={3} value={f.reason} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || days <= 0}>
              {busy && <Loader2 className="animate-spin" />} Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ==================================================================== Performance
export function PerformancePage() {
  const can = useCan('hr.performance');
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');
  const reviews = useReviews(status);
  const [openReview, setOpenReview] = useState<PerformanceReview | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['performance-reviews'] });
    await qc.invalidateQueries({ queryKey: ['performance-goals'] });
    await qc.invalidateQueries({ queryKey: ['hr-summary'] });
  };

  return (
    <>
      <PageHeader
        icon={TrendingUp}
        title="Performance"
        description="Review periods, goals and ratings. Everyone can see their own review; completing one needs the APPROVE permission."
        actions={
          can.create && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New review
            </Button>
          )
        }
      />

      <Card>
        <div className="flex items-center gap-3 border-b p-4">
          <div className="w-full sm:w-56">
            <FilterSelect
              value={status}
              onChange={setStatus}
              options={[['all', 'All reviews'], ...Object.entries(REVIEW_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
          </div>
        </div>
        {reviews.isLoading ? (
          <TableSkeleton cols={5} />
        ) : reviews.error ? (
          <ErrorState message={errorMessage(reviews.error)} onRetry={() => reviews.refetch()} />
        ) : !reviews.data?.length ? (
          <EmptyState icon={TrendingUp} title="No reviews yet" description={can.create ? 'Create a review period for an employee.' : 'You have no reviews.'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.data.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenReview(r)}>
                  <TableCell>
                    <div className="font-medium">{r.employees?.full_name ?? 'You'}</div>
                    <div className="text-xs text-muted-foreground">{r.employees?.employee_code ?? ''}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.period_label}
                    {r.period_start && <div className="text-xs text-muted-foreground">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</div>}
                  </TableCell>
                  <TableCell>
                    {r.overall_rating ? (
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {fmtNumber(r.overall_rating, 1)} / 5
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip map={REVIEW_STATUS} value={r.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ReviewDialog review={openReview} onClose={() => setOpenReview(null)} onSaved={refresh} />
      <NewReviewDialog open={creating} onOpenChange={setCreating} onSaved={refresh} />
    </>
  );
}

function NewReviewDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<void> }) {
  const employees = useEmployees('', 'all', 'active');
  const people = usePeople();
  const [f, setF] = useState({ employee_id: '', period_label: '', period_start: '', period_end: '', reviewer_id: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.employee_id || !f.period_label.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('performance_reviews').insert({
      employee_id: f.employee_id,
      period_label: f.period_label.trim(),
      period_start: f.period_start || null,
      period_end: f.period_end || null,
      reviewer_id: f.reviewer_id || null,
      status: 'draft',
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Review created');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New performance review</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee" required className="sm:col-span-2">
            <FilterSelect
              value={f.employee_id || NONE}
              onChange={(v) => setF((s) => ({ ...s, employee_id: v === NONE ? '' : v }))}
              options={[[NONE, '— Select employee —'], ...(employees.data ?? []).map((e) => [e.id, `${e.full_name} (${e.employee_code})`] as [string, string])]}
            />
          </Field>
          <Field label="Period label" htmlFor="r_period" required className="sm:col-span-2">
            <Input id="r_period" value={f.period_label} onChange={(e) => setF((s) => ({ ...s, period_label: e.target.value }))} placeholder="FY 2026-27 H1" />
          </Field>
          <Field label="From" htmlFor="r_from">
            <Input id="r_from" type="date" value={f.period_start} onChange={(e) => setF((s) => ({ ...s, period_start: e.target.value }))} />
          </Field>
          <Field label="To" htmlFor="r_to">
            <Input id="r_to" type="date" value={f.period_end} onChange={(e) => setF((s) => ({ ...s, period_end: e.target.value }))} />
          </Field>
          <Field label="Reviewer" className="sm:col-span-2">
            <FilterSelect
              value={f.reviewer_id || NONE}
              onChange={(v) => setF((s) => ({ ...s, reviewer_id: v === NONE ? '' : v }))}
              options={[[NONE, '— Not set —'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
            />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !f.employee_id || !f.period_label.trim()}>
              {busy && <Loader2 className="animate-spin" />} Create review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ review, onClose, onSaved }: { review: PerformanceReview | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const can = useCan('hr.performance');
  const { access } = useAccess();
  const goals = useReviewGoals(review?.id);
  const [managerComments, setManagerComments] = useState('');
  const [employeeComments, setEmployeeComments] = useState('');
  const [rating, setRating] = useState('');
  const [busy, setBusy] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');

  useEffect(() => {
    setManagerComments(review?.manager_comments ?? '');
    setEmployeeComments(review?.employee_comments ?? '');
    setRating(review?.overall_rating ? String(safeNum(review.overall_rating)) : '');
  }, [review]);

  if (!review) return null;
  const isMine = review.employee_id === access?.profile?.employee_id;
  const locked = review.status === 'completed';

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    const payload: Record<string, unknown> = can.edit
      ? { manager_comments: managerComments.trim() || null, overall_rating: rating ? safeNum(rating) : null, employee_comments: employeeComments.trim() || null, ...extra }
      : { employee_comments: employeeComments.trim() || null };
    const { error } = await supabase.from('performance_reviews').update(payload).eq('id', review!.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Review saved');
    await onSaved();
    onClose();
  }

  async function addGoal() {
    if (!goalTitle.trim()) return;
    const { error } = await supabase.from('performance_goals').insert({
      review_id: review!.id,
      title: goalTitle.trim(),
      sort_order: (goals.data?.length ?? 0) + 1,
    });
    if (error) return toast.error(errorMessage(error));
    setGoalTitle('');
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {review.employees?.full_name ?? 'My review'} · {review.period_label}
            <StatusChip map={REVIEW_STATUS} value={review.status} />
          </DialogTitle>
          <DialogDescription>
            {review.period_start ? `${fmtDate(review.period_start)} – ${fmtDate(review.period_end)}` : 'Period not set'}
            {review.completed_at ? ` · completed ${fmtDate(review.completed_at)}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold">Goals &amp; KPIs</p>
            {goals.isLoading ? (
              <Skeleton className="h-20" />
            ) : goals.data?.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {goals.data.map((g) => (
                  <li key={g.id} className="px-3 py-2">
                    <div className="font-medium">{g.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {[g.kpi, g.target ? `target ${g.target}` : null, g.actual ? `actual ${g.actual}` : null, safeNum(g.weight) ? `${fmtNumber(g.weight)}%` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No goals recorded.</p>
            )}
            {can.edit && !locked && (
              <div className="mt-2 flex gap-2">
                <Input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="Add a goal or KPI" className="h-8" />
                <Button size="sm" variant="outline" onClick={addGoal} disabled={!goalTitle.trim()}>
                  <Plus /> Add
                </Button>
              </div>
            )}
          </div>

          {can.edit && (
            <>
              <Field label="Overall rating (0–5)" htmlFor="rv_rating">
                <Input id="rv_rating" inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} disabled={locked} className="sm:w-32" />
              </Field>
              <Field label="Manager comments" htmlFor="rv_mc">
                <Textarea id="rv_mc" rows={3} value={managerComments} onChange={(e) => setManagerComments(e.target.value)} disabled={locked} />
              </Field>
            </>
          )}

          <Field
            label="Employee comments"
            htmlFor="rv_ec"
            hint={isMine && !can.edit ? 'You can add your own comments here.' : undefined}
          >
            <Textarea id="rv_ec" rows={3} value={employeeComments} onChange={(e) => setEmployeeComments(e.target.value)} disabled={locked || (!isMine && !can.edit)} />
          </Field>

          {!can.approve && review.status !== 'completed' && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Completing a review requires the APPROVE permission.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!locked && (isMine || can.edit) && (
            <Button variant="outline" onClick={() => save()} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
          )}
          {can.approve && !locked && (
            <Button onClick={() => save({ status: 'completed' })} disabled={busy}>
              <CheckCircle2 /> Complete review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================================================================== Task log
const PAGE_SIZE = 20;

export function TasksPage() {
  const can = useCan('tasks');
  const qc = useQueryClient();
  const people = usePeople();
  const sites = useSites();
  const summary = useHrSummary();
  const [filters, setFilters] = useState<TaskFilters>({ search: '', status: 'open', module: 'all', assignedTo: 'all', page: 0, pageSize: PAGE_SIZE });
  const tasks = useTasks(filters);
  const [creating, setCreating] = useState(false);
  const update = (patch: Partial<TaskFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['tasks'] });
    await qc.invalidateQueries({ queryKey: ['hr-summary'] });
  };

  async function setStatus(task: Task, status: string) {
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${task.task_code} — ${TASK_STATUS[status as keyof typeof TASK_STATUS].label.toLowerCase()}`);
    await refresh();
  }

  async function onExport() {
    try {
      const { rows } = await fetchTasks(filters, true);
      await exportCsv('tasks', `tasks-${todayIST()}`, rows, [
        { header: 'Code', value: (r) => r.task_code },
        { header: 'Task', value: (r) => r.title },
        { header: 'Module', value: (r) => r.module },
        { header: 'Site', value: (r) => r.sites?.name },
        { header: 'Due', value: (r) => r.due_date },
        { header: 'Priority', value: (r) => r.priority },
        { header: 'Status', value: (r) => TASK_STATUS[r.status].label },
        { header: 'Completed', value: (r) => r.completed_at },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={ListChecks}
        title="Task Log"
        description="One task list across CRM, tenders, O&M, HR and daily reviews."
        actions={
          <>
            {can.export && (
              <Button variant="outline" onClick={onExport}>
                <Download /> Export
              </Button>
            )}
            {can.create && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New task
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Open tasks" value={safeNum(summary.data?.tasks_open)} icon={ListChecks} loading={summary.isLoading} />
        <StatCard label="Overdue" value={safeNum(summary.data?.tasks_overdue)} icon={CalendarOff} tone="red" loading={summary.isLoading} />
        <StatCard label="Employees" value={safeNum(summary.data?.employees)} icon={Contact} tone="violet" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center">
          <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Search tasks…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v })}
              options={[['open', 'Open'], ['all', 'All statuses'], ...Object.entries(TASK_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect
              value={filters.module}
              onChange={(v) => update({ module: v })}
              options={[
                ['all', 'All modules'],
                ['crm', 'CRM & tenders'],
                ['om', 'O&M'],
                ['hr', 'HR'],
                ['daily_review', 'Daily review'],
                ['general', 'General'],
              ]}
            />
            <FilterSelect value={filters.assignedTo} onChange={(v) => update({ assignedTo: v })} options={[['all', 'Anyone'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]} />
          </div>
        </div>

        {tasks.isLoading ? (
          <TableSkeleton cols={5} />
        ) : tasks.error ? (
          <ErrorState message={errorMessage(tasks.error)} onRetry={() => tasks.refetch()} />
        ) : !tasks.data?.rows.length ? (
          <EmptyState icon={ListChecks} title="No tasks" description={can.create ? 'Create a task and assign it.' : 'Nothing assigned to you.'} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead className="hidden md:table-cell">Module / site</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.data.rows.map((t) => {
                const overdue = t.due_date && t.status !== 'done' && t.due_date < todayIST();
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.task_code}
                        {t.description ? ` · ${t.description}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      <Badge variant="secondary">{titleCase(t.module)}</Badge>
                      {t.sites?.name && <div className="mt-1 text-xs text-muted-foreground">{t.sites.name}</div>}
                    </TableCell>
                    <TableCell className={`text-sm ${overdue ? 'text-destructive' : ''}`}>{t.due_date ? fmtDate(t.due_date) : '—'}</TableCell>
                    <TableCell>
                      <StatusChip map={PRIORITY} value={t.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusChip map={TASK_STATUS} value={t.status} />
                    </TableCell>
                    <TableCell>
                      {can.edit && t.status !== 'done' && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(t, 'done')}>
                          <CheckCircle2 /> Done
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={tasks.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <TaskFormDialog open={creating} onOpenChange={setCreating} onSaved={refresh} sites={sites.data ?? []} people={people.data ?? []} />
    </>
  );
}

function TaskFormDialog({
  open,
  onOpenChange,
  onSaved,
  sites,
  people,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => Promise<void>;
  sites: { id: string; name: string }[];
  people: { id: string; full_name: string }[];
}) {
  const can = useCan('tasks');
  const { access } = useAccess();
  const [f, setF] = useState({ title: '', description: '', module: 'general', assigned_to: '', due_date: '', priority: 'medium', site_id: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setF({ title: '', description: '', module: 'general', assigned_to: '', due_date: '', priority: 'medium', site_id: '' });
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      module: f.module,
      due_date: f.due_date || null,
      priority: f.priority,
      site_id: f.site_id || null,
    };
    payload.assigned_to = can.assign && f.assigned_to ? f.assigned_to : (access?.profile?.id ?? null);
    const { error } = await supabase.from('tasks').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Task created');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Task" htmlFor="t_title" required className="sm:col-span-2">
            <Input id="t_title" value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} autoFocus />
          </Field>
          <Field label="Module">
            <FilterSelect
              value={f.module}
              onChange={(v) => setF((s) => ({ ...s, module: v }))}
              options={[
                ['general', 'General'],
                ['crm', 'CRM & tenders'],
                ['om', 'O&M'],
                ['hr', 'HR'],
                ['daily_review', 'Daily review'],
              ]}
            />
          </Field>
          <Field label="Priority">
            <FilterSelect value={f.priority} onChange={(v) => setF((s) => ({ ...s, priority: v }))} options={Object.entries(PRIORITY).map(([k, v]) => [k, v.label] as [string, string])} />
          </Field>
          <Field label="Due date" htmlFor="t_due">
            <Input id="t_due" type="date" value={f.due_date} onChange={(e) => setF((s) => ({ ...s, due_date: e.target.value }))} />
          </Field>
          <Field label="Site">
            <FilterSelect
              value={f.site_id || NONE}
              onChange={(v) => setF((s) => ({ ...s, site_id: v === NONE ? '' : v }))}
              options={[[NONE, '— Not site specific —'], ...sites.map((s) => [s.id, s.name] as [string, string])]}
            />
          </Field>
          {can.assign && (
            <Field label="Assign to" className="sm:col-span-2">
              <FilterSelect
                value={f.assigned_to || NONE}
                onChange={(v) => setF((s) => ({ ...s, assigned_to: v === NONE ? '' : v }))}
                options={[[NONE, '— Myself —'], ...people.map((p) => [p.id, p.full_name] as [string, string])]}
              />
            </Field>
          )}
          <Field label="Details" htmlFor="t_desc" className="sm:col-span-2">
            <Textarea id="t_desc" rows={3} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !f.title.trim()}>
              {busy && <Loader2 className="animate-spin" />} Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
