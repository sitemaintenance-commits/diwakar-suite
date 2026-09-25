// Solar Analytics — the Charts, Shutdown and Overall tabs of the O&M CRM,
// rebuilt over the readings the suite already holds.
//
//   Site trend  one site, one metric, over a date range
//   Shutdown    outage hours turned into generating days lost
//   Portfolio   the year, month by month and site by site
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, CalendarDays, Download, Gauge, Sun, TrendingUp, TriangleAlert, Zap } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSites } from '@/features/admin/api';
import { fmtKwh } from '@/features/om/shared';
import { useMonthReview, usePortfolio, useShutdown, useSiteAnalysis } from '@/features/om/opsApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "September 2026" from a month start date. */
function monthLabel(value: string | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** Outage hours as the O&M sheet writes them: 23:30 rather than 23.5. */
function hhmm(hours: unknown): string {
  const h = safeNum(hours);
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * One metric over time. A single series, so the card title is the legend;
 * hovering a bar gives the exact figure and the table below is the data.
 */
function MetricBars({
  data,
  unit,
  height = 220,
}: {
  data: { label: string; value: number }[];
  unit: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const max = Math.max(...data.map((d) => d.value), 1);
  const width = 720;
  const padding = { top: 12, right: 8, bottom: 26, left: 52 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const step = plotW / data.length;
  const barW = Math.max(2, Math.min(34, step - 3));
  const y = (v: number) => padding.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Trend in ${unit}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} x2={width - padding.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padding.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400" fontSize="10">
              {fmtNumber(t, max < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * plotH);
          const x = padding.left + i * step + (step - barW) / 2;
          return (
            <g key={`${d.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padding.left + i * step} y={padding.top} width={step} height={plotH} fill="transparent" />
              <rect x={x} y={y(d.value)} width={barW} height={h} rx="4" fill={hover === i ? '#c25e07' : '#E8740C'} />
            </g>
          );
        })}
        <text x={padding.left} y={height - 8} className="fill-slate-400" fontSize="10">
          {data[0].label}
        </text>
        {data.length > 1 && (
          <text x={width - padding.right} y={height - 8} textAnchor="end" className="fill-slate-400" fontSize="10">
            {data[data.length - 1].label}
          </text>
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((padding.left + hover * step + step / 2) / width) * 100}%`, top: 0 }}
        >
          <div className="font-medium">{data[hover].label}</div>
          <div className="tabular mt-0.5">
            {fmtNumber(data[hover].value, 2)} {unit}
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix: string }) {
  const pct = max > 0 ? Math.max(1, (value / max) * 100) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="tabular shrink-0 text-muted-foreground">
          {fmtNumber(value, value < 100 ? 1 : 0)} {suffix}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function daysAgo(n: number) {
  const d = new Date(`${todayIST()}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AnalyticsPage() {
  return (
    <>
      <PageHeader
        icon={BarChart3}
        title="Solar Analytics"
        description="Per-site trends, the month's shutdown analysis and the portfolio year — all from your own readings."
      />
      <Tabs defaultValue="trend">
        <TabsList className="mb-6">
          <TabsTrigger value="trend">Site trend</TabsTrigger>
          <TabsTrigger value="review">Month review</TabsTrigger>
          <TabsTrigger value="shutdown">Shutdown</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
        </TabsList>
        <TabsContent value="trend">
          <SiteTrend />
        </TabsContent>
        <TabsContent value="review">
          <MonthReviewTab />
        </TabsContent>
        <TabsContent value="shutdown">
          <ShutdownTab />
        </TabsContent>
        <TabsContent value="portfolio">
          <PortfolioTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ------------------------------------------------------------------ trend
type Metric = 'generation_kwh' | 'pr' | 'dc_cuf' | 'ac_cuf';
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'generation_kwh', label: 'Generation', unit: 'kWh' },
  { key: 'pr', label: 'PR', unit: '%' },
  { key: 'dc_cuf', label: 'DC CUF', unit: '%' },
  { key: 'ac_cuf', label: 'AC CUF', unit: '%' },
];

function SiteTrend() {
  const can = useCan('om.analytics');
  const sites = useSites();
  const [siteId, setSiteId] = useState('');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayIST());
  const [metric, setMetric] = useState<Metric>('generation_kwh');

  const list = sites.data ?? [];
  const chosen = siteId || list[0]?.id || '';
  const analysis = useSiteAnalysis(chosen || undefined, from, to);
  const a = analysis.data;
  const m = METRICS.find((x) => x.key === metric)!;

  const chart = useMemo(
    () => (a?.rows ?? []).map((r) => ({ label: fmtDate(r.date), value: safeNum(r[metric]) })),
    [a, metric],
  );

  async function onExport() {
    if (!a?.rows.length) return;
    try {
      await exportCsv('om.analytics', `${a.site}-${from}-to-${to}`, a.rows, [
        { header: 'Date', value: (r) => r.date },
        { header: 'Generation (kWh)', value: (r) => safeNum(r.generation_kwh) },
        { header: 'Insolation (kWh/m2)', value: (r) => (r.insolation === null ? '' : safeNum(r.insolation)) },
        { header: 'Specific yield', value: (r) => (r.specific_yield === null ? '' : safeNum(r.specific_yield)) },
        { header: 'PR %', value: (r) => (r.pr === null ? '' : safeNum(r.pr)) },
        { header: 'DC CUF %', value: (r) => (r.dc_cuf === null ? '' : safeNum(r.dc_cuf)) },
        { header: 'AC CUF %', value: (r) => (r.ac_cuf === null ? '' : safeNum(r.ac_cuf)) },
        { header: 'Grid outage (h)', value: (r) => safeNum(r.grid_outage) },
        { header: 'Remarks', value: (r) => r.remarks ?? '' },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Site</span>
            <FilterSelect
              value={chosen}
              onChange={setSiteId}
              options={list.map((s) => [s.id, s.name] as [string, string])}
              placeholder="Select site"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">From</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">To</span>
            <Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-1.5">
            {METRICS.map((x) => (
              <Button key={x.key} size="sm" variant={metric === x.key ? 'default' : 'outline'} onClick={() => setMetric(x.key)}>
                {x.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {analysis.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : analysis.error ? (
        <Card>
          <ErrorState message={errorMessage(analysis.error)} onRetry={() => analysis.refetch()} />
        </Card>
      ) : !a ? (
        <Card>
          <EmptyState icon={Sun} title="No site selected" description="Choose one of your sites to see its trend." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={`Latest ${m.label.toLowerCase()}`}
              value={a.latest ? `${fmtNumber(a.latest[metric], 2)} ${m.unit}` : '—'}
              hint={a.latest ? fmtDate(a.latest.date) : 'No readings'}
              icon={Zap}
            />
            <StatCard
              label="Best day"
              value={a.best ? fmtKwh(a.best.generation_kwh, 1) : '—'}
              hint={a.best ? fmtDate(a.best.date) : 'No readings'}
              icon={Sun}
              tone="amber"
            />
            <StatCard label="Matching records" value={fmtNumber(a.record_count)} hint={`${fmtDate(from)} – ${fmtDate(to)}`} icon={CalendarDays} tone="violet" />
            <StatCard
              label="Period total"
              value={fmtKwh(a.total_generation)}
              hint={`${fmtCapacity(a.capacity_dc_kwp)} DC · ${fmtNumber(a.capacity_ac_kw)} kW AC`}
              icon={Gauge}
              tone="green"
            />
          </div>

          <Card className="mt-6">
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>
                  {a.site} — {m.label} ({m.unit})
                </CardTitle>
                <CardDescription>
                  {fmtDate(a.from)} – {fmtDate(a.to)} · average PR {a.avg_pr === null ? 'not available' : `${fmtNumber(a.avg_pr, 2)}%`}
                </CardDescription>
              </div>
              {can.export && (
                <Button variant="outline" size="sm" onClick={onExport} disabled={!a.rows.length}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {chart.length ? (
                <MetricBars data={chart} unit={m.unit} />
              ) : (
                <EmptyState icon={Zap} title="No readings in this range" description="Pick a wider date range, or record the daily readings." />
              )}
            </CardContent>
          </Card>

          {a.rows.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Day by day</CardTitle>
                <CardDescription>Every reading behind the chart</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Generation</TableHead>
                        <TableHead className="text-right">Insolation</TableHead>
                        <TableHead className="text-right">Specific yield</TableHead>
                        <TableHead className="text-right">PR %</TableHead>
                        <TableHead className="text-right">DC CUF %</TableHead>
                        <TableHead className="text-right">AC CUF %</TableHead>
                        <TableHead className="text-right">Grid outage</TableHead>
                        <TableHead>Remarks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.rows.map((r) => (
                        <TableRow key={r.date}>
                          <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                          <TableCell className="tabular text-right">{fmtKwh(r.generation_kwh, 1)}</TableCell>
                          <TableCell className="tabular text-right">{r.insolation === null ? '—' : fmtNumber(r.insolation, 2)}</TableCell>
                          <TableCell className="tabular text-right">{r.specific_yield === null ? '—' : fmtNumber(r.specific_yield, 2)}</TableCell>
                          <TableCell className="tabular text-right">{r.pr === null ? '—' : `${fmtNumber(r.pr, 2)}%`}</TableCell>
                          <TableCell className="tabular text-right">{r.dc_cuf === null ? '—' : `${fmtNumber(r.dc_cuf, 2)}%`}</TableCell>
                          <TableCell className="tabular text-right">{r.ac_cuf === null ? '—' : `${fmtNumber(r.ac_cuf, 2)}%`}</TableCell>
                          <TableCell className="tabular text-right">{hhmm(r.grid_outage)}</TableCell>
                          <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{r.remarks ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}

// --------------------------------------------------------------- shutdown
function ShutdownTab() {
  const can = useCan('om.analytics');
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const shutdown = useShutdown(`${month}-01`);
  const s = shutdown.data;
  const maxHours = Math.max(...(s?.sites ?? []).map((x) => safeNum(x.hours)), 1);

  async function onExport() {
    if (!s?.sites.length) return;
    try {
      await exportCsv('om.analytics', `shutdown-${month}`, s.sites, [
        { header: 'Site', value: (r) => r.site },
        { header: 'Shutdown hours', value: (r) => hhmm(r.hours) },
        { header: 'Grid outage (h)', value: (r) => safeNum(r.grid_hours) },
        { header: 'Plant outage (h)', value: (r) => safeNum(r.plant_hours) },
        { header: 'Shutdown days', value: (r) => safeNum(r.shutdown_days) },
        { header: 'Monthly days', value: (r) => safeNum(r.monthly_days) },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="grid gap-1.5 text-sm sm:max-w-xs">
            <span className="text-xs text-muted-foreground">Month</span>
            <Input type="month" value={month} max={todayIST().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            Shutdown days = outage hours ÷ {fmtNumber(s?.peak_hours ?? 11)} peak sun hours. Monthly days = month days − shutdown days.
          </p>
          {can.export && (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!s?.sites.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </CardContent>
      </Card>

      {shutdown.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : shutdown.error ? (
        <Card>
          <ErrorState message={errorMessage(shutdown.error)} onRetry={() => shutdown.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total shutdown" value={`${hhmm(s?.total_hours)} h`} hint="All your sites" icon={TriangleAlert} tone="red" />
            <StatCard label="Generating days lost" value={fmtNumber(s?.total_shutdown_days, 2)} hint={`At ${fmtNumber(s?.peak_hours ?? 11)} peak hours`} icon={CalendarDays} tone="amber" />
            <StatCard
              label="Highest shutdown"
              value={s?.highest?.site ?? '—'}
              hint={s?.highest ? `${hhmm(s.highest.hours)} hours` : 'No outage recorded'}
              icon={TriangleAlert}
            />
            <StatCard label="Month days" value={fmtNumber(s?.month_days)} hint={monthLabel(s?.month)} icon={CalendarDays} tone="slate" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Month site-wise</CardTitle>
                <CardDescription>Shutdown summary for {monthLabel(s?.month)}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">S.N.</TableHead>
                      <TableHead>Site name</TableHead>
                      <TableHead className="text-right">Shutdown hours</TableHead>
                      <TableHead className="text-right">Shutdown days</TableHead>
                      <TableHead className="text-right">Monthly days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(s?.sites ?? []).map((r, i) => (
                      <TableRow key={r.site_id}>
                        <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{r.site}</TableCell>
                        <TableCell className="tabular text-right">{hhmm(r.hours)}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(r.shutdown_days, 2)}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(r.monthly_days, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Shutdown by site</CardTitle>
                <CardDescription>Hours lost this month</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {(s?.sites ?? []).filter((x) => safeNum(x.hours) > 0).length ? (
                  s!.sites
                    .filter((x) => safeNum(x.hours) > 0)
                    .sort((a, b) => safeNum(b.hours) - safeNum(a.hours))
                    .map((x) => <Bar key={x.site_id} label={x.site} value={safeNum(x.hours)} max={maxHours} suffix="h" />)
                ) : (
                  <p className="text-sm text-muted-foreground">No outage recorded this month.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Day-wise shutdown</CardTitle>
              <CardDescription>Every day an outage was recorded</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!s?.days.length ? (
                <EmptyState icon={TriangleAlert} title="No outage days" description="Outage hours entered on the daily form appear here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Site name</TableHead>
                      <TableHead className="text-right">Total hours</TableHead>
                      <TableHead className="text-right">Grid</TableHead>
                      <TableHead className="text-right">Plant</TableHead>
                      <TableHead className="text-right">Shutdown days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.days.map((d, i) => (
                      <TableRow key={`${d.site_id}-${d.date}-${i}`}>
                        <TableCell className="whitespace-nowrap">{fmtDate(d.date)}</TableCell>
                        <TableCell className="font-medium">{d.site}</TableCell>
                        <TableCell className="tabular text-right">{hhmm(d.hours)}</TableCell>
                        <TableCell className="tabular text-right">{hhmm(d.grid_hours)}</TableCell>
                        <TableCell className="tabular text-right">{hhmm(d.plant_hours)}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(d.shutdown_days, 3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

// -------------------------------------------------------------- portfolio
function PortfolioTab() {
  const can = useCan('om.analytics');
  const thisYear = Number(todayIST().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const portfolio = usePortfolio(year);
  const p = portfolio.data;

  const monthly = useMemo(
    () => (p?.monthly ?? []).map((m) => ({ label: MONTHS[m.month - 1] ?? String(m.month), value: safeNum(m.generation_kwh) / 1000 })),
    [p],
  );
  const maxRank = Math.max(...(p?.ranking ?? []).map((r) => safeNum(r.generation_kwh)), 1);
  const maxOutage = Math.max(...(p?.outage_by_site ?? []).map((r) => safeNum(r.hours)), 1);

  async function onExport() {
    if (!p?.matrix.length) return;
    try {
      await exportCsv('om.analytics', `portfolio-${year}`, p.matrix, [
        { header: 'Site', value: (r) => r.site },
        ...MONTHS.map((label, i) => ({
          header: `${label} (kWh)`,
          value: (r: (typeof p.matrix)[number]) => safeNum(r.months[String(i + 1)]),
        })),
        { header: 'Total (kWh)', value: (r) => safeNum(r.total) },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="grid gap-1.5 text-sm sm:max-w-[12rem]">
            <span className="text-xs text-muted-foreground">Year</span>
            <FilterSelect
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={Array.from({ length: 6 }, (_, i) => {
                const y = thisYear - i;
                return [String(y), String(y)] as [string, string];
              })}
            />
          </label>
          {can.export && (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!p?.matrix.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </CardContent>
      </Card>

      {portfolio.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : portfolio.error ? (
        <Card>
          <ErrorState message={errorMessage(portfolio.error)} onRetry={() => portfolio.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total generation" value={fmtKwh(p?.total_generation)} hint={`Year ${year}`} icon={Zap} />
            <StatCard label="Reporting days" value={fmtNumber(p?.reporting_days)} hint={`${fmtNumber(p?.months_reported)} month(s) with readings`} icon={CalendarDays} tone="violet" />
            <StatCard
              label="Best month"
              value={p?.best_month ? MONTHS[p.best_month.month - 1] : '—'}
              hint={p?.best_month ? fmtKwh(p.best_month.generation_kwh) : 'No readings'}
              icon={TrendingUp}
              tone="green"
            />
            <StatCard label="Portfolio sites" value={fmtNumber(p?.site_count)} hint={fmtCapacity(p?.capacity_dc_kwp)} icon={Sun} tone="amber" />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Monthly portfolio trend</CardTitle>
              <CardDescription>All sites, generation by month (MWh) · {fmtKwh(p?.total_generation)} total</CardDescription>
            </CardHeader>
            <CardContent>
              {monthly.length ? (
                <MetricBars data={monthly} unit="MWh" />
              ) : (
                <EmptyState icon={Zap} title="No readings this year" description="Daily readings roll up into this view automatically." />
              )}
            </CardContent>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cumulative ranking</CardTitle>
                <CardDescription>Generation by site for {year}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {p?.ranking.length ? (
                  p.ranking.map((r, i) => (
                    <div key={r.site_id} className="flex items-center gap-3">
                      <span className="tabular w-6 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <Bar
                          label={r.site}
                          value={safeNum(r.generation_kwh) / 1000}
                          max={maxRank / 1000}
                          suffix="MWh"
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No readings this year.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recorded grid outage</CardTitle>
                <CardDescription>Hours by site for {year}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {p?.outage_by_site.length ? (
                  p.outage_by_site.map((r) => <Bar key={r.site} label={r.site} value={safeNum(r.hours)} max={maxOutage} suffix="h" />)
                ) : (
                  <p className="text-sm text-muted-foreground">No outage recorded this year.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Site generation matrix</CardTitle>
              <CardDescription>Month by month, in MWh</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!p?.matrix.length ? (
                <EmptyState icon={Sun} title="No sites" description="Sites you are assigned to appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Site</TableHead>
                        {MONTHS.map((m) => (
                          <TableHead key={m} className="text-right">
                            {m}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.matrix.map((r) => (
                        <TableRow key={r.site_id}>
                          <TableCell className="whitespace-nowrap font-medium">{r.site}</TableCell>
                          {MONTHS.map((m, i) => (
                            <TableCell key={m} className="tabular text-right">
                              {fmtNumber(safeNum(r.months[String(i + 1)]) / 1000, 1)}
                            </TableCell>
                          ))}
                          <TableCell className="tabular text-right font-semibold">
                            {fmtNumber(safeNum(r.total) / 1000, 1)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            <Badge variant="secondary" className="mr-2">
              Scope
            </Badge>
            Every figure on this page covers only the sites your account is assigned to.
          </p>
        </>
      )}
    </>
  );
}


// -------------------------------------------------------- month review
/**
 * The monthly pack, with the arithmetic the review meeting uses: the
 * plant is judged on the days it could actually have generated, so the
 * downtime comes out of the denominator rather than counting against
 * performance.
 */
function MonthReviewTab() {
  const can = useCan('om.analytics');
  const today = todayIST();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const review = useMonthReview(year, month);
  const r = review.data;

  async function onExport() {
    if (!r?.rows.length) return;
    try {
      await exportCsv('om.analytics', `month-review-${year}-${String(month).padStart(2, '0')}`, r.rows, [
        { header: 'Plant name', value: (x) => x.site },
        { header: 'DC capacity (kWp)', value: (x) => safeNum(x.capacity_dc_kwp) },
        { header: 'Forecast (kWh)', value: (x) => (x.forecast === null ? '' : safeNum(x.forecast)) },
        { header: 'Shutdown days', value: (x) => safeNum(x.shutdown_days) },
        { header: 'Effective days', value: (x) => safeNum(x.effective_days) },
        { header: 'Forecast after shutdown', value: (x) => (x.forecast_prorated === null ? '' : safeNum(x.forecast_prorated)) },
        { header: 'Actual generation (kWh)', value: (x) => safeNum(x.actual) },
        { header: 'Diff', value: (x) => (x.diff === null ? '' : safeNum(x.diff)) },
        { header: 'S.Y. (per day)', value: (x) => (x.specific_yield === null ? '' : safeNum(x.specific_yield)) },
        { header: 'DC CUF %', value: (x) => (x.dc_cuf === null ? '' : safeNum(x.dc_cuf)) },
        { header: 'Insolation', value: (x) => (x.insolation === null ? '' : safeNum(x.insolation)) },
        { header: 'PR %', value: (x) => (x.pr === null ? '' : safeNum(x.pr)) },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const thisYear = Number(today.slice(0, 4));

  return (
    <>
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid grid-cols-2 gap-3 lg:max-w-md">
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Month</span>
              <FilterSelect
                value={String(month)}
                onChange={(v) => setMonth(Number(v))}
                options={MONTHS.map((m, i) => [String(i + 1), m] as [string, string])}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Year</span>
              <FilterSelect
                value={String(year)}
                onChange={(v) => setYear(Number(v))}
                options={Array.from({ length: 6 }, (_, i) => {
                  const y = thisYear - i;
                  return [String(y), String(y)] as [string, string];
                })}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Effective days = {fmtNumber(r?.days_in_month)} days &minus; outage hours &divide;{' '}
            {fmtNumber(r?.peak_sun_hours)} peak sun hours. S.Y. and CUF both use them.
          </p>
          {can.export && (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!r?.rows.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </CardContent>
      </Card>

      {review.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : review.error ? (
        <Card>
          <ErrorState message={errorMessage(review.error)} onRetry={() => review.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Actual generation" value={fmtKwh(r?.actual_total)} hint={`${fmtNumber(r?.site_count)} plant(s)`} icon={Zap} />
            <StatCard
              label="Against forecast"
              value={r?.diff_total == null ? '—' : `${safeNum(r.diff_total) >= 0 ? '+' : ''}${fmtKwh(r.diff_total)}`}
              hint={r?.forecast_prorated_total == null ? 'No targets set' : `Target ${fmtKwh(r.forecast_prorated_total)} after shutdown`}
              icon={TrendingUp}
              tone={safeNum(r?.diff_total) >= 0 ? 'green' : 'red'}
            />
            <StatCard label="Generating days lost" value={fmtNumber(r?.shutdown_days_total, 2)} hint={`At ${fmtNumber(r?.peak_sun_hours)} peak hours`} icon={TriangleAlert} tone="amber" />
            <StatCard label="Connected capacity" value={fmtCapacity(r?.capacity_dc_kwp)} hint={fmtDate(r?.from) + ' – ' + fmtDate(r?.to)} icon={Sun} tone="violet" />
          </div>

          {Number(r?.missing_targets) > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              {fmtNumber(r?.missing_targets)} plant(s) have no forecast for this month, so their
              variance is blank. Targets are held per plant per month and only June and July 2026
              came across from the review packs.
            </div>
          )}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                Month review — {MONTHS[(r?.month ?? 1) - 1]} {r?.year}
              </CardTitle>
              <CardDescription>
                The plant judged on the days it could have run. Insolation is summed from the daily
                readings, so PR is blank where it was never recorded rather than wrong.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!r?.rows.length ? (
                <EmptyState icon={Sun} title="No plants" description="Sites you are assigned to appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plant</TableHead>
                        <TableHead className="text-right">DC</TableHead>
                        <TableHead className="text-right">Forecast</TableHead>
                        <TableHead className="text-right">Shutdown days</TableHead>
                        <TableHead className="text-right">Days</TableHead>
                        <TableHead className="text-right">Target</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Diff</TableHead>
                        <TableHead className="text-right">S.Y.</TableHead>
                        <TableHead className="text-right">DC CUF %</TableHead>
                        <TableHead className="text-right">Inso.</TableHead>
                        <TableHead className="text-right">PR %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.rows.map((x) => (
                        <TableRow key={x.site_id}>
                          <TableCell className="whitespace-nowrap font-medium">{x.site}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(x.capacity_dc_kwp)}</TableCell>
                          <TableCell className="tabular text-right">{x.forecast === null ? '—' : fmtNumber(x.forecast)}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(x.shutdown_days, 2)}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(x.effective_days, 2)}</TableCell>
                          <TableCell className="tabular text-right">{x.forecast_prorated === null ? '—' : fmtNumber(x.forecast_prorated)}</TableCell>
                          <TableCell className="tabular text-right font-medium">{fmtNumber(x.actual)}</TableCell>
                          <TableCell className={`tabular text-right ${x.diff !== null && safeNum(x.diff) < 0 ? 'text-destructive' : ''}`}>
                            {x.diff === null ? '—' : `${safeNum(x.diff) >= 0 ? '+' : ''}${fmtNumber(x.diff)}`}
                          </TableCell>
                          <TableCell className="tabular text-right">{x.specific_yield === null ? '—' : fmtNumber(x.specific_yield, 2)}</TableCell>
                          <TableCell className="tabular text-right">{x.dc_cuf === null ? '—' : fmtNumber(x.dc_cuf, 2)}</TableCell>
                          <TableCell className="tabular text-right">{x.insolation === null ? '—' : fmtNumber(x.insolation, 2)}</TableCell>
                          <TableCell className="tabular text-right">{x.pr === null ? '—' : fmtNumber(x.pr, 2)}</TableCell>
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
