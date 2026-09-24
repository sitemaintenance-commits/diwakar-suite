// Daily Work — the "Daily Employee Working Sheet" that the PMS Google
// Form collected: up to ten tasks, each with a status, plus a priority
// and remarks. Filing it is what feeds the performance score, so the
// page shows the day's score as it is typed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardCheck, Download, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, todayIST } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useMyWorkLog, useWorkLogDay, type WorkTaskStatus } from '@/features/hr/worklog/api';

const MAX_TASKS = 10;

const STATUS: Record<WorkTaskStatus, { label: string; tone: 'secondary' | 'info' | 'success' | 'warning' }> = {
  not_started: { label: 'Not started', tone: 'secondary' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
};
const STATUS_OPTIONS = (Object.keys(STATUS) as WorkTaskStatus[]).map((k) => [k, STATUS[k].label] as [string, string]);

interface Row {
  description: string;
  status: WorkTaskStatus;
}

export function DailyWorkPage() {
  const can = useCan('hr.worklog');
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIST());
  const sheet = useMyWorkLog(date);
  const data = sheet.data;

  const [rows, setRows] = useState<Row[]>([]);
  const [priority, setPriority] = useState('medium');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  // Load once per date so a background refetch cannot wipe what is being typed.
  const loadedFor = useRef('');
  useEffect(() => {
    if (!data) return;
    if (loadedFor.current === date) return;
    loadedFor.current = date;
    const existing = data.tasks.map((t) => ({ description: t.description, status: t.status }));
    setRows(existing.length ? existing : [{ description: '', status: 'not_started' }]);
    setPriority(data.log?.priority ?? 'medium');
    setRemarks(data.log?.remarks ?? '');
  }, [data, date]);

  const filled = rows.filter((r) => r.description.trim() !== '');
  const counts = useMemo(() => {
    const c = { completed: 0, in_progress: 0, not_started: 0, on_hold: 0 };
    for (const r of filled) c[r.status] += 1;
    return c;
  }, [filled]);
  const ratio = filled.length ? (counts.completed + 0.5 * counts.in_progress) / filled.length : 0;
  const submitted = data?.log?.status === 'submitted';
  const locked = submitted && !can.approve;

  function setRow(i: number, patch: Partial<Row>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save(submit: boolean) {
    if (submit && !filled.length) return toast.error('Add at least one task before submitting.');
    setBusy(submit ? 'submit' : 'draft');
    const { error } = await supabase.rpc('save_work_log', {
      p_date: date,
      p_tasks: filled.map((r, i) => ({ seq: i + 1, description: r.description.trim(), status: r.status })),
      p_priority: priority,
      p_remarks: remarks.trim() || null,
      p_submit: submit,
      p_employee_id: null,
    });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    loadedFor.current = '';
    await qc.invalidateQueries({ queryKey: ['my-work-log'] });
    await qc.invalidateQueries({ queryKey: ['work-log-day'] });
    await qc.invalidateQueries({ queryKey: ['pms-scores'] });
    toast.success(submit ? 'Work sheet submitted.' : 'Draft saved.');
  }

  if (sheet.isLoading) {
    return (
      <>
        <PageHeader icon={ClipboardCheck} title="Daily Work" description="Your working sheet for the day." />
        <Skeleton className="h-96 rounded-xl" />
      </>
    );
  }

  if (sheet.error) {
    return (
      <>
        <PageHeader icon={ClipboardCheck} title="Daily Work" />
        <Card>
          <ErrorState message={errorMessage(sheet.error)} onRetry={() => sheet.refetch()} />
        </Card>
      </>
    );
  }

  if (!data?.employee) {
    return (
      <>
        <PageHeader icon={ClipboardCheck} title="Daily Work" />
        <Card>
          <EmptyState
            icon={ClipboardCheck}
            title="Your login is not linked to an employee record"
            description="Ask HR to link your user account to your employee record in Employees, then this sheet will open."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title="Daily Work"
        description={`${data.employee.name} · ${data.employee.designation ?? '—'} · ${data.employee.department ?? '—'}`}
        actions={
          <Badge variant={submitted ? 'success' : 'secondary'}>{submitted ? 'Submitted' : 'Draft'}</Badge>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tasks" value={fmtNumber(filled.length)} hint={`Up to ${MAX_TASKS} a day`} icon={ClipboardCheck} />
        <StatCard label="Completed" value={fmtNumber(counts.completed)} icon={CheckCircle2} tone="green" />
        <StatCard label="In progress" value={fmtNumber(counts.in_progress)} hint="Counts half" icon={Loader2} tone="blue" />
        <StatCard label="Day score" value={`${fmtNumber(ratio * 100)}%`} hint="Completion of today's sheet" icon={CheckCircle2} tone="amber" />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Task list</CardTitle>
            <CardDescription>What you worked on, and where each item stands</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Date
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Priority
              <div className="w-36">
                <FilterSelect
                  value={priority}
                  onChange={setPriority}
                  options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']]}
                />
              </div>
            </label>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
              <span className="tabular w-16 shrink-0 text-sm text-muted-foreground">Task {i + 1}</span>
              <Input
                value={r.description}
                onChange={(e) => setRow(i, { description: e.target.value })}
                placeholder="What did you work on?"
                disabled={locked}
                className="flex-1"
              />
              <div className="w-full sm:w-40">
                <FilterSelect
                  value={r.status}
                  onChange={(v) => setRow(i, { status: v as WorkTaskStatus })}
                  options={STATUS_OPTIONS}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={locked || rows.length === 1}
                onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                aria-label={`Remove task ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={locked || rows.length >= MAX_TASKS}
              onClick={() => setRows((p) => [...p, { description: '', status: 'not_started' }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add task
            </Button>
          </div>

          <label className="mt-2 grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Remarks</span>
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={locked} />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {submitted
                ? `Submitted ${data.log?.submitted_at ? fmtDate(data.log.submitted_at) : ''}${locked ? ' · ask HR to reopen it to make changes' : ''}`
                : 'Submit once, at the end of the day.'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => save(false)} disabled={locked || busy !== null}>
                {busy === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save draft
              </Button>
              <Button onClick={() => save(true)} disabled={locked || busy !== null}>
                {busy === 'submit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Submit sheet
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {data.recent.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Your last two weeks</CardTitle>
            <CardDescription>Every day you reported, and how much of it closed</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.recent.map((d) => (
              <button
                key={d.date}
                onClick={() => setDate(d.date)}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-muted"
              >
                <span>{fmtDate(d.date)}</span>
                <span className="tabular text-muted-foreground">
                  {d.completed}/{d.task_count}
                  {d.status === 'draft' && <Badge variant="secondary" className="ml-2">Draft</Badge>}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {can.view && <DaySheets canExport={can.export} />}
    </>
  );
}

// ------------------------------------------------------- the day's sheets
function DaySheets({ canExport }: { canExport: boolean }) {
  const [date, setDate] = useState(todayIST());
  const day = useWorkLogDay(date);
  const entries = day.data?.entries ?? [];

  async function onExport() {
    if (!entries.length) return;
    try {
      await exportCsv(
        'hr.worklog',
        `daily-work-${date}`,
        entries.flatMap((e) => e.tasks.map((t) => ({ e, t }))),
        [
          { header: 'Date', value: (r) => r.e.date },
          { header: 'Employee number', value: (r) => r.e.employee_code },
          { header: 'Employee', value: (r) => r.e.employee },
          { header: 'Department', value: (r) => r.e.department ?? '' },
          { header: 'Task', value: (r) => `Task ${r.t.seq}` },
          { header: 'Description', value: (r) => r.t.description },
          { header: 'Status', value: (r) => STATUS[r.t.status].label },
          { header: 'Priority', value: (r) => r.e.priority },
          { header: 'Summary', value: (r) => `${r.e.completed}/${r.e.task_count}` },
          { header: 'Score %', value: (r) => r.e.score },
          { header: 'Remarks', value: (r) => r.e.remarks ?? '' },
        ],
      );
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle>Sheets filed on {fmtDate(date)}</CardTitle>
          <CardDescription>{fmtNumber(entries.length)} sheet(s) you are allowed to see</CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
          {canExport && (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!entries.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {day.error ? (
          <ErrorState message={errorMessage(day.error)} onRetry={() => day.refetch()} />
        ) : !entries.length ? (
          <EmptyState icon={ClipboardCheck} title="Nothing filed for this date" description="Sheets appear here as they are submitted." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-right">Summary</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium">{e.employee}</div>
                    <div className="text-xs text-muted-foreground">{e.employee_code} · {e.designation ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.department ?? '—'}</TableCell>
                  <TableCell>
                    <ol className="grid gap-1">
                      {e.tasks.map((t) => (
                        <li key={t.seq} className="flex items-start gap-2 text-sm">
                          <Badge variant={STATUS[t.status].tone} className="mt-0.5 shrink-0">
                            {STATUS[t.status].label}
                          </Badge>
                          <span className="min-w-0">{t.description}</span>
                        </li>
                      ))}
                    </ol>
                  </TableCell>
                  <TableCell className="capitalize">{e.priority}</TableCell>
                  <TableCell className="tabular text-right">
                    {e.completed}/{e.task_count}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">{fmtNumber(e.score)}%</TableCell>
                  <TableCell className="max-w-[14rem] truncate text-sm text-muted-foreground">{e.remarks ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
