// Daily Review — rebuilt natively from the existing Daily Review CRM.
//   Daily Reports      file / edit one report per department per day
//   Review Summary     today vs the previous day, plus the month view
//   Management Review  CCM and Founder remarks, mark reviewed / returned
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, Download, Loader2, MessageSquareText, Megaphone, Plus, Save, Send, TriangleAlert, Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDate, fmtDateTime, fmtNumber, safeNum, todayIST } from '@/lib/format';
import type { BadgeTone } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, ErrorState, Field, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useDepartments } from '@/features/admin/api';
import { StatusChip } from '@/features/crm/shared';

// ---------------------------------------------------------------- shared
export const HEALTH: Record<string, { label: string; tone: BadgeTone }> = {
  on_track: { label: 'On track', tone: 'success' },
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  critical: { label: 'Critical', tone: 'destructive' },
};

const REPORT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  submitted: { label: 'Submitted', tone: 'info' },
  reviewed: { label: 'Reviewed', tone: 'success' },
  returned: { label: 'Returned', tone: 'destructive' },
};

interface Metric {
  label: string;
  value: string;
}

/**
 * The metric rows used by the legacy Daily Review CRM. Keeping the same
 * labels makes the Supabase-backed replacement familiar on day one while
 * still allowing users to add, rename or remove rows for a particular day.
 */
export const DEFAULT_METRICS_BY_DEPARTMENT: Record<string, string[]> = {
  'Design & Engineering': ['Designs completed', 'Drawings pending', 'BOMs released'],
  'Procurement & Stores': [
    'POs Raised & Pending',
    'Material Dispatched & Received',
    'Critical Material Pending',
    'Inventory & Store Management',
  ],
  'Projects & Installation': ['Project Progress Stage', 'Active Sites', 'Key Issues', 'Project Activity Plan'],
  'O&M / Service': [
    'Plant Daily Generation Report',
    'Equipment Status & Issues',
    'Faults & Rectification',
    'Daily O&M Activities',
  ],
  HR: ['Staff present', 'Absent', 'New joinees', 'Open positions'],
  Admin: ['Attendance register status', 'Office housekeeping', 'Facility & asset status', 'Site admin support'],
};

function emptyMetricsFor(departmentName: string): Metric[] {
  const labels = DEFAULT_METRICS_BY_DEPARTMENT[departmentName];
  return labels?.length ? labels.map((label) => ({ label, value: '' })) : [{ label: '', value: '' }];
}

interface DeptReport {
  id: string;
  health: string;
  status: string;
  work_completed: string | null;
  issues: string | null;
  next_day_plan: string | null;
  remarks: string | null;
  reporter: string | null;
  metrics: Metric[];
  reviews: { action: string; comment: string | null; at: string; by: string | null }[];
}
interface DailyReview {
  date: string;
  compare_date: string;
  headline: { metrics: Metric[]; note: string | null } | null;
  totals: { departments: number; reported: number; drafts: number; reviewed: number; on_track: number; needs_attention: number; critical: number; with_issues: number };
  departments: { department_id: string; name: string; color: string; today: DeptReport | null; previous: DeptReport | null }[];
}

function useDailyReview(date: string, compare?: string) {
  return useQuery({
    queryKey: ['daily-review', date, compare ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_daily_review', { p_date: date, p_compare: compare ?? null });
      if (error) throw error;
      return (data ?? {}) as DailyReview;
    },
  });
}

function useDailyMonth(month: string) {
  return useQuery({
    queryKey: ['daily-month', month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_daily_month', { p_month: `${month}-01` });
      if (error) throw error;
      return (data ?? []) as { date: string; reported: number; critical: number; needs_attention: number; issues: number }[];
    },
  });
}

// ==================================================================== Daily reports
export function DailyReportsPage() {
  const can = useCan('daily.reports');
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIST());
  const review = useDailyReview(date);
  const [editing, setEditing] = useState<{ departmentId: string; name: string; report: DeptReport | null } | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['daily-review'] });
    await qc.invalidateQueries({ queryKey: ['daily-month'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  const t = review.data?.totals;

  return (
    <>
      <PageHeader
        icon={ClipboardList}
        title="Daily Reports"
        description="One report per department per day: what was done, what is stuck, and tomorrow's plan."
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </label>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">
              {fmtNumber(t?.reported)} of {fmtNumber(t?.departments)} reported
            </Badge>
            {safeNum(t?.critical) > 0 && <Badge variant="destructive">{fmtNumber(t?.critical)} critical</Badge>}
            {safeNum(t?.needs_attention) > 0 && <Badge variant="warning">{fmtNumber(t?.needs_attention)} need attention</Badge>}
            {safeNum(t?.with_issues) > 0 && <Badge variant="info">{fmtNumber(t?.with_issues)} with issues</Badge>}
          </div>
        </CardContent>
      </Card>

      {review.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : review.error ? (
        <Card>
          <ErrorState message={errorMessage(review.error)} onRetry={() => review.refetch()} />
        </Card>
      ) : !review.data?.departments?.length ? (
        <Card>
          <EmptyState icon={ClipboardList} title="No departments" description="Departments are managed under HR → Departments." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {review.data.departments.map((d) => (
            <Card key={d.department_id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: d.color }} />
                  <CardTitle className="text-base">{d.name}</CardTitle>
                </div>
                {d.today ? <StatusChip map={REPORT_STATUS} value={d.today.status} /> : <Badge variant="secondary">Not filed</Badge>}
              </CardHeader>
              <CardContent className="grid gap-3">
                {d.today ? (
                  <>
                    <StatusChip map={HEALTH} value={d.today.health} />
                    {d.today.metrics.length > 0 && (
                      <dl className="grid gap-1 text-sm">
                        {d.today.metrics.map((m, i) => (
                          <div key={i} className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">{m.label}</dt>
                            <dd className="tabular font-medium">{m.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {d.today.work_completed && <p className="line-clamp-3 text-sm">{d.today.work_completed}</p>}
                    {d.today.issues && (
                      <p className="flex gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        {d.today.issues}
                      </p>
                    )}
                    {d.today.reviews.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <MessageSquareText className="mr-1 inline h-3.5 w-3.5" />
                        {fmtNumber(d.today.reviews.length)} management remark(s)
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No report filed for this day.</p>
                )}
                {(can.create || can.edit) && (
                  <Button size="sm" variant={d.today ? 'outline' : 'default'} onClick={() => setEditing({ departmentId: d.department_id, name: d.name, report: d.today })}>
                    {d.today ? 'Open report' : <><Plus /> File report</>}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ReportEditor entry={editing} date={date} onClose={() => setEditing(null)} onSaved={refresh} />
    </>
  );
}

function ReportEditor({
  entry,
  date,
  onClose,
  onSaved,
}: {
  entry: { departmentId: string; name: string; report: DeptReport | null } | null;
  date: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const can = useCan('daily.reports');
  const [health, setHealth] = useState('on_track');
  const [work, setWork] = useState('');
  const [issues, setIssues] = useState('');
  const [plan, setPlan] = useState('');
  const [remarks, setRemarks] = useState('');
  const [metrics, setMetrics] = useState<Metric[]>([{ label: '', value: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = entry?.report;
    setHealth(r?.health ?? 'on_track');
    setWork(r?.work_completed ?? '');
    setIssues(r?.issues ?? '');
    setPlan(r?.next_day_plan ?? '');
    setRemarks(r?.remarks ?? '');
    setMetrics(r?.metrics?.length ? r.metrics.map((m) => ({ ...m })) : emptyMetricsFor(entry?.name ?? ''));
  }, [entry]);

  if (!entry) return null;
  const locked = entry.report?.status === 'reviewed' && !can.edit;

  async function save(status: 'draft' | 'submitted') {
    setBusy(true);
    const { error } = await supabase.rpc('save_daily_report', {
      p_report: {
        report_date: date,
        department_id: entry!.departmentId,
        health,
        work_completed: work.trim() || null,
        issues: issues.trim() || null,
        next_day_plan: plan.trim() || null,
        remarks: remarks.trim() || null,
        status,
      },
      p_items: metrics.filter((m) => m.label.trim()),
      p_id: entry!.report?.id ?? null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(status === 'submitted' ? 'Report submitted' : 'Draft saved');
    await onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {entry.name} · {fmtDate(date)}
          </DialogTitle>
          <DialogDescription>
            {entry.report ? `Filed by ${entry.report.reporter ?? 'unknown'}` : 'New daily report'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="How is the department doing?">
            <FilterSelect value={health} onChange={setHealth} options={Object.entries(HEALTH).map(([k, v]) => [k, v.label] as [string, string])} />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium">Key numbers</p>
            <div className="grid gap-2">
              {metrics.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={m.label}
                    onChange={(e) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    placeholder="Label (e.g. Collections today ₹)"
                    className="h-8"
                  />
                  <Input
                    value={m.value}
                    onChange={(e) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    placeholder="Value"
                    className="h-8 w-40"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    onClick={() => setMetrics((ms) => (ms.length === 1 ? [{ label: '', value: '' }] : ms.filter((_, j) => j !== i)))}
                    aria-label="Remove metric"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-fit" onClick={() => setMetrics((ms) => [...ms, { label: '', value: '' }])}>
                <Plus /> Add number
              </Button>
            </div>
          </div>

          <Field label="Work completed today" htmlFor="d_work">
            <Textarea id="d_work" rows={3} value={work} onChange={(e) => setWork(e.target.value)} disabled={locked} />
          </Field>
          <Field label="Issues / blockers" htmlFor="d_issues" hint="These are highlighted for management.">
            <Textarea id="d_issues" rows={2} value={issues} onChange={(e) => setIssues(e.target.value)} disabled={locked} />
          </Field>
          <Field label="Plan for tomorrow" htmlFor="d_plan">
            <Textarea id="d_plan" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} disabled={locked} />
          </Field>
          <Field label="Remarks" htmlFor="d_rem">
            <Textarea id="d_rem" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={locked} />
          </Field>

          {entry.report?.reviews?.length ? (
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">Management remarks</p>
              <ul className="grid gap-2 text-sm">
                {entry.report.reviews.map((r, i) => (
                  <li key={i}>
                    <Badge variant={r.action === 'founder_remark' ? 'destructive' : 'warning'}>
                      {r.action === 'founder_remark' ? 'Founder' : r.action === 'ccm_remark' ? 'CCM' : r.action}
                    </Badge>{' '}
                    {r.comment}
                    <span className="block text-xs text-muted-foreground">
                      {r.by ?? 'Management'} · {fmtDateTime(r.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => save('draft')} disabled={busy || locked}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Save draft
          </Button>
          <Button onClick={() => save('submitted')} disabled={busy || locked}>
            <Send /> Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================================================================== Review summary
export function ReviewSummaryPage() {
  const can = useCan('daily.summary');
  const [date, setDate] = useState(todayIST());
  const [compare, setCompare] = useState('');
  const review = useDailyReview(date, compare || undefined);
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const monthData = useDailyMonth(month);
  const t = review.data?.totals;

  async function onExport() {
    const rows = review.data?.departments ?? [];
    try {
      await exportCsv('daily.summary', `daily-review-${date}`, rows, [
        { header: 'Department', value: (r) => r.name },
        { header: 'Status', value: (r) => (r.today ? REPORT_STATUS[r.today.status]?.label : 'Not filed') },
        { header: 'Health', value: (r) => (r.today ? HEALTH[r.today.health]?.label : '') },
        { header: 'Reported by', value: (r) => r.today?.reporter },
        { header: 'Key numbers', value: (r) => (r.today?.metrics ?? []).map((m) => `${m.label}: ${m.value}`).join(' | ') },
        { header: 'Work completed', value: (r) => r.today?.work_completed },
        { header: 'Issues', value: (r) => r.today?.issues },
        { header: 'Plan for tomorrow', value: (r) => r.today?.next_day_plan },
        { header: 'Management remarks', value: (r) => (r.today?.reviews ?? []).map((x) => `${x.action}: ${x.comment}`).join(' | ') },
        { header: 'Previous day work', value: (r) => r.previous?.work_completed },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title="Review Summary"
        description="The day at a glance, next to the day before — the comparison the founder's office reviews."
        actions={
          can.export && (
            <Button variant="outline" onClick={onExport}>
              <Download /> Export
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Reported" value={`${fmtNumber(t?.reported)} / ${fmtNumber(t?.departments)}`} icon={ClipboardList} loading={review.isLoading} />
        <StatCard label="On track" value={safeNum(t?.on_track)} icon={CheckCircle2} tone="green" loading={review.isLoading} />
        <StatCard label="Need attention" value={safeNum(t?.needs_attention) + safeNum(t?.critical)} icon={TriangleAlert} tone="amber" loading={review.isLoading} />
        <StatCard label="With open issues" value={safeNum(t?.with_issues)} icon={MessageSquareText} tone="red" loading={review.isLoading} />
      </div>

      <Tabs defaultValue="compare">
        <TabsList>
          <TabsTrigger value="compare">Day comparison</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>

        <TabsContent value="compare">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>{fmtDate(date)}</CardTitle>
                <CardDescription>Compared with {fmtDate(review.data?.compare_date ?? '')}</CardDescription>
              </div>
              <div className="flex gap-3">
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Date</span>
                  <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="w-40" />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Compare with</span>
                  <Input type="date" value={compare} max={date} onChange={(e) => setCompare(e.target.value)} className="w-40" />
                </label>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {review.data?.headline?.metrics?.length ? (
                <div className="flex flex-wrap gap-4 border-y bg-primary-soft/40 px-5 py-3">
                  {review.data.headline.metrics.map((m, i) => (
                    <div key={i}>
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      <div className="tabular text-lg font-bold">{m.value}</div>
                    </div>
                  ))}
                  {review.data.headline.note && <p className="self-center text-sm text-muted-foreground">{review.data.headline.note}</p>}
                </div>
              ) : null}

              {review.isLoading ? (
                <Skeleton className="m-4 h-64" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Department</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Key numbers</TableHead>
                      <TableHead>Today</TableHead>
                      <TableHead className="hidden lg:table-cell">Previous day</TableHead>
                      <TableHead>Management</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(review.data?.departments ?? []).map((d) => (
                      <TableRow key={d.department_id}>
                        <TableCell>
                          <span className="flex items-center gap-2 font-medium">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                            {d.name}
                          </span>
                          <span className="text-xs text-muted-foreground">{d.today?.reporter ?? ''}</span>
                        </TableCell>
                        <TableCell>
                          {d.today ? <StatusChip map={HEALTH} value={d.today.health} /> : <Badge variant="secondary">Not filed</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {(d.today?.metrics ?? []).map((m, i) => (
                            <div key={i} className="whitespace-nowrap">
                              <span className="text-muted-foreground">{m.label}: </span>
                              <span className="tabular font-medium">{m.value}</span>
                            </div>
                          ))}
                        </TableCell>
                        <TableCell className="max-w-xs text-sm">
                          {d.today?.work_completed ?? '—'}
                          {d.today?.issues && <div className="mt-1 text-xs text-amber-700">Issue: {d.today.issues}</div>}
                        </TableCell>
                        <TableCell className="hidden max-w-xs text-sm text-muted-foreground lg:table-cell">
                          {d.previous?.work_completed ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {(d.today?.reviews ?? []).map((r, i) => (
                            <div key={i} className="mb-1">
                              <Badge variant={r.action === 'founder_remark' ? 'destructive' : 'warning'}>
                                {r.action === 'founder_remark' ? 'Founder' : 'CCM'}
                              </Badge>{' '}
                              <span className="text-xs">{r.comment}</span>
                            </div>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="month">
          <Card>
            <CardHeader className="flex-row items-end justify-between">
              <div>
                <CardTitle>Reporting through the month</CardTitle>
                <CardDescription>How many departments reported each day</CardDescription>
              </div>
              <Input type="month" value={month} max={todayIST().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="w-44" />
            </CardHeader>
            <CardContent className="p-0">
              {monthData.isLoading ? (
                <Skeleton className="m-4 h-40" />
              ) : !monthData.data?.length ? (
                <EmptyState icon={CalendarDays} title="No reports this month" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Departments reported</TableHead>
                      <TableHead className="text-right">Needs attention</TableHead>
                      <TableHead className="text-right">Critical</TableHead>
                      <TableHead className="text-right">With issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthData.data.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell>{fmtDate(d.date)}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(d.reported)}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(d.needs_attention)}</TableCell>
                        <TableCell className="tabular text-right">{d.critical > 0 ? <Badge variant="destructive">{fmtNumber(d.critical)}</Badge> : '0'}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(d.issues)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

// ==================================================================== Management review
export function ManagementReviewPage() {
  const can = useCan('daily.review');
  const qc = useQueryClient();
  const { access } = useAccess();
  const departments = useDepartments();
  const [date, setDate] = useState(todayIST());
  const review = useDailyReview(date);
  const [remarkFor, setRemarkFor] = useState<{ report: DeptReport; department: string } | null>(null);
  const [headlineOpen, setHeadlineOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['daily-review'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  async function markReviewed(report: DeptReport) {
    const { error } = await supabase.from('daily_reports').update({ status: 'reviewed' }).eq('id', report.id);
    if (error) return toast.error(errorMessage(error));
    toast.success('Report marked reviewed');
    await refresh();
  }

  const filed = (review.data?.departments ?? []).filter((d) => d.today);
  const pending = filed.filter((d) => d.today?.status === 'submitted');

  return (
    <>
      <PageHeader
        icon={MessageSquareText}
        title="Management Review"
        description="Read the day's reports, add CCM and Founder remarks, and close the loop."
        actions={
          <>
            {(can.create || can.approve) && (
              <Button variant="outline" onClick={() => setBroadcastOpen(true)}>
                <Megaphone /> Remark to all
              </Button>
            )}
            {can.edit && (
              <Button variant="outline" onClick={() => setHeadlineOpen(true)}>
                <Plus /> Day headline
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </label>
          <Badge variant="info">{fmtNumber(pending.length)} awaiting review</Badge>
          <Badge variant="secondary">{fmtNumber(filed.length)} filed</Badge>
          {departments.data && <Badge variant="outline">{fmtNumber(departments.data.filter((d) => d.status === 'active').length)} departments</Badge>}
        </CardContent>
      </Card>

      {review.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !filed.length ? (
        <Card>
          <EmptyState icon={ClipboardList} title="Nothing filed for this day" description="Reports appear here as departments submit them." />
        </Card>
      ) : (
        <div className="grid gap-4">
          {filed.map((d) => (
            <Card key={d.department_id}>
              <CardHeader className="flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    {d.name}
                    <StatusChip map={HEALTH} value={d.today!.health} />
                    <StatusChip map={REPORT_STATUS} value={d.today!.status} />
                  </CardTitle>
                  <CardDescription>{d.today!.reporter ?? 'Unknown reporter'}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {can.create && (
                    <Button size="sm" variant="outline" onClick={() => setRemarkFor({ report: d.today!, department: d.name })}>
                      <MessageSquareText /> Add remark
                    </Button>
                  )}
                  {can.approve && d.today!.status !== 'reviewed' && (
                    <Button size="sm" onClick={() => markReviewed(d.today!)}>
                      <CheckCircle2 /> Mark reviewed
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {d.today!.metrics.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {d.today!.metrics.map((m, i) => (
                      <div key={i}>
                        <div className="text-xs text-muted-foreground">{m.label}</div>
                        <div className="tabular font-semibold">{m.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {d.today!.work_completed && (
                  <div>
                    <div className="text-xs text-muted-foreground">Work completed</div>
                    <p className="whitespace-pre-wrap">{d.today!.work_completed}</p>
                  </div>
                )}
                {d.today!.issues && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                    <div className="text-xs font-medium">Issues</div>
                    <p className="whitespace-pre-wrap">{d.today!.issues}</p>
                  </div>
                )}
                {d.today!.next_day_plan && (
                  <div>
                    <div className="text-xs text-muted-foreground">Plan for tomorrow</div>
                    <p className="whitespace-pre-wrap">{d.today!.next_day_plan}</p>
                  </div>
                )}
                {d.today!.reviews.length > 0 && (
                  <ul className="grid gap-2 border-t pt-3">
                    {d.today!.reviews.map((r, i) => (
                      <li key={i}>
                        <Badge variant={r.action === 'founder_remark' ? 'destructive' : 'warning'}>
                          {r.action === 'founder_remark' ? 'Founder' : 'CCM'}
                        </Badge>{' '}
                        {r.comment}
                        <span className="block text-xs text-muted-foreground">
                          {r.by ?? 'Management'} · {fmtDateTime(r.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RemarkDialog entry={remarkFor} onClose={() => setRemarkFor(null)} onSaved={refresh} reviewerId={access?.profile?.id ?? null} />
      <HeadlineDialog open={headlineOpen} onOpenChange={setHeadlineOpen} date={date} existing={review.data?.headline ?? null} onSaved={refresh} />
      <BroadcastRemarkDialog
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        date={date}
        departments={(review.data?.departments ?? []).map((d) => ({
          id: d.department_id,
          name: d.name,
          reported: !!d.today,
        }))}
        onSaved={refresh}
      />
    </>
  );
}

function RemarkDialog({
  entry,
  onClose,
  onSaved,
  reviewerId,
}: {
  entry: { report: DeptReport; department: string } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  reviewerId: string | null;
}) {
  const [action, setAction] = useState('ccm_remark');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAction('ccm_remark');
    setComment('');
  }, [entry]);

  if (!entry) return null;

  async function save() {
    setBusy(true);
    const { error } = await supabase.from('review_actions').insert({
      report_id: entry!.report.id,
      action,
      comment: comment.trim() || null,
      reviewer_id: reviewerId,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Remark added');
    await onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remark on {entry.department}</DialogTitle>
          <DialogDescription>The department sees this on their report.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Remark type">
            <FilterSelect
              value={action}
              onChange={setAction}
              options={[
                ['ccm_remark', 'CCM remark'],
                ['founder_remark', 'Founder remark'],
                ['returned', 'Send back for correction'],
              ]}
            />
          </Field>
          <Field label="Remark" htmlFor="rk_comment" required>
            <Textarea id="rk_comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !comment.trim()}>
            {busy && <Loader2 className="animate-spin" />} Add remark
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HeadlineDialog({
  open,
  onOpenChange,
  date,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date: string;
  existing: { metrics: Metric[]; note: string | null } | null;
  onSaved: () => Promise<void>;
}) {
  const [metrics, setMetrics] = useState<Metric[]>([{ label: '', value: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMetrics(existing?.metrics?.length ? existing.metrics.map((m) => ({ ...m })) : [{ label: '', value: '' }]);
    setNote(existing?.note ?? '');
  }, [open, existing]);

  const suggestions = useMemo(
    () => ['Collections today (₹)', 'New order value (₹)', 'Installed today (kWp)', 'Generation (kWh)', 'Cash / bank balance (₹)'],
    [],
  );

  async function save() {
    setBusy(true);
    const payload = {
      headline_date: date,
      metrics: metrics.filter((m) => m.label.trim()),
      note: note.trim() || null,
    };
    const { error } = await supabase.from('daily_headlines').upsert(payload, { onConflict: 'headline_date' });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Headline saved');
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Day headline · {fmtDate(date)}</DialogTitle>
          <DialogDescription>The company-wide numbers shown at the top of the review.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {metrics.map((m, i) => (
            <div key={i} className="flex gap-2">
              <Input
                list="headline-suggestions"
                value={m.label}
                onChange={(e) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Label"
                className="h-8"
              />
              <Input
                value={m.value}
                onChange={(e) => setMetrics((ms) => ms.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="Value"
                className="h-8 w-40"
              />
            </div>
          ))}
          <datalist id="headline-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setMetrics((ms) => [...ms, { label: '', value: '' }])}>
            <Plus /> Add number
          </Button>
          <Field label="Note" htmlFor="h_note">
            <Textarea id="h_note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Save headline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * The founder's panel from the old app: one instruction, a date, and
 * either one department or all of them.
 *
 * A remark hangs off a report, so a department that did not report that
 * day cannot receive one. Rather than quietly dropping those, the dialog
 * says up front who will miss it and the result says who did.
 */
function BroadcastRemarkDialog({
  open,
  onOpenChange,
  date,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string;
  departments: { id: string; name: string; reported: boolean }[];
  onSaved: () => Promise<void>;
}) {
  const [target, setTarget] = useState('all');
  const [action, setAction] = useState('founder_remark');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTarget('all');
      setAction('founder_remark');
      setComment('');
    }
  }, [open]);

  const chosen = target === 'all' ? departments : departments.filter((d) => d.id === target);
  const willGet = chosen.filter((d) => d.reported);
  const willMiss = chosen.filter((d) => !d.reported);

  async function save() {
    setBusy(true);
    const { data, error } = await supabase.rpc('save_review_remark', {
      p_date: date,
      p_comment: comment.trim(),
      p_department_ids: target === 'all' ? null : [target],
      p_action: action,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    const r = data as { applied?: number; already_had_it?: number; no_report_that_day?: string[] };
    const missed = r?.no_report_that_day ?? [];
    const applied = safeNum(r?.applied);
    if (applied === 0 && safeNum(r?.already_had_it) > 0) toast.info('They already have that remark.');
    else
      toast.success(
        `Remark added to ${fmtNumber(applied)} report(s)` +
          (missed.length ? ` — ${missed.join(', ')} did not report` : ''),
      );
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remark for {fmtDate(date)}</DialogTitle>
          <DialogDescription>
            Send one instruction to a single department or to all of them at once.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Goes to">
            <FilterSelect
              value={target}
              onChange={setTarget}
              options={[
                ['all', `All departments (${fmtNumber(departments.length)})`],
                ...departments.map((d) => [d.id, d.reported ? d.name : `${d.name} — not reported`] as [string, string]),
              ]}
            />
          </Field>
          <Field label="Remark type">
            <FilterSelect
              value={action}
              onChange={setAction}
              options={[
                ['founder_remark', 'Founder remark'],
                ['ccm_remark', 'CCM remark'],
              ]}
            />
          </Field>
          <Field label="Remarks / instructions" htmlFor="br_comment" required>
            <Textarea id="br_comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          </Field>
          {willMiss.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {willMiss.map((d) => d.name).join(', ')} {willMiss.length === 1 ? 'has' : 'have'} no report on this
                day, so {willMiss.length === 1 ? 'it' : 'they'} will not receive this. It reaches{' '}
                {fmtNumber(willGet.length)} of {fmtNumber(chosen.length)}.
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !comment.trim() || willGet.length === 0}>
            {busy && <Loader2 className="animate-spin" />} Send to {fmtNumber(willGet.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
