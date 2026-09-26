// Solar Sites — the whole fleet on one screen.
//
// This sits outside O&M on purpose. Someone running the company wants to
// know whether the plants are running, not to work a maintenance queue,
// and should not need the O&M section to find out.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Gauge, Sun, TriangleAlert, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
          can.export && (
            <Button variant="outline" onClick={onExport} disabled={!rows.length}>
              <Download /> Export CSV
            </Button>
          )
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Day</span>
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </label>
          <p className="text-xs text-muted-foreground">
            The month runs from {fmtDate(d?.month_from)}. CUF and S.Y. use the days actually reported, so a
            half-filled month does not read as a collapse.
          </p>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : q.error ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Connected capacity" value={capacity(d?.total_dc_kwp)} hint={`${fmtNumber(d?.sites)} plant(s)`} icon={Sun} />
            <StatCard label="Generated today" value={energy(d?.today_kwh)} hint={`${fmtNumber(d?.reported_today)} of ${fmtNumber(d?.sites)} reported`} icon={Zap} tone="green" />
            <StatCard label="This month" value={energy(d?.month_kwh)} hint={`since ${fmtDate(d?.month_from)}`} icon={Gauge} tone="violet" />
            <StatCard
              label="Open tickets"
              value={fmtNumber(d?.open_tickets)}
              hint={`${fmtNumber(d?.critical_tickets)} critical`}
              icon={TriangleAlert}
              tone={safeNum(d?.critical_tickets) > 0 ? 'red' : 'amber'}
            />
          </div>

          {silent.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                No reading yet for {fmtDate(d?.date)} from {silent.map((r) => r.name).join(', ')}. A plant with
                no reading is not the same as a plant that generated nothing.
              </span>
            </div>
          )}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Plants</CardTitle>
              <CardDescription>
                Sites you have access to. A blank figure means nothing was recorded, not zero.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!rows.length ? (
                <EmptyState
                  icon={Sun}
                  title="No plants"
                  description="Plants you are assigned to, with a capacity on record, appear here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plant</TableHead>
                        <TableHead className="text-right">DC</TableHead>
                        <TableHead className="text-right">Today</TableHead>
                        <TableHead className="text-right">Month</TableHead>
                        <TableHead className="text-right">Days</TableHead>
                        <TableHead className="text-right">S.Y.</TableHead>
                        <TableHead className="text-right">CUF %</TableHead>
                        <TableHead className="text-right">Tickets</TableHead>
                        <TableHead>Last reading</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.site_id}>
                          <TableCell className="whitespace-nowrap">
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.location ?? 'Location not set'}
                              {r.inverter_count ? ` · ${fmtNumber(r.inverter_count)} inverters` : ''}
                            </div>
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
