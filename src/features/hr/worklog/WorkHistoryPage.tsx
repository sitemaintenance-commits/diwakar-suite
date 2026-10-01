// Work history — the daily sheets as a calendar. Everyone sees their own;
// HR and the Super Admin pick any employee, or see all of them side by side
// for a period (today, yesterday, this week, this month, last month, or any
// month). Each day shows whether the sheet was filed, left as a draft,
// missed, or covered by leave; click a day for its tasks.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Download, ListChecks, Users, XCircle,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, todayIST } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { cn } from '@/lib/utils';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import {
  usePmsScores, useWorkHistory, type HistoryDay, type HistoryState, type WorkTaskStatus,
} from '@/features/hr/worklog/api';

const ALL = '__all__';
const ME = '__me__';

const TASK_STATUS: Record<WorkTaskStatus, { label: string; tone: 'secondary' | 'info' | 'success' | 'warning' }> = {
  not_started: { label: 'Not started', tone: 'secondary' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
};

const DAY_STYLE: Record<HistoryState, { label: string; cell: string; dot: string }> = {
  submitted: { label: 'Filed', cell: 'bg-green-50 border-green-200', dot: 'bg-green-500' },
  draft: { label: 'Draft', cell: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  missed: { label: 'Not filed', cell: 'bg-red-50 border-red-200', dot: 'bg-red-500' },
  absent: { label: 'Absent', cell: 'bg-red-50 border-red-200', dot: 'bg-red-500' },
  leave: { label: 'Leave', cell: 'bg-sky-50 border-sky-200', dot: 'bg-sky-500' },
  holiday: { label: 'Holiday', cell: 'bg-slate-50 border-slate-200', dot: 'bg-slate-400' },
  week_off: { label: 'Week off', cell: 'bg-slate-50 border-slate-200', dot: 'bg-slate-400' },
  none: { label: '', cell: 'bg-background border-border', dot: '' },
};

// ------------------------------------------------------------- dates
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const monthEnd = (s: string) => { const d = toDate(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return iso(d); };
const addMonths = (s: string, n: number) => { const d = toDate(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
const weekday = (s: string) => (toDate(s).getUTCDay() + 6) % 7; // Monday = 0
const monthLabel = (s: string) => toDate(s).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'all' | 'custom';
/** Asking from this far back means "from the start": the server begins at their first sheet. */
const ALL_TIME_FROM = '2000-01-01';

function rangeFor(preset: Preset, month: string): { from: string; to: string; label: string } {
  const today = todayIST();
  switch (preset) {
    case 'today': return { from: today, to: today, label: 'Today' };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y, label: 'Yesterday' }; }
    case 'week': return { from: addDays(today, -weekday(today)), to: today, label: 'This week' };
    case 'month': return { from: monthStart(today), to: today, label: 'This month' };
    case 'last_month': { const m = addMonths(today, -1); return { from: m, to: monthEnd(m), label: monthLabel(m) }; }
    case 'all': return { from: ALL_TIME_FROM, to: today, label: 'All time' };
    default: return { from: monthStart(month), to: monthEnd(month) < today ? monthEnd(month) : today, label: monthLabel(month) };
  }
}

export function WorkHistoryPage() {
  const { access } = useAccess();
  const can = useCan('hr.worklog');
  const scope = access?.permissions?.['hr.worklog']?.scope;
  const seesOthers = Boolean(access?.is_super_admin) || scope === 'all' || scope === 'team';

  const [preset, setPreset] = useState<Preset>('month');
  const [month, setMonth] = useState(monthStart(todayIST()));
  const range = rangeFor(preset, month);
  const [who, setWho] = useState(seesOthers ? ALL : ME);
  const [selected, setSelected] = useState<string | null>(null);

  // The people this user may follow, for the picker and the overview.
  const team = usePmsScores(range.from, range.to, 'all');
  const people = useMemo(() => {
    const rows = team.data?.rows ?? [];
    const missing = team.data?.not_reporting ?? [];
    return [
      ...rows.map((r) => ({ id: r.employee_id, name: r.employee, department: r.department })),
      ...missing.map((r) => ({ id: r.employee_id, name: r.employee, department: r.department })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }, [team.data]);

  const employeeId = who === ME || who === ALL ? null : who;
  const history = useWorkHistory(employeeId, range.from, range.to, who !== ALL);

  function choosePreset(p: Preset) {
    setPreset(p);
    setSelected(null);
  }
  function stepMonth(n: number) {
    const base = preset === 'custom' ? month : preset === 'all' ? monthStart(todayIST()) : monthStart(range.from);
    const next = addMonths(base, n);
    if (next > todayIST()) return;
    setMonth(next);
    setPreset('custom');
    setSelected(null);
  }

  async function exportHistory() {
    const h = history.data;
    if (!h) return;
    type Line = { d: HistoryDay; t: NonNullable<HistoryDay['tasks']>[number] | null };
    const rows: Line[] = h.days.flatMap((d): Line[] => (d.tasks?.length ? d.tasks.map((t) => ({ d, t })) : [{ d, t: null }]));
    try {
      await exportXlsx('hr.worklog', `work-history-${h.employee?.code ?? 'me'}-${range.from}-${range.to}`, rows, [
        { header: 'Date', value: (r) => r.d.date, width: 11 },
        { header: 'Day', value: (r) => DAY_STYLE[r.d.state].label || '—', width: 10 },
        { header: 'Task', value: (r) => (r.t ? `Task ${r.t.seq}` : ''), width: 8 },
        { header: 'Description', value: (r) => r.t?.description ?? '', width: 60 },
        { header: 'Status', value: (r) => (r.t ? TASK_STATUS[r.t.status].label : ''), width: 12 },
        { header: 'Priority', value: (r) => r.d.priority ?? '', width: 10 },
        { header: 'Day score %', value: (r) => (r.d.score == null ? '' : Number(r.d.score)), width: 10 },
        { header: 'Remarks', value: (r) => r.d.remarks ?? '', width: 40 },
      ], {
        sheet: 'Work history',
        title: [`WORK HISTORY · ${h.employee?.name ?? ''} (${h.employee?.code ?? ''})`, `${fmtDate(range.from)} to ${fmtDate(range.to)}`],
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function exportTeam() {
    const rows = team.data?.rows ?? [];
    try {
      await exportXlsx('hr.worklog', `work-history-team-${range.from}-${range.to}`, rows, [
        { header: 'Employee number', value: (r) => r.employee_code, width: 14 },
        { header: 'Employee', value: (r) => r.employee, width: 24 },
        { header: 'Department', value: (r) => r.department ?? '', width: 20 },
        { header: 'Sheets filed', value: (r) => r.days, width: 10 },
        { header: 'Working days', value: () => team.data?.working_days ?? 0, width: 10 },
        { header: 'Tasks', value: (r) => r.tasks, width: 8 },
        { header: 'Completed', value: (r) => r.completed, width: 10 },
        { header: 'Score', value: (r) => r.final, width: 8 },
        { header: 'Rating', value: (r) => r.rating, width: 12 },
      ], { sheet: 'Team', title: ['WORK HISTORY · ALL EMPLOYEES', `${fmtDate(range.from)} to ${fmtDate(range.to)}`] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const presets: [Preset, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['last_month', 'Last month'], ['all', 'All time']];

  return (
    <>
      <PageHeader
        icon={CalendarDays}
        title="Work history"
        description={seesOthers ? 'Everyone’s daily sheets, day by day. Pick an employee, or see all of them for a period.' : 'Your daily sheets, day by day.'}
        actions={
          <Button variant="outline" asChild>
            <Link to="/hr/daily-work"><ClipboardCheck /> Today’s sheet</Link>
          </Button>
        }
      />

      {/* ----------------------------------------------------- controls */}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          {seesOthers && (
            <div className="w-full lg:w-72">
              <FilterSelect value={who} onChange={(v) => { setWho(v); setSelected(null); }}
                options={[[ALL, 'All employees'], [ME, 'My own sheets'], ...people.map((p) => [p.id, p.name] as [string, string])]} />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {presets.map(([p, label]) => (
              <Button key={p} size="sm" variant={preset === p ? 'default' : 'outline'} onClick={() => choosePreset(p)}>{label}</Button>
            ))}
          </div>
          <div className="flex items-center gap-1 lg:ml-auto">
            <Button size="icon-sm" variant="ghost" aria-label="Previous month" onClick={() => stepMonth(-1)}><ChevronLeft /></Button>
            <span className="min-w-36 text-center text-sm font-medium">{range.label}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Next month" onClick={() => stepMonth(1)}
              disabled={addMonths(preset === 'custom' ? month : monthStart(range.from), 1) > todayIST()}><ChevronRight /></Button>
          </div>
        </CardContent>
      </Card>

      {who === ALL ? (
        <TeamOverview
          loading={team.isLoading} error={team.error} onRetry={() => team.refetch()}
          rows={team.data?.rows ?? []} notReporting={team.data?.not_reporting ?? []}
          // The score sheet counts at least one working day; with nothing filed there were none.
          workingDays={(team.data?.rows ?? []).some((r) => r.days > 0) ? team.data?.working_days ?? 0 : 0} range={range}
          canExport={can.export} onExport={exportTeam}
          onOpen={(id) => { setWho(id); setSelected(null); }}
        />
      ) : history.isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : history.error ? (
        <Card><ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} /></Card>
      ) : history.data ? (
        <EmployeeHistory
          data={history.data} range={range} selected={selected} onSelect={setSelected}
          onOpenMonth={(m) => { setMonth(m); setPreset('custom'); setSelected(null); }}
          canExport={can.export} onExport={exportHistory}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------- one employee
function EmployeeHistory({ data, range: asked, selected, onSelect, onOpenMonth, canExport, onExport }: {
  data: NonNullable<ReturnType<typeof useWorkHistory>['data']>;
  range: { from: string; to: string; label: string };
  selected: string | null;
  onSelect: (d: string) => void;
  onOpenMonth: (month: string) => void;
  canExport: boolean;
  onExport: () => void;
}) {
  const s = data.summary;
  // The server may start later than asked ("All time" starts at the first sheet).
  const range = { ...asked, from: data.from, to: data.to };
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const long = data.days.length > 62;
  const months = long ? monthRows(data.days) : [];
  const single = range.from === range.to;
  const focus = selected ?? (single ? range.from : [...data.days].reverse().find((d) => d.state !== 'none')?.date ?? null);
  const focusDay = focus ? byDate.get(focus) : undefined;

  // Whole weeks, Monday to Sunday, around the period.
  const start = addDays(range.from, -weekday(range.from));
  const end = addDays(range.to, 6 - weekday(range.to));
  const cells: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push(d);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{data.employee?.name}</h2>
          <p className="text-sm text-muted-foreground">
            {[data.employee?.code, data.employee?.designation, data.employee?.department].filter(Boolean).join(' · ')}
          </p>
        </div>
        {canExport && <Button variant="outline" size="sm" onClick={onExport}><Download /> Export Excel</Button>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Working days" value={fmtNumber(s.working_days)} icon={CalendarDays} />
        <StatCard label="Sheets filed" value={fmtNumber(s.submitted)} icon={CheckCircle2} tone="green" hint={s.drafts ? `${s.drafts} draft(s)` : undefined} />
        <StatCard label="Not filed" value={fmtNumber(s.missed)} icon={XCircle} tone="red" />
        <StatCard label="Leave / off" value={fmtNumber(s.leave)} icon={CalendarDays} tone="blue" />
        <StatCard label="Tasks" value={fmtNumber(s.tasks)} hint={`${fmtNumber(s.completed)} completed`} icon={ListChecks} />
        <StatCard label="Score" value={s.score == null ? '—' : `${fmtNumber(s.score)}%`} hint="Completed + half of in progress" icon={CheckCircle2} tone="amber" />
      </div>

      {long && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Month by month</CardTitle>
            <CardDescription>Since {fmtDate(data.from)}. Click a month for its calendar.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Sheets filed</TableHead>
                  <TableHead className="text-right">Not filed</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Leave / off</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Tasks</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.month} className="cursor-pointer" onClick={() => onOpenMonth(m.month)}>
                    <TableCell className="font-medium text-primary">{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular">{fmtNumber(m.filed)} / {fmtNumber(m.working)}</TableCell>
                    <TableCell className={cn('text-right tabular', m.missed > 0 && 'font-semibold text-red-600')}>{fmtNumber(m.missed)}</TableCell>
                    <TableCell className="hidden text-right tabular sm:table-cell">{fmtNumber(m.leave)}</TableCell>
                    <TableCell className="hidden text-right tabular sm:table-cell">{fmtNumber(m.completed)} / {fmtNumber(m.tasks)}</TableCell>
                    <TableCell className="text-right tabular">{m.score == null ? '—' : `${fmtNumber(m.score)}%`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!single && !long && (
        <Card className="mb-4">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:gap-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="pb-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {cells.map((date) => {
                const d = byDate.get(date);
                const inRange = date >= range.from && date <= range.to;
                const style = DAY_STYLE[d?.state ?? 'none'];
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!inRange}
                    onClick={() => onSelect(date)}
                    className={cn(
                      'flex min-h-16 flex-col items-start rounded-md border p-1.5 text-left text-xs transition-colors sm:min-h-20 sm:p-2',
                      inRange ? style.cell : 'border-transparent bg-transparent text-muted-foreground/40',
                      inRange && 'hover:ring-2 hover:ring-primary/30',
                      focus === date && 'ring-2 ring-primary',
                    )}
                  >
                    <span className="font-semibold">{Number(date.slice(8))}</span>
                    {inRange && d && d.state !== 'none' && (
                      <span className="mt-auto flex items-center gap-1 leading-tight">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
                        <span className="hidden sm:inline">{style.label}</span>
                        {(d.state === 'submitted' || d.state === 'draft') && d.task_count != null && (
                          <span className="text-muted-foreground">
                            <span className="sm:hidden">{d.task_count}</span>
                            <span className="hidden sm:inline"> · {d.task_count} task{d.task_count === 1 ? '' : 's'}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {(['submitted', 'draft', 'missed', 'leave', 'holiday'] as HistoryState[]).map((k) => (
                <span key={k} className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', DAY_STYLE[k].dot)} />{DAY_STYLE[k].label}</span>
              ))}
              <span>A day counts as a working day when anyone filed a sheet.</span>
            </div>
          </CardContent>
        </Card>
      )}

      <DayDetail day={focusDay} date={focus} />
    </>
  );
}

/** Days grouped by month, newest first, for the "All time" summary. */
function monthRows(days: HistoryDay[]) {
  const by = new Map<string, { month: string; working: number; filed: number; missed: number; leave: number; tasks: number; completed: number; done: number }>();
  for (const d of days) {
    const key = monthStart(d.date);
    const m = by.get(key) ?? { month: key, working: 0, filed: 0, missed: 0, leave: 0, tasks: 0, completed: 0, done: 0 };
    if (d.working) m.working += 1;
    if (d.state === 'submitted') {
      m.filed += 1;
      m.tasks += d.task_count ?? 0;
      m.completed += d.completed ?? 0;
      m.done += (d.completed ?? 0) + 0.5 * (d.in_progress ?? 0);
    }
    if (d.state === 'missed' || d.state === 'absent') m.missed += 1;
    if (d.state === 'leave' || d.state === 'holiday' || d.state === 'week_off') m.leave += 1;
    by.set(key, m);
  }
  return [...by.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((m) => ({ ...m, score: m.tasks ? Math.round((100 * m.done) / m.tasks) : null }));
}

function DayDetail({ day, date }: { day: HistoryDay | undefined; date: string | null }) {
  if (!date) {
    return <Card><EmptyState icon={CalendarDays} title="Nothing filed in this period" description="Pick another period, or another employee." /></Card>;
  }
  const style = DAY_STYLE[day?.state ?? 'none'];
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{fmtDate(date)}</CardTitle>
          <CardDescription>
            {day?.state === 'submitted' || day?.state === 'draft'
              ? `${style.label} · ${day.task_count ?? 0} task(s) · priority ${day.priority ?? '—'}${day.score != null ? ` · score ${fmtNumber(day.score)}%` : ''}`
              : style.label || 'No sheet, and not a working day'}
          </CardDescription>
        </div>
        {day?.state && day.state !== 'none' && <Badge variant={day.state === 'submitted' ? 'success' : day.state === 'draft' ? 'warning' : day.state === 'missed' || day.state === 'absent' ? 'destructive' : 'info'}>{style.label}</Badge>}
      </CardHeader>
      <CardContent>
        {day?.tasks?.length ? (
          <ol className="space-y-2">
            {day.tasks.map((t) => (
              <li key={t.seq} className="flex items-start gap-3 text-sm">
                <span className="w-6 shrink-0 text-right tabular text-muted-foreground">{t.seq}.</span>
                <span className="flex-1">{t.description}</span>
                <Badge variant={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            {day?.state === 'missed' ? 'No sheet was filed for this working day.' : 'No tasks for this day.'}
          </p>
        )}
        {day?.remarks && <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm"><span className="font-medium">Remarks: </span>{day.remarks}</p>}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------- all employees
function TeamOverview({ loading, error, onRetry, rows, notReporting, workingDays, range, canExport, onExport, onOpen }: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  rows: NonNullable<ReturnType<typeof usePmsScores>['data']>['rows'];
  notReporting: { employee_id: string; employee: string; department: string | null }[];
  workingDays: number;
  range: { from: string; to: string; label: string };
  canExport: boolean;
  onExport: () => void;
  onOpen: (id: string) => void;
}) {
  if (loading) return <Skeleton className="h-96 rounded-xl" />;
  if (error) return <Card><ErrorState message={errorMessage(error)} onRetry={onRetry} /></Card>;
  const sorted = [...rows].sort((a, b) => a.employee.localeCompare(b.employee));
  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> All employees · {range.label}</CardTitle>
          <CardDescription>
            {range.from === ALL_TIME_FROM ? `Up to ${fmtDate(range.to)}` : `${fmtDate(range.from)}${range.from !== range.to ? ` to ${fmtDate(range.to)}` : ''}`} · {fmtNumber(workingDays)} working day(s).
            Click a name for their calendar.
          </CardDescription>
        </div>
        {canExport && <Button variant="outline" size="sm" onClick={onExport} disabled={!rows.length}><Download /> Export Excel</Button>}
      </CardHeader>
      <CardContent className="p-0">
        {!rows.length && !notReporting.length ? (
          <EmptyState icon={Users} title="No sheets in this period" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="text-right">Sheets filed</TableHead>
                <TableHead className="text-right">Not filed</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Tasks</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.employee_id} className="cursor-pointer" onClick={() => onOpen(r.employee_id)}>
                  <TableCell>
                    <div className="font-medium text-primary">{r.employee}</div>
                    <div className="text-xs text-muted-foreground">{r.employee_code}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{r.department ?? '—'}</TableCell>
                  <TableCell className="text-right tabular">{fmtNumber(r.days)} / {fmtNumber(workingDays)}</TableCell>
                  <TableCell className={cn('text-right tabular', workingDays - r.days > 0 && 'font-semibold text-red-600')}>
                    {fmtNumber(Math.max(0, workingDays - r.days))}
                  </TableCell>
                  <TableCell className="hidden text-right tabular sm:table-cell">{fmtNumber(r.completed)} / {fmtNumber(r.tasks)}</TableCell>
                  <TableCell className="text-right tabular">{fmtNumber(r.final)} <span className="text-xs text-muted-foreground">{r.rating}</span></TableCell>
                </TableRow>
              ))}
              {notReporting.map((r) => (
                <TableRow key={r.employee_id} className="cursor-pointer bg-red-50/40" onClick={() => onOpen(r.employee_id)}>
                  <TableCell><div className="font-medium text-primary">{r.employee}</div></TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{r.department ?? '—'}</TableCell>
                  <TableCell className="text-right tabular">0 / {fmtNumber(workingDays)}</TableCell>
                  <TableCell className="text-right tabular font-semibold text-red-600">{fmtNumber(workingDays)}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">—</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">Nothing filed</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
