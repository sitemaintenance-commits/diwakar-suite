// Team Performance — the daily technician score the O&M CRM kept in a
// Google Form and a sheet. Eighty of the hundred marks are derived by the
// database from the register, the task log and the daily field entry; the
// last twenty are the reviewers' judgement and need APPROVE.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Download, Gauge, ListChecks, TrendingUp, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
import { useSites } from '@/features/admin/api';
import { useTeamPerformance, type TechScore } from '@/features/om/opsApi';

const BAND: Record<string, 'success' | 'warning' | 'destructive'> = {
  Good: 'success',
  Average: 'warning',
  Critical: 'destructive',
};

/** A labelled score bar — one series, so the label is the legend. */
function ScoreBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="tabular shrink-0 text-muted-foreground">
          {fmtNumber(value)}%{hint ? ` · ${hint}` : ''}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className={`h-2 rounded-full ${pct >= 70 ? 'bg-primary' : pct >= 55 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function daysAgo(n: number) {
  const d = new Date(`${todayIST()}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function TeamPerformancePage() {
  const can = useCan('om.performance');
  const qc = useQueryClient();
  const sites = useSites();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayIST());
  const [siteId, setSiteId] = useState('all');
  const perf = useTeamPerformance(from, to, siteId);
  const p = perf.data;

  async function saveMonthly(row: TechScore, value: string) {
    const marks = value.trim() === '' ? null : Math.round(safeNum(value));
    if (marks === null || marks === row.monthly_review) return;
    const { error } = await supabase.rpc('save_tech_score', { p_id: row.id, p_monthly_review: marks, p_remarks: null });
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['team-performance'] });
    toast.success(`${row.technician}: monthly marks saved.`);
  }

  async function onExport() {
    if (!p?.records.length) return;
    try {
      await exportCsv('om.performance', `technician-scores-${from}-to-${to}`, p.records, [
        { header: 'Date', value: (r) => r.score_date },
        { header: 'Site', value: (r) => r.site },
        { header: 'Technician', value: (r) => r.technician },
        { header: 'Attendance /20', value: (r) => r.attendance },
        { header: 'Daily work /25', value: (r) => r.daily_work },
        { header: 'Task assigned /10', value: (r) => r.task_assigned },
        { header: 'Task status', value: (r) => r.task_status },
        { header: 'Form submit /25', value: (r) => r.form_submit },
        { header: 'Auto /80', value: (r) => r.auto_score },
        { header: 'Monthly /20', value: (r) => r.monthly_review ?? '' },
        { header: 'Total /100', value: (r) => r.total_score },
        { header: 'Band', value: (r) => r.band },
        { header: 'Remarks', value: (r) => r.remarks ?? '' },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const best = p?.ranking?.[0];
  const worst = p?.ranking?.length ? p.ranking[p.ranking.length - 1] : undefined;

  return (
    <>
      <PageHeader
        icon={TrendingUp}
        title="Team Performance"
        description="Each technician's day, scored out of 100 from the work the suite already records."
        actions={
          can.export ? (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!p?.records.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">From</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">To</span>
            <Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Site</span>
            <FilterSelect
              value={siteId}
              onChange={setSiteId}
              options={[['all', 'All my sites'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]}
            />
          </label>
          <div className="flex items-end text-xs text-muted-foreground">
            {fmtDate(from)} – {fmtDate(to)}
          </div>
        </CardContent>
      </Card>

      {perf.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : perf.error ? (
        <Card>
          <ErrorState message={errorMessage(perf.error)} onRetry={() => perf.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Scored days" value={fmtNumber(p?.record_count)} hint={`${fmtDate(from)} – ${fmtDate(to)}`} icon={ListChecks} />
            <StatCard label="Average score" value={`${fmtNumber(p?.average, 1)}%`} icon={Gauge} tone="green" />
            <StatCard
              label="Best technician"
              value={best ? best.technician : '—'}
              hint={best ? `${fmtNumber(best.score)}% · ${best.site}` : 'No scores yet'}
              icon={Award}
              tone="amber"
            />
            <StatCard
              label="Awaiting monthly marks"
              value={fmtNumber(p?.pending_review)}
              hint="The 20 marks set at month end"
              icon={UserCheck}
              tone="violet"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>How the score is built</CardTitle>
                <CardDescription>
                  The first four criteria are read from the site register, the task log and the daily field entry. The last
                  twenty marks are entered by a reviewer.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">S.No</TableHead>
                      <TableHead>Criteria</TableHead>
                      <TableHead className="hidden sm:table-cell">Description</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(p?.criteria ?? []).map((c, i) => (
                      <TableRow key={c.key}>
                        <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{c.label}</TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{c.description}</TableCell>
                        <TableCell>
                          <Badge variant={c.is_auto ? 'info' : 'secondary'}>{c.is_auto ? 'Automatic' : 'Reviewer'}</Badge>
                        </TableCell>
                        <TableCell className="tabular text-right font-semibold">{c.max_score}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Site average</CardTitle>
                <CardDescription>Team score per site for the period</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {p?.by_site.length ? (
                  p.by_site.map((s) => <ScoreBar key={s.site_id} label={s.site} value={safeNum(s.score)} hint={`${s.records} day(s)`} />)
                ) : (
                  <p className="text-sm text-muted-foreground">No scores in this period yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Technician ranking</CardTitle>
                <CardDescription>Average of every scored day in the period</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {p?.ranking.length ? (
                  p.ranking.map((r, i) => (
                    <div key={`${r.technician}-${i}`} className="flex items-center gap-3">
                      <span className="tabular w-6 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <ScoreBar label={r.technician} value={safeNum(r.score)} hint={r.site} />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No scores in this period yet.</p>
                )}
                {worst && p && p.ranking.length > 1 && safeNum(worst.score) < 70 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Needs review: {worst.technician} at {fmtNumber(worst.score)}% ({worst.site}).
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Week by week</CardTitle>
                <CardDescription>Average score per week</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {p?.weekly.length ? (
                  p.weekly.map((w) => (
                    <ScoreBar key={w.week_start} label={fmtDate(w.week_start)} value={safeNum(w.score)} hint={`${w.records} record(s)`} />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No scores in this period yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Daily technician records</CardTitle>
              <CardDescription>
                {fmtNumber(p?.record_count)} record(s){can.approve ? ' · type the monthly marks (0–20) to award them' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!p?.records.length ? (
                <EmptyState
                  icon={ListChecks}
                  title="No scores yet"
                  description="A score appears for each technician as soon as their site register for the day is submitted."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Site</TableHead>
                        <TableHead>Technician</TableHead>
                        <TableHead className="text-right">Attendance</TableHead>
                        <TableHead className="text-right">Daily work</TableHead>
                        <TableHead className="text-right">Task</TableHead>
                        <TableHead>Task status</TableHead>
                        <TableHead className="text-right">Form</TableHead>
                        <TableHead className="text-right">Auto /80</TableHead>
                        <TableHead className="text-right">Monthly /20</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Band</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.records.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap">{fmtDate(r.score_date)}</TableCell>
                          <TableCell>{r.site}</TableCell>
                          <TableCell className="font-medium">{r.technician}</TableCell>
                          <TableCell className="tabular text-right">{r.attendance}/20</TableCell>
                          <TableCell className="tabular text-right">{r.daily_work}/25</TableCell>
                          <TableCell className="tabular text-right">{r.task_assigned}/10</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.task_status}</TableCell>
                          <TableCell className="tabular text-right">{r.form_submit}/25</TableCell>
                          <TableCell className="tabular text-right font-medium">{r.auto_score}/80</TableCell>
                          <TableCell className="text-right">
                            {can.approve ? (
                              <Input
                                type="number"
                                min={0}
                                max={20}
                                defaultValue={r.monthly_review ?? ''}
                                onBlur={(e) => saveMonthly(r, e.target.value)}
                                className="tabular h-8 w-20 text-right"
                              />
                            ) : (
                              <span className="tabular">{r.monthly_review === null ? '—' : `${r.monthly_review}/20`}</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular text-right font-semibold">{r.total_score}/100</TableCell>
                          <TableCell>
                            <Badge variant={BAND[r.band]}>{r.band}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
