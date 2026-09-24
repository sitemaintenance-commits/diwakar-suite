// Performance Score — the PMS score sheet. Nothing on this page is
// typed by anyone: every figure is derived from the daily working
// sheets and the attendance register, using the weights held in
// pms_criteria.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Award, Download, Gauge, ListChecks, TriangleAlert, Users } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useDepartments } from '@/features/admin/api';
import { usePmsScores, type PmsScoreRow } from '@/features/hr/worklog/api';

const RATING: Record<string, 'success' | 'info' | 'secondary' | 'warning' | 'destructive'> = {
  Outstanding: 'success',
  Excellent: 'info',
  'Very Good': 'secondary',
  Good: 'warning',
  'Needs Improvement': 'destructive',
  'Not rated': 'secondary',
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Periods the legacy sheet printed: this month, last month, the year. */
function periods() {
  const today = todayIST();
  const [y, m] = today.slice(0, 10).split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastM = m === 1 ? 12 : m - 1;
  const lastY = m === 1 ? y - 1 : y;
  const endOfLast = new Date(Date.UTC(lastY, lastM, 0)).getUTCDate();
  return {
    month: { label: 'This month', from: `${y}-${pad(m)}-01`, to: today },
    last: { label: 'Last month', from: `${lastY}-${pad(lastM)}-01`, to: `${lastY}-${pad(lastM)}-${pad(endOfLast)}` },
    year: { label: 'This year', from: `${y}-01-01`, to: today },
  };
}

export function ScorecardPage() {
  const can = useCan('hr.scorecard');
  const departments = useDepartments();
  const P = useMemo(periods, []);
  const [which, setWhich] = useState<'month' | 'last' | 'year' | 'custom'>('month');
  const [from, setFrom] = useState(P.month.from);
  const [to, setTo] = useState(P.month.to);
  const [departmentId, setDepartmentId] = useState('all');
  const scores = usePmsScores(from, to, departmentId);
  const s = scores.data;

  function pick(key: 'month' | 'last' | 'year') {
    setWhich(key);
    setFrom(P[key].from);
    setTo(P[key].to);
  }

  const mix = s
    ? [
        { label: 'Completed', value: s.task_completed, tone: 'bg-green-500' },
        { label: 'In progress', value: s.task_in_progress, tone: 'bg-sky-500' },
        { label: 'Not started', value: s.task_not_started, tone: 'bg-slate-400' },
        { label: 'On hold', value: s.task_on_hold, tone: 'bg-amber-500' },
      ]
    : [];
  const mixTotal = mix.reduce((n, x) => n + safeNum(x.value), 0);

  async function onExport() {
    if (!s?.rows.length) return;
    try {
      await exportCsv('hr.scorecard', `performance-${from}-to-${to}`, s.rows, [
        { header: 'Employee number', value: (r: PmsScoreRow) => r.employee_code },
        { header: 'Employee', value: (r) => r.employee },
        { header: 'Designation', value: (r) => r.designation ?? '' },
        { header: 'Department', value: (r) => r.department ?? '' },
        { header: 'Days reported', value: (r) => r.days },
        { header: 'Completed', value: (r) => `${r.completed}/${r.tasks}` },
        { header: 'KPI %', value: (r) => r.kpi },
        { header: 'Competency %', value: (r) => r.competency },
        { header: 'Discipline %', value: (r) => r.discipline },
        { header: 'Attendance %', value: (r) => r.attendance },
        { header: 'Final %', value: (r) => r.final },
        { header: 'Rating', value: (r) => r.rating },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const top = s?.rows.slice(0, 5) ?? [];

  return (
    <>
      <PageHeader
        icon={Award}
        title="Performance Score"
        description="KPI, competency, discipline and attendance, derived from the daily working sheets."
        actions={
          can.export ? (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!s?.rows.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(['month', 'last', 'year'] as const).map((k) => (
              <Button key={k} size="sm" variant={which === k ? 'default' : 'outline'} onClick={() => pick(k)}>
                {P[k].label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:max-w-xl lg:grid-cols-3">
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">From</span>
              <Input type="date" value={from} max={to} onChange={(e) => { setWhich('custom'); setFrom(e.target.value); }} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">To</span>
              <Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => { setWhich('custom'); setTo(e.target.value); }} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Department</span>
              <FilterSelect
                value={departmentId}
                onChange={setDepartmentId}
                options={[['all', 'All departments'], ...(departments.data ?? []).map((d) => [d.id, d.name] as [string, string])]}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {scores.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : scores.error ? (
        <Card>
          <ErrorState message={errorMessage(scores.error)} onRetry={() => scores.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Team performance score"
              value={`${fmtNumber(s?.team_score)}/100`}
              hint={s?.team_rating}
              icon={Gauge}
              tone="green"
            />
            <StatCard label="Tasks reported" value={fmtNumber(s?.task_total)} hint={`${fmtNumber(s?.task_completed)} completed`} icon={ListChecks} />
            <StatCard label="Employees reporting" value={fmtNumber(s?.employee_count)} hint={`${fmtNumber(s?.working_days)} working day(s)`} icon={Users} tone="violet" />
            <StatCard
              label="Not reporting"
              value={fmtNumber(s?.not_reporting.length)}
              hint={s?.not_reporting.length ? 'No sheet filed in this period' : 'Everyone filed'}
              icon={TriangleAlert}
              tone={s?.not_reporting.length ? 'amber' : 'slate'}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Leaderboard</CardTitle>
                <CardDescription>Top performers for {fmtDate(from)} – {fmtDate(to)}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {top.length ? (
                  top.map((r, i) => (
                    <div key={r.employee_id} className="flex items-center gap-3">
                      <span className="tabular w-6 shrink-0 text-sm text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {initials(r.employee)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.employee}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.employee_code} · {r.department ?? '—'} · {r.completed}/{r.tasks} completed
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-semibold">{fmtNumber(r.final)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No sheets filed in this period yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Task mix</CardTitle>
                <CardDescription>{fmtNumber(mixTotal)} task(s) in the period</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {mixTotal > 0 ? (
                  <>
                    <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                      {mix.map((x) =>
                        safeNum(x.value) > 0 ? (
                          <div key={x.label} className={x.tone} style={{ width: `${(safeNum(x.value) / mixTotal) * 100}%` }} />
                        ) : null,
                      )}
                    </div>
                    {mix.map((x) => (
                      <div key={x.label} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${x.tone}`} />
                          {x.label}
                        </span>
                        <span className="tabular text-muted-foreground">{fmtNumber(x.value)}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No tasks reported in this period.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How the score is built</CardTitle>
                <CardDescription>
                  {s?.weights.kpi}/{s?.weights.competency}/{s?.weights.discipline}/{s?.weights.attendance}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex justify-between">
                  <span>KPI achievement</span>
                  <span className="tabular text-muted-foreground">{s?.weights.kpi} marks</span>
                </div>
                <div className="flex justify-between">
                  <span>Competency</span>
                  <span className="tabular text-muted-foreground">{s?.weights.competency} marks</span>
                </div>
                <div className="flex justify-between">
                  <span>Discipline</span>
                  <span className="tabular text-muted-foreground">{s?.weights.discipline} marks</span>
                </div>
                <div className="flex justify-between">
                  <span>Attendance</span>
                  <span className="tabular text-muted-foreground">{s?.weights.attendance} marks</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  KPI starts at {s?.weights.kpi_floor}% for filing the sheet and rises with the work closed; work in progress
                  counts half. Discipline is the days reported out of {fmtNumber(s?.working_days)} working day(s). Attendance
                  comes from the register, or falls back to discipline where attendance is not marked.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Score sheet</CardTitle>
              <CardDescription>
                {fmtDate(from)} – {fmtDate(to)} · {fmtNumber(s?.rows.length)} employee(s)
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!s?.rows.length ? (
                <EmptyState
                  icon={Award}
                  title="No scores yet"
                  description="A line appears here for each employee as soon as they submit a daily working sheet."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee number</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-right">Completed</TableHead>
                        <TableHead className="text-right">KPI</TableHead>
                        <TableHead className="text-right">Competency</TableHead>
                        <TableHead className="text-right">Discipline</TableHead>
                        <TableHead className="text-right">Attendance</TableHead>
                        <TableHead className="text-right">Final</TableHead>
                        <TableHead>Rating</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.rows.map((r) => (
                        <TableRow key={r.employee_id}>
                          <TableCell className="tabular whitespace-nowrap">{r.employee_code}</TableCell>
                          <TableCell>
                            <div className="font-medium">{r.employee}</div>
                            <div className="text-xs text-muted-foreground">{r.designation ?? '—'}</div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.department ?? '—'}</TableCell>
                          <TableCell className="tabular text-right">
                            {r.completed}/{r.tasks}
                          </TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(r.kpi)}%</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(r.competency)}%</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(r.discipline)}%</TableCell>
                          <TableCell className="tabular text-right">
                            {fmtNumber(r.attendance)}%
                            {r.attendance_source === 'discipline' && (
                              <span className="ml-1 text-xs text-muted-foreground" title="No attendance marked; discipline used">
                                *
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="tabular text-right font-semibold">{fmtNumber(r.final)}%</TableCell>
                          <TableCell>
                            <Badge variant={RATING[r.rating] ?? 'secondary'}>{r.rating}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {s?.not_reporting.length ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Not reporting</CardTitle>
                <CardDescription>
                  Employees with no working sheet in this period. They are left out of the averages rather than scored zero.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {s.not_reporting.map((e) => (
                  <Badge key={e.employee_id} variant="secondary">
                    {e.employee}
                    {e.department ? ` · ${e.department}` : ''}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
