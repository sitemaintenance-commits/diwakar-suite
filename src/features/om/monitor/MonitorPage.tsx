// Solar Monitor — figures come from get_generation_summary(), which only
// includes the sites the user may access. Nothing is estimated: ratios that
// need data we do not hold (PR without irradiation) say so instead.
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Activity, CalendarDays, Download, Gauge, Sun, TriangleAlert, Zap } from 'lucide-react';
import { fmtCapacity, fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
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
import { fmtKwh, GenerationChart } from '@/features/om/shared';

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
        <TabsList className="mb-6">
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
      await exportCsv('om.monitor', `site-performance-${date}`, d.sites, [
        { header: 'Site name', value: (r) => r.name },
        { header: 'DC kW', value: (r) => safeNum(r.capacity_dc_kwp) },
        { header: 'AC kW', value: (r) => safeNum(r.capacity_ac_kw) },
        { header: 'Actual generation (kWh)', value: (r) => safeNum(r.generation_kwh) },
        { header: 'Tilt', value: (r) => (r.tilt === null ? '' : safeNum(r.tilt)) },
        { header: 'Specific yield', value: (r) => (r.specific_yield === null ? '' : safeNum(r.specific_yield)) },
        { header: 'PR %', value: (r) => (r.pr === null ? '' : safeNum(r.pr)) },
        { header: 'Insolation', value: (r) => (r.insolation === null ? '' : safeNum(r.insolation)) },
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

  const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${fmtNumber(v, 2)}%`);

  return (
    <>
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="grid gap-1.5 text-sm sm:max-w-xs">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            {fmtNumber(d?.reported_count)} of {fmtNumber(d?.site_count)} sites reported for {fmtDate(date)}
          </p>
          {can.export && (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!d?.sites.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total generation" value={fmtKwh(d.total_generation, 1)} hint={fmtDate(date)} icon={Zap} />
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

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Site ranking</CardTitle>
                <CardDescription>Generation by site on {fmtDate(date)}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {d.ranking.length ? (
                  d.ranking.map((r, i) => (
                    <div key={r.name} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">
                          <span className="tabular mr-2 text-muted-foreground">{i + 1}</span>
                          <span className="font-medium">{r.name}</span>
                        </span>
                        <span className="tabular shrink-0 text-muted-foreground">{fmtKwh(r.generation_kwh, 1)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${Math.max(1, (safeNum(r.generation_kwh) / maxGen) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No readings for this date yet.</p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>All sites performance</CardTitle>
                <CardDescription>Every assigned site for {fmtDate(date)} — a faded row means no reading was filed</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">S.No</TableHead>
                        <TableHead>Site name</TableHead>
                        <TableHead className="text-right">DC kW</TableHead>
                        <TableHead className="text-right">AC kW</TableHead>
                        <TableHead className="text-right">Actual gen.</TableHead>
                        <TableHead className="text-right">Tilt</TableHead>
                        <TableHead className="text-right">S.Y</TableHead>
                        <TableHead className="text-right">PR %</TableHead>
                        <TableHead className="text-right">Inso.</TableHead>
                        <TableHead className="text-right">DC CUF %</TableHead>
                        <TableHead className="text-right">AC CUF %</TableHead>
                        <TableHead className="text-right">Grid outage</TableHead>
                        <TableHead>Remarks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.sites.map((s, i) => (
                        <TableRow key={s.site_id} className={s.reported ? '' : 'opacity-60'}>
                          <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="whitespace-nowrap font-medium">
                            {s.name}
                            {!s.reported && (
                              <Badge variant="warning" className="ml-2">
                                No reading
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(s.capacity_dc_kwp)}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(s.capacity_ac_kw)}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(s.generation_kwh, 1)}</TableCell>
                          <TableCell className="tabular text-right">{s.tilt === null ? '—' : fmtNumber(s.tilt)}</TableCell>
                          <TableCell className="tabular text-right">{s.specific_yield === null ? '—' : fmtNumber(s.specific_yield, 2)}</TableCell>
                          <TableCell className="tabular text-right">{s.pr === null ? '—' : fmtNumber(s.pr, 2)}</TableCell>
                          <TableCell className="tabular text-right">{s.insolation === null ? '—' : fmtNumber(s.insolation, 2)}</TableCell>
                          <TableCell className="tabular text-right">{s.dc_cuf === null ? '—' : fmtNumber(s.dc_cuf, 2)}</TableCell>
                          <TableCell className="tabular text-right">{s.ac_cuf === null ? '—' : fmtNumber(s.ac_cuf, 2)}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(s.grid_outage, 2)}</TableCell>
                          <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">{s.remarks ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
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
      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Today" value={fmtKwh(m.today)} hint={`Yesterday ${fmtKwh(m.yesterday)}`} icon={Sun} />
            <StatCard label="This month" value={fmtKwh(m.month)} icon={Zap} tone="amber" />
            <StatCard label="This year" value={fmtKwh(m.year)} icon={Zap} tone="green" />
            <StatCard label="Connected capacity" value={fmtCapacity(m.capacity_kwp)} hint={`${fmtNumber(m.site_count)} site(s)`} icon={Gauge} tone="violet" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
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

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Daily generation (kWh)</CardTitle>
                <CardDescription>
                  {fmtDate(from)} – {fmtDate(to)} · total {fmtKwh(m.period)}
                  {m.expected_period ? ` of ${fmtKwh(m.expected_period)} expected` : ''}
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

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Data sources</CardTitle>
                <CardDescription>How readings reach this page</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p className="text-muted-foreground">
                  Readings are entered on the <Link to="/operations/generation" className="text-primary hover:underline">Generation</Link> page today.
                </p>
                <p className="text-muted-foreground">
                  Automatic import from inverter portals, SCADA or an Excel upload can be added later — each site carries a
                  “monitoring source” field for that. Until a source is connected, CUF and availability are calculated from
                  what your team records, and the performance ratio stays unavailable unless irradiation is entered.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>By site</CardTitle>
              <CardDescription>Generation per site for the selected period</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right">Today</TableHead>
                    <TableHead className="text-right">This month</TableHead>
                    <TableHead className="text-right">Period</TableHead>
                    <TableHead className="text-right">Specific yield</TableHead>
                    <TableHead className="text-right">PR</TableHead>
                    <TableHead>Last reading</TableHead>
                    <TableHead className="text-right">Open tickets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.sites.map((s) => {
                    const stale = !s.last_reading || new Date(s.last_reading) < new Date(Date.now() - 3 * 864e5);
                    return (
                      <TableRow key={s.site_id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="tabular text-right">{fmtCapacity(s.capacity_kwp)}</TableCell>
                        <TableCell className="tabular text-right">{fmtKwh(s.today)}</TableCell>
                        <TableCell className="tabular text-right">{fmtKwh(s.month)}</TableCell>
                        <TableCell className="tabular text-right">
                          {fmtKwh(s.period)}
                          {s.expected_period ? (
                            <div className="text-xs text-muted-foreground">
                              {fmtNumber((safeNum(s.period) / safeNum(s.expected_period)) * 100, 1)}% of expected
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {s.specific_yield === null ? '—' : `${fmtNumber(s.specific_yield, 2)}`}
                        </TableCell>
                        <TableCell className="tabular text-right">{s.pr === null ? '—' : `${fmtNumber(s.pr, 1)}%`}</TableCell>
                        <TableCell className="text-sm">
                          {s.last_reading ? (
                            <span className={stale ? 'text-amber-600' : ''}>
                              {fmtDate(s.last_reading)}
                              {stale && <TriangleAlert className="ml-1 inline h-3.5 w-3.5" />}
                            </span>
                          ) : (
                            <Badge variant="warning">No readings</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.open_tickets > 0 ? <Badge variant="destructive">{fmtNumber(s.open_tickets)}</Badge> : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
