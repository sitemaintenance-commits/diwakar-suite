// Solar Sites — the whole fleet on one screen.
//
// This sits outside O&M on purpose. Someone running the company wants to
// know whether the plants are running, not to work a maintenance queue,
// and should not need the O&M section to find out.
//
// Laid out to fit one screen: the day picker sits in the header, the
// figures in one slim row, and the plants table scrolls inside its card
// with the column names pinned.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Download, Gauge, Sun, TriangleAlert, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';

interface Row {
  site_id: string;
  name: string;
  code: string | null;
  location: string | null;
  status: string;
  stage: string | null;
  capacity_dc_kwp: number;
  capacity_ac_kw: number;
  inverter_count: number | null;
  commissioning_date: string | null;
  today_kwh: number;
  month_kwh: number;
  days_reported: number;
  last_reading: string | null;
  month_cuf: number | null;
  specific_yield: number | null;
  month_pr: number | null;
  pr_days: number;
  today_pr: number | null;
  reported_today: boolean;
  open_tickets: number;
  critical_tickets: number;
}

interface Portfolio {
  date: string;
  month_from: string;
  sites: number;
  rows: Row[];
  total_dc_kwp: number;
  today_kwh: number;
  month_kwh: number;
  month_pr: number | null;
  reported_today: number;
  open_tickets: number;
  critical_tickets: number;
}

/** kWh reads badly past a few thousand; MWh and GWh do not. */
function energy(kwh: unknown) {
  const v = safeNum(kwh);
  if (v >= 1_000_000) return `${fmtNumber(v / 1_000_000, 2)} GWh`;
  if (v >= 1_000) return `${fmtNumber(v / 1_000, 1)} MWh`;
  return `${fmtNumber(v)} kWh`;
}

/** PR colour: 80 % and up is good, under 75 % wants a look. */
const prTone = (v: number | null) => (v == null ? 'text-muted-foreground' : v >= 80 ? 'text-green-700' : v >= 75 ? 'text-amber-700' : 'text-red-700');

function capacity(kwp: unknown) {
  const v = safeNum(kwp);
  return v >= 1_000 ? `${fmtNumber(v / 1_000, 2)} MWp` : `${fmtNumber(v)} kWp`;
}

export function SolarSitesPage() {
  const can = useCan('sites.overview');
  const [date, setDate] = useState(todayIST());

  const q = useQuery({
    queryKey: ['site-portfolio', date],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_site_portfolio', { p_date: date });
      if (error) throw error;
      return data as Portfolio;
    },
  });

  const d = q.data;
  const rows = d?.rows ?? [];
  const silent = rows.filter((r) => !r.reported_today);

  async function onExport() {
    if (!rows.length) return;
    try {
      await exportCsv('sites.overview', `solar-sites-${date}`, rows, [
        { header: 'Plant', value: (r) => r.name },
        { header: 'Location', value: (r) => r.location ?? '' },
        { header: 'DC (kWp)', value: (r) => safeNum(r.capacity_dc_kwp) },
        { header: 'AC (kW)', value: (r) => safeNum(r.capacity_ac_kw) },
        { header: 'Inverters', value: (r) => r.inverter_count ?? '' },
        { header: 'Commissioned', value: (r) => r.commissioning_date ?? '' },
        { header: 'Today (kWh)', value: (r) => safeNum(r.today_kwh) },
        { header: 'Month (kWh)', value: (r) => safeNum(r.month_kwh) },
        { header: 'Days reported', value: (r) => safeNum(r.days_reported) },
        { header: 'S.Y. (per day)', value: (r) => r.specific_yield ?? '' },
        { header: 'Month CUF %', value: (r) => r.month_cuf ?? '' },
        { header: 'Month PR %', value: (r) => r.month_pr ?? '' },
        { header: 'PR days (with insolation)', value: (r) => safeNum(r.pr_days) },
        { header: 'Open tickets', value: (r) => safeNum(r.open_tickets) },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={Sun}
        title="Solar Sites"
        description="Every plant at a glance — what it generated today, how the month is running, and anything asking for attention."
        actions={
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Day
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
            </label>
            {can.export && (
              <Button variant="outline" onClick={onExport} disabled={!rows.length}>
                <Download /> Export CSV
              </Button>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : q.error ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Connected capacity" value={capacity(d?.total_dc_kwp)} hint={`${fmtNumber(d?.sites)} plant(s)`} icon={Sun} />
            <StatCard label="Generated today" value={energy(d?.today_kwh)} hint={`${fmtNumber(d?.reported_today)} of ${fmtNumber(d?.sites)} reported`} icon={Zap} tone="green" />
            <StatCard label="This month" value={energy(d?.month_kwh)} hint={`since ${fmtDate(d?.month_from)}`} icon={Gauge} tone="violet" />
            <StatCard label="Fleet PR (month)" value={d?.month_pr == null ? '—' : `${fmtNumber(d.month_pr, 1)}%`}
              hint="Days with insolation, weighted by DC" icon={Activity} tone="blue" />
            <StatCard
              label="Open tickets"
              value={fmtNumber(d?.open_tickets)}
              hint={`${fmtNumber(d?.critical_tickets)} critical`}
              icon={TriangleAlert}
              tone={safeNum(d?.critical_tickets) > 0 ? 'red' : 'amber'}
            />
          </div>

          {silent.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              title={`No reading yet: ${silent.map((r) => r.name).join(', ')}`}>
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span className="shrink-0 font-semibold">
                {silent.length === rows.length ? 'No plant has' : `${silent.length} of ${rows.length} plants have not`} reported for {fmtDate(d?.date)} yet:
              </span>
              <span className="truncate">{silent.map((r) => r.name).join(', ')}</span>
            </div>
          )}

          <Card className="mt-3 overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">Plants <span className="font-normal text-muted-foreground">· {rows.length}</span></h2>
              <p className="text-xs text-muted-foreground">
                Month from {fmtDate(d?.month_from)} · CUF, S.Y. and PR use the days reported · a dash means nothing recorded
              </p>
            </div>
            <CardContent className="p-0">
              {!rows.length ? (
                <EmptyState
                  icon={Sun}
                  title="No plants"
                  description="Plants you are assigned to, with a capacity on record, appear here."
                />
              ) : (
                <div>
                  <Table wrapperClassName="max-h-[calc(100vh-22rem)] min-h-[12rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plant</TableHead>
                        <TableHead className="text-right">DC</TableHead>
                        <TableHead className="text-right">Today</TableHead>
                        <TableHead className="text-right">Month</TableHead>
                        <TableHead className="text-right">Days</TableHead>
                        <TableHead className="text-right">S.Y.</TableHead>
                        <TableHead className="text-right">CUF %</TableHead>
                        <TableHead className="text-right" title="Performance ratio on the days with an insolation reading">PR %</TableHead>
                        <TableHead className="text-right">Tickets</TableHead>
                        <TableHead>Last reading</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.site_id}>
                          <TableCell className="whitespace-nowrap py-1.5">
                            <span className="font-medium">{r.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {r.location ?? ''}
                              {r.inverter_count ? `${r.location ? ' · ' : ''}${fmtNumber(r.inverter_count)} inv` : ''}
                            </span>
                          </TableCell>
                          <TableCell className="tabular text-right">{capacity(r.capacity_dc_kwp)}</TableCell>
                          <TableCell className="tabular text-right">
                            {r.reported_today ? (
                              fmtNumber(r.today_kwh)
                            ) : (
                              <Badge variant="warning">Not reported</Badge>
                            )}
                          </TableCell>
                          <TableCell className="tabular text-right font-medium">{energy(r.month_kwh)}</TableCell>
                          <TableCell className="tabular text-right">{fmtNumber(r.days_reported)}</TableCell>
                          <TableCell className="tabular text-right">
                            {r.specific_yield === null ? '—' : fmtNumber(r.specific_yield, 2)}
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {r.month_cuf === null ? '—' : fmtNumber(r.month_cuf, 2)}
                          </TableCell>
                          <TableCell className={cn('tabular text-right font-medium', prTone(r.month_pr))}
                            title={r.month_pr == null ? 'No insolation recorded this month' : `${fmtNumber(r.pr_days)} day(s) with insolation${r.today_pr != null ? ` · today ${fmtNumber(r.today_pr, 1)}%` : ''}`}>
                            {r.month_pr == null ? '—' : fmtNumber(r.month_pr, 1)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.open_tickets === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Badge variant={r.critical_tickets > 0 ? 'destructive' : 'warning'}>
                                {fmtNumber(r.open_tickets)}
                                {r.critical_tickets > 0 ? ` · ${fmtNumber(r.critical_tickets)} critical` : ''}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {r.last_reading ? fmtDate(r.last_reading) : '—'}
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
