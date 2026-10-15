// Solar Monitor — figures come from get_generation_summary(), which only
// includes the sites the user may access. Nothing is estimated: ratios that
// need data we do not hold (PR without irradiation) say so instead.
//
// Laid out to fit one screen: the day's table runs the full width with
// related columns merged (no sideways scrolling), each site's rank sits in
// its generation cell, and long lists scroll inside the card.
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Activity, CalendarDays, Download, Gauge, MessageSquareText, Sun, TriangleAlert, Zap } from 'lucide-react';
import { fmtCapacity, fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { exportXlsx } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSites } from '@/features/admin/api';
import { useMonitor } from '@/features/om/api';
import { useDailyPerformance } from '@/features/om/opsApi';
import { fmtKwh, fmtKwhDay, GenerationChart } from '@/features/om/shared';

function monthStart() {
  const t = todayIST();
  return `${t.slice(0, 7)}-01`;
}

export function MonitorPage() {
  return (
    <>
      <PageHeader
        icon={Activity}
        title="Solar Monitor"
        description="Generation and availability for your sites. Figures come from the recorded readings — nothing is estimated."
      />
      <Tabs defaultValue="day">
        <TabsList className="mb-3">
          <TabsTrigger value="day">Day view</TabsTrigger>
          <TabsTrigger value="period">Period</TabsTrigger>
        </TabsList>
        <TabsContent value="day">
          <DayView />
        </TabsContent>
        <TabsContent value="period">
          <PeriodView />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The whole portfolio on one date — the "All Sites Performance" table. */
function DayView() {
  const can = useCan('om.monitor');
  const [date, setDate] = useState(todayIST());
  const day = useDailyPerformance(date);
  const d = day.data;
  const maxGen = Math.max(...(d?.ranking ?? []).map((r) => safeNum(r.generation_kwh)), 1);

  async function onExport() {
    if (!d?.sites.length) return;
    try {
      const num = (v: unknown) => (v === null || v === undefined ? null : safeNum(v));
      const sum = (k: 'capacity_dc_kwp' | 'capacity_ac_kw' | 'generation_kwh') => d.sites.reduce((s, r) => s + safeNum(r[k]), 0);
      const day = new Date(`${date}T00:00:00`);
      await exportXlsx(
        'om.monitor',
        `daily-report-${date}`,
        d.sites,
        [
          { header: 'S.No', value: (r) => d.sites.indexOf(r) + 1, width: 6 },
          { header: 'Site name', value: (r) => (r.location ? `${r.name} - ${r.location}` : r.name), width: 28 },
          { header: 'DC (kWp)', value: (r) => num(r.capacity_dc_kwp), numFmt: '#,##0' },
          { header: 'AC (kW)', value: (r) => num(r.capacity_ac_kw), numFmt: '#,##0' },
          { header: 'Actual gen. (kWh)', value: (r) => (r.reported ? num(r.generation_kwh) : null), numFmt: '#,##0.00', width: 16 },
          { header: 'Tilt', value: (r) => num(r.tilt), numFmt: '0"°"' },
          { header: 'S.Y (kWh/kWp)', value: (r) => num(r.specific_yield), numFmt: '0.00' },
          { header: 'PR (%)', value: (r) => num(r.pr), numFmt: '0.00' },
          { header: 'Inso. (kWh/m²)', value: (r) => num(r.insolation), numFmt: '0.00' },
          { header: 'DC CUF (%)', value: (r) => num(r.dc_cuf), numFmt: '0.00' },
          { header: 'AC CUF (%)', value: (r) => num(r.ac_cuf), numFmt: '0.00' },
          { header: 'Grid outage (h)', value: (r) => num(r.grid_outage), numFmt: '0.00' },
          { header: 'Plant outage (h)', value: (r) => num(r.plant_outage), numFmt: '0.00' },
          { header: 'Weather', value: (r) => r.weather ?? '', width: 16 },
          { header: 'Failure side', value: (r) => (r.failure_side === 'plant' ? 'Plant side' : r.failure_side === 'gss' ? 'GSS side' : '') },
          { header: 'Failure reason', value: (r) => r.failure_reason ?? '', width: 34 },
          { header: 'Remarks', value: (r) => (r.reported ? r.remarks ?? '' : 'No reading filed'), width: 40 },
        ],
        {
          sheet: 'Daily Report',
          title: [
            'DAILY SOLAR GENERATION REPORT (ALL SITES)',
            `Date: ${fmtDate(date)} · ${day.toLocaleDateString('en-IN', { weekday: 'long' })} · ${fmtNumber(d.reported_count)} of ${fmtNumber(d.site_count)} sites reported`,
          ],
          totals: {
            1: 'TOTAL',
            2: sum('capacity_dc_kwp'),
            3: sum('capacity_ac_kw'),
            4: sum('generation_kwh'),
            7: num(d.avg_pr),
            9: num(d.dc_cuf),
            10: num(d.ac_cuf),
          },
        },
      );
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${fmtNumber(v, 2)}%`);

  return (
    <>
      <Card className="mb-3">
        <CardContent className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Date
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
          </label>
          <p className="text-xs text-muted-foreground">
            {fmtNumber(d?.reported_count)} of {fmtNumber(d?.site_count)} sites reported for {fmtDate(date)} · a faded row means no reading was filed
          </p>
          {can.export && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={onExport} disabled={!d?.sites.length}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          )}
        </CardContent>
      </Card>

      {day.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : day.error ? (
        <Card>
          <ErrorState message={errorMessage(day.error)} onRetry={() => day.refetch()} />
        </Card>
      ) : !d?.site_count ? (
        <Card>
          <EmptyState icon={Sun} title="No sites assigned" description="Ask your administrator to assign solar sites to your account." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total generation" value={fmtKwhDay(d.total_generation, 1)} hint={fmtDate(date)} icon={Zap} />
            <StatCard
              label="Average PR"
              value={pct(d.avg_pr)}
              hint={d.avg_insolation === null ? 'Needs insolation readings' : `Insolation ${fmtNumber(d.avg_insolation, 2)} kWh/m²`}
              icon={Gauge}
              tone="green"
            />
            <StatCard label="DC CUF" value={pct(d.dc_cuf)} hint={fmtCapacity(d.capacity_dc_kwp)} icon={Gauge} tone="blue" />
            <StatCard label="AC CUF" value={pct(d.ac_cuf)} hint={`${fmtNumber(d.capacity_ac_kw)} kW AC`} icon={Gauge} tone="violet" />
          </div>

          <Card className="mt-3 overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">All sites performance <span className="font-normal text-muted-foreground">· {fmtDate(date)}</span></h2>
              <p className="text-xs text-muted-foreground">#rank by generation · Inso. kWh/m² · Grid outage in hours</p>
            </div>
            <Table wrapperClassName="max-h-[calc(100vh-25rem)] min-h-[12rem]" className="text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-3">#</TableHead>
                  <TableHead className="px-3">Site</TableHead>
                  <TableHead className="px-3 text-right">DC / AC kW</TableHead>
                  <TableHead className="px-3">Generation (kWh)</TableHead>
                  <TableHead className="px-3 text-right">S.Y</TableHead>
                  <TableHead className="px-3 text-right">PR %</TableHead>
                  <TableHead className="px-3 text-right">Inso.</TableHead>
                  <TableHead className="px-3 text-right">DC CUF</TableHead>
                  <TableHead className="px-3 text-right">AC CUF</TableHead>
                  <TableHead className="px-3 text-right">Grid out</TableHead>
                  <TableHead className="hidden px-3 2xl:table-cell">Weather · failure · remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.sites.map((s, i) => {
                  const rank = d.ranking.findIndex((r) => r.name === s.name);
                  const notes = [
                    s.weather,
                    s.failure_reason ? `${s.failure_reason} (${s.failure_side === 'plant' ? 'plant side' : 'GSS side'})` : s.had_failure ? 'Failure, reason not stated' : null,
                    s.remarks,
                  ].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={s.site_id} className={s.reported ? '' : 'opacity-60'}>
                      <TableCell className="tabular px-3 text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="whitespace-nowrap px-3" title={notes || undefined}>
                        <span className="font-medium">{s.name}</span>
                        {notes && <MessageSquareText className="ml-1 inline h-3.5 w-3.5 text-muted-foreground 2xl:hidden" aria-label={notes} />}
                        {s.tilt !== null && <span className="ml-1.5 text-xs text-muted-foreground">{fmtNumber(s.tilt)}°</span>}
                        {!s.reported && <Badge variant="warning" className="ml-2">No reading</Badge>}
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap px-3 text-right">
                        {fmtNumber(s.capacity_dc_kwp)} <span className="text-muted-foreground">/ {fmtNumber(s.capacity_ac_kw)}</span>
                      </TableCell>
                      <TableCell className="min-w-[9rem] px-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="tabular font-medium">{fmtNumber(s.generation_kwh, 1)}</span>
                          {rank >= 0 && <span className="rounded bg-primary-soft px-1.5 text-[11px] font-semibold text-primary">#{rank + 1}</span>}
                        </div>
                        {s.reported && (
                          <div className="mt-1 h-1 rounded-full bg-muted">
                            <div className="h-1 rounded-full bg-primary" style={{ width: `${Math.max(2, (safeNum(s.generation_kwh) / maxGen) * 100)}%` }} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="tabular px-3 text-right">{s.specific_yield === null ? '—' : fmtNumber(s.specific_yield, 2)}</TableCell>
                      <TableCell className="tabular px-3 text-right font-medium">{s.pr === null ? '—' : fmtNumber(s.pr, 2)}</TableCell>
                      <TableCell className="tabular px-3 text-right">{s.insolation === null ? '—' : fmtNumber(s.insolation, 2)}</TableCell>
                      <TableCell className="tabular px-3 text-right">{s.dc_cuf === null ? '—' : fmtNumber(s.dc_cuf, 2)}</TableCell>
                      <TableCell className="tabular px-3 text-right">{s.ac_cuf === null ? '—' : fmtNumber(s.ac_cuf, 2)}</TableCell>
                      <TableCell className="tabular px-3 text-right">{fmtNumber(s.grid_outage, 2)}</TableCell>
                      <TableCell className="hidden max-w-[13rem] truncate px-3 text-muted-foreground 2xl:table-cell" title={notes || undefined}>{notes || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

function PeriodView() {
  const canGeneration = useCan('om.generation');
  const sites = useSites();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIST());
  const [siteId, setSiteId] = useState('all');
  const monitor = useMonitor(from, to, siteId);
  const m = monitor.data;

  const ratio = (value: number | null | undefined, suffix = '%') =>
    value === null || value === undefined ? <span className="text-base font-medium text-muted-foreground">Not available</span> : `${fmtNumber(value, 2)}${suffix}`;

  return (
    <>
      <Card className="mb-3">
        <CardContent className="flex flex-col gap-3 px-4 py-2.5 sm:flex-row sm:items-end">
          <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3">
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
              <FilterSelect value={siteId} onChange={setSiteId} options={[['all', 'All my sites'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
            </label>
          </div>
          <div className="text-xs text-muted-foreground">
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
            {fmtDate(from)} – {fmtDate(to)}
          </div>
        </CardContent>
      </Card>

      {monitor.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : monitor.error ? (
        <Card>
          <ErrorState message={errorMessage(monitor.error)} onRetry={() => monitor.refetch()} />
        </Card>
      ) : !m?.site_count ? (
        <Card>
          <EmptyState icon={Sun} title="No sites assigned" description="Ask your administrator to assign solar sites to your account." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
            <StatCard label="Today" value={fmtKwh(m.today)} hint={`Yesterday ${fmtKwh(m.yesterday)}`} icon={Sun} />
            <StatCard label="This month" value={fmtKwh(m.month)} icon={Zap} tone="amber" />
            <StatCard label="This year" value={fmtKwh(m.year)} icon={Zap} tone="green" />
            <StatCard label="Connected capacity" value={fmtCapacity(m.capacity_kwp)} hint={`${fmtNumber(m.site_count)} site(s)`} icon={Gauge} tone="violet" />
            <StatCard label="DC CUF" value={ratio(m.cuf)} hint={`${fmtCapacity(m.capacity_kwp)} connected`} icon={Gauge} tone="blue" />
            <StatCard label="AC CUF" value={ratio(m.ac_cuf)} hint={`${fmtNumber(m.capacity_ac_kw)} kW AC`} icon={Gauge} tone="violet" />
            <StatCard
              label="Specific yield"
              value={m.specific_yield === null ? <span className="text-base font-medium text-muted-foreground">Not available</span> : `${fmtNumber(m.specific_yield, 2)} kWh/kWp`}
              hint="Energy ÷ DC capacity"
              icon={Sun}
              tone="amber"
            />
            <StatCard
              label="Performance ratio"
              value={ratio(m.pr)}
              hint={m.pr === null ? 'Needs insolation readings' : `Average insolation ${fmtNumber(m.insolation, 2)} kWh/m²`}
              icon={Gauge}
              tone="slate"
            />
            <StatCard label="Plant availability" value={ratio(m.plant_availability)} hint="From recorded plant outage hours" icon={Activity} tone="green" />
            <StatCard label="Grid availability" value={ratio(m.grid_availability)} hint="From recorded grid outage hours" icon={Activity} tone="amber" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle>Daily generation (kWh)</CardTitle>
                <CardDescription>
                  {fmtDate(from)} – {fmtDate(to)} · total {fmtKwh(m.period)}
                  {m.expected_period ? ` of ${fmtKwh(m.expected_period)} expected` : ''} · from the readings on the{' '}
                  <Link to="/operations/generation" className="text-primary hover:underline">Generation</Link> page
                </CardDescription>
              </CardHeader>
              <CardContent>
                {m.daily?.length ? (
                  <GenerationChart data={m.daily} />
                ) : (
                  <EmptyState
                    icon={Zap}
                    title="No readings in this period"
                    description={canGeneration.create ? 'Record daily generation to see the trend here.' : 'No generation has been recorded for these dates.'}
                  />
                )}
              </CardContent>
            </Card>

          <Card className="overflow-hidden xl:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle>By site</CardTitle>
              <CardDescription>Generation per site for the selected period</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table wrapperClassName="max-h-[26rem]" className="text-[13px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead className="px-3 text-right">Period</TableHead>
                    <TableHead className="px-3 text-right">S.Y</TableHead>
                    <TableHead className="px-3 text-right">PR</TableHead>
                    <TableHead className="px-3">Last</TableHead>
                    <TableHead className="px-3 text-right">Tickets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.sites.map((s) => {
                    const stale = !s.last_reading || new Date(s.last_reading) < new Date(Date.now() - 3 * 864e5);
                    return (
                      <TableRow key={s.site_id}>
                        <TableCell className="whitespace-nowrap px-3">
                          <div className="font-medium">{s.name}</div>
                          <div className="text-[11px] text-muted-foreground">{fmtCapacity(s.capacity_kwp)} · today {fmtKwh(s.today)}</div>
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap px-3 text-right">
                          {fmtKwh(s.period)}
                          {s.expected_period ? (
                            <div className="text-xs text-muted-foreground">
                              {fmtNumber((safeNum(s.period) / safeNum(s.expected_period)) * 100, 1)}% of expected
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular px-3 text-right">
                          {s.specific_yield === null ? '—' : `${fmtNumber(s.specific_yield, 2)}`}
                        </TableCell>
                        <TableCell className="tabular px-3 text-right">{s.pr === null ? '—' : `${fmtNumber(s.pr, 1)}%`}</TableCell>
                        <TableCell className="whitespace-nowrap px-3">
                          {s.last_reading ? (
                            <span className={stale ? 'text-amber-600' : ''}>
                              {fmtDate(s.last_reading)}
                              {stale && <TriangleAlert className="ml-1 inline h-3.5 w-3.5" />}
                            </span>
                          ) : (
                            <Badge variant="warning">No readings</Badge>
                          )}
                        </TableCell>
                        <TableCell className="px-3 text-right">
                          {s.open_tickets > 0 ? <Badge variant="destructive">{fmtNumber(s.open_tickets)}</Badge> : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          </div>
        </>
      )}
    </>
  );
}
