// Team Performance — the daily technician score. The technicians' Google
// Form ("Daily Solar Site Technician Work Tracker") is read every 30
// minutes and scored as the O&M CRM did: attendance 20, daily work 25, task
// assigned 10, form submitted 25; the last twenty are the reviewers'
// month-end judgement and need APPROVE. Today / Last day / Previous jump
// between single days, as the old CRM did.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, CalendarDays, ChevronLeft, ChevronRight, Download, Gauge, ListChecks, TrendingUp, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
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
  return d.toLocaleDateString('en-CA');   // local date: toISOString would step back a day in India
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
  const today = todayIST();
  const lastDay = daysAgo(1);
  const oneDay = from === to;
  /** Show a single day; Previous / Next step from the day shown. */
  const showDay = (d: string) => { setFrom(d); setTo(d); };
  const step = (n: number) => {
    const d = new Date(`${oneDay ? from : to}T00:00:00`);
    d.setDate(d.getDate() + n);
    const iso = d.toLocaleDateString('en-CA');
    if (iso <= today) showDay(iso);
  };

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
      await exportXlsx('om.performance', `team-performance-${from}-to-${to}`, p.records, [
        { header: 'Date', value: (r) => fmtDate(r.score_date), width: 12 },
        { header: 'Site', value: (r) => r.site, width: 16 },
        { header: 'Technician', value: (r) => r.technician, width: 24 },
        { header: 'Attendance /20', value: (r) => safeNum(r.attendance), width: 13 },
        { header: 'Daily work /25', value: (r) => safeNum(r.daily_work), width: 13 },
        { header: 'Task assigned /10', value: (r) => safeNum(r.task_assigned), width: 15 },
        { header: 'Task status', value: (r) => (r.task_status === '—' ? '' : r.task_status), width: 15 },
        { header: 'Form submit /25', value: (r) => safeNum(r.form_submit), width: 14 },
        { header: 'Auto /80', value: (r) => safeNum(r.auto_score), width: 10 },
        { header: 'Monthly /20', value: (r) => (r.monthly_review == null ? '' : safeNum(r.monthly_review)), width: 11 },
        { header: 'Total /100', value: (r) => safeNum(r.total_score), width: 10 },
        { header: 'Band', value: (r) => r.band, width: 10 },
        { header: 'Remarks', value: (r) => r.remarks ?? '', width: 40 },
      ], {
        sheet: 'Team performance',
        title: ['O&M TEAM PERFORMANCE', from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`],
      });
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
        description="Each technician's day, scored out of 100 from the technicians' daily form (synced every 30 minutes)."
        actions={
          can.export ? (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!p?.records.length}>
              <Download className="mr-2 h-4 w-4" />
              Download Excel
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
          <div className="flex flex-wrap items-end gap-1.5">
            <Button size="sm" variant={oneDay && from === today ? 'default' : 'outline'} onClick={() => showDay(today)}>Today</Button>
            <Button size="sm" variant={oneDay && from === lastDay ? 'default' : 'outline'} onClick={() => showDay(lastDay)}>Last day</Button>
            <Button size="icon-sm" variant="outline" aria-label="Previous day" title="Previous day" onClick={() => step(-1)}><ChevronLeft /></Button>
            <Button size="icon-sm" variant="outline" aria-label="Next day" title="Next day" disabled={oneDay && from >= today} onClick={() => step(1)}><ChevronRight /></Button>
            <Button size="sm" variant={!oneDay && to === today && from === daysAgo(29) ? 'default' : 'ghost'} onClick={() => { setFrom(daysAgo(29)); setTo(today); }}>
              <CalendarDays /> 30 days
            </Button>
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
            <StatCard label={oneDay ? 'Records' : 'Scored days'} value={fmtNumber(p?.record_count)}
              hint={oneDay ? `${fmtDate(from)}${from === today ? ' (today)' : from === lastDay ? ' (last day)' : ''}` : `${fmtDate(from)} – ${fmtDate(to)}`} icon={ListChecks} />
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

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>How the score is built</CardTitle>
                <CardDescription>
                  The first four criteria come from each technician's daily form: present 20, work written 25, task assigned
                  10, form submitted 25. The last twenty marks are entered by a reviewer at month end.
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

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
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
                <div>
                  <Table className="text-[13px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Technician · site · date</TableHead>
                        <TableHead className="text-right">Present /20</TableHead>
                        <TableHead className="text-right">Work /25</TableHead>
                        <TableHead className="text-right">Task /10</TableHead>
                        <TableHead>Task status</TableHead>
                        <TableHead className="text-right">Form /25</TableHead>
                        <TableHead className="text-right">Auto /80</TableHead>
                        <TableHead className="text-right">Monthly /20</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Band</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.records.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap">
                            <div className="font-medium">{r.technician}</div>
                            <div className="text-[11px] text-muted-foreground">{r.site} · {fmtDate(r.score_date)}</div>
                          </TableCell>
                          <TableCell className="tabular text-right">{r.attendance}</TableCell>
                          <TableCell className="tabular text-right">{r.daily_work}</TableCell>
                          <TableCell className="tabular text-right">{r.task_assigned}</TableCell>
                          <TableCell className="max-w-[10rem] truncate text-muted-foreground" title={r.task_status ?? undefined}>{r.task_status}</TableCell>
                          <TableCell className="tabular text-right">{r.form_submit}</TableCell>
                          <TableCell className="tabular text-right font-medium">{r.auto_score}</TableCell>
                          <TableCell className="text-right">
                            {can.approve ? (
                              <Input
                                type="number"
                                min={0}
                                max={20}
                                defaultValue={r.monthly_review ?? ''}
                                onBlur={(e) => saveMonthly(r, e.target.value)}
                                className="tabular h-7 w-16 text-right"
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
