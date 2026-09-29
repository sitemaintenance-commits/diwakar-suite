// CUF on AC & DC capacity -- the O&M team's monthly workbook, as a page.
//
//   Since full load  the workbook's Main tab: each plant's CUF from the month
//                    it first ran on its full DC capacity, up to a chosen month
//   Month by month   the plant tabs: generation, JMR, TL loss, CUF on DC and AC
//
// CUF = generation / (capacity x 24 x days) x 100, on calendar days; a month
// still running counts the days that have passed. A month's generation is
// its recorded total (inverter meters) where there is one, otherwise the
// daily readings added up.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Gauge } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useCufReport, type CufMonth } from '@/features/om/opsApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Metric = 'cuf_dc' | 'cuf_ac' | 'generation_kwh' | 'jmr_kwh' | 'tl_loss_pct';
const METRICS: [Metric, string][] = [
  ['cuf_dc', 'CUF on DC (%)'],
  ['cuf_ac', 'CUF on AC (%)'],
  ['generation_kwh', 'Generation (kWh)'],
  ['jmr_kwh', 'JMR (kWh)'],
  ['tl_loss_pct', 'TL loss (%)'],
];

const blank = (v: unknown) => v === null || v === undefined || v === '';
const pct = (v: unknown, d = 3) => (blank(v) ? '—' : fmtNumber(v, d));

/** "2026-05" for the last complete month. */
function lastCompleteMonth() {
  const t = todayIST();
  const d = new Date(`${t.slice(0, 7)}-01T00:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthName(iso: string | null) {
  if (!iso) return '—';
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function CufTab() {
  const can = useCan('om.analytics');
  const thisYear = Number(todayIST().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [upto, setUpto] = useState(lastCompleteMonth());
  const [metric, setMetric] = useState<Metric>('cuf_dc');
  const report = useCufReport(year, `${upto}-01`);
  const r = report.data;

  const grid = useMemo(() => {
    const bySite = new Map<string, { site: string; months: (CufMonth | undefined)[] }>();
    for (const m of r?.monthly ?? []) {
      const row = bySite.get(m.site_id) ?? { site: m.site, months: Array(12).fill(undefined) };
      row.months[m.month - 1] = m;
      bySite.set(m.site_id, row);
    }
    return [...bySite.values()];
  }, [r?.monthly]);

  async function exportMain() {
    if (!r?.plants.length) return;
    try {
      await exportXlsx(
        'om.analytics',
        `cuf-since-full-load-to-${upto}`,
        r.plants,
        [
          { header: 'S.N', value: (p) => r.plants.indexOf(p) + 1, width: 5 },
          { header: 'Plant name', value: (p) => (p.location ? `${p.name} - ${p.location}` : p.name), width: 28 },
          { header: 'AC capacity (kW)', value: (p) => (blank(p.capacity_ac_kw) ? null : safeNum(p.capacity_ac_kw)), numFmt: '#,##0' },
          { header: 'Actual DC capacity (kW)', value: (p) => (blank(p.capacity_dc_kwp) ? null : safeNum(p.capacity_dc_kwp)), numFmt: '#,##0', width: 14 },
          { header: 'LOA capacity (kW)', value: (p) => (blank(p.loa_capacity_kw) ? null : safeNum(p.loa_capacity_kw)), numFmt: '#,##0' },
          { header: 'Full load from', value: (p) => monthName(p.full_load_from) },
          { header: 'Total (kWh)', value: (p) => (blank(p.total_kwh) ? null : safeNum(p.total_kwh)), numFmt: '#,##0.00', width: 16 },
          { header: 'Days', value: (p) => p.days ?? null },
          { header: 'CUF on DC (%)', value: (p) => (blank(p.cuf_dc) ? null : safeNum(p.cuf_dc)), numFmt: '0.000' },
          { header: 'CUF on AC (%)', value: (p) => (blank(p.cuf_ac) ? null : safeNum(p.cuf_ac)), numFmt: '0.000' },
        ],
        { sheet: 'Main', title: ['CUF ON AC & DC CAPACITY', `Since each plant reached full load, up to the end of ${monthName(`${upto}-01`)}`] },
      );
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function exportMonthly() {
    if (!r?.monthly.length) return;
    const rows = (r.monthly ?? []).filter((m) => !blank(m.generation_kwh));
    try {
      await exportXlsx(
        'om.analytics',
        `cuf-monthly-${year}`,
        rows,
        [
          { header: 'Plant', value: (m) => m.site, width: 16 },
          { header: 'Month', value: (m) => `${MONTHS[m.month - 1]} ${m.year}` },
          { header: 'Generation (kWh)', value: (m) => safeNum(m.generation_kwh), numFmt: '#,##0.00', width: 16 },
          { header: 'Source', value: (m) => m.source ?? '', width: 16 },
          { header: 'JMR (kWh)', value: (m) => (blank(m.jmr_kwh) ? null : safeNum(m.jmr_kwh)), numFmt: '#,##0', width: 13 },
          { header: 'TL loss (%)', value: (m) => (blank(m.tl_loss_pct) ? null : safeNum(m.tl_loss_pct)), numFmt: '0.000' },
          { header: 'Days', value: (m) => m.days },
          { header: 'CUF on DC (%)', value: (m) => (blank(m.cuf_dc) ? null : safeNum(m.cuf_dc)), numFmt: '0.000' },
          { header: 'CUF on AC (%)', value: (m) => (blank(m.cuf_ac) ? null : safeNum(m.cuf_ac)), numFmt: '0.000' },
          { header: 'Note', value: (m) => (m.running ? 'Month still running' : ''), width: 20 },
        ],
        { sheet: `CUF ${year}`, title: [`MONTHLY GENERATION AND CUF - ${year}`, 'CUF = generation / (capacity x 24 x days) x 100'] },
      );
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (report.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (report.error) {
    return (
      <Card>
        <ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} />
      </Card>
    );
  }
  if (!r?.plants.length) {
    return (
      <Card>
        <EmptyState icon={Gauge} title="No plants" description="No generating plants are assigned to your account." />
      </Card>
    );
  }

  const years = Array.from({ length: thisYear - 2024 + 1 }, (_, i) => thisYear - i);
  const cell = (m: CufMonth | undefined) => {
    if (!m) return '';
    const v = m[metric];
    if (blank(v)) return '—';
    return metric === 'generation_kwh' || metric === 'jmr_kwh' ? fmtNumber(v, 0) : fmtNumber(v, metric === 'tl_loss_pct' ? 2 : 2);
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>CUF since full load</CardTitle>
            <CardDescription>
              Each plant from the month it first ran on its full DC capacity, up to the end of {monthName(`${upto}-01`)}.
              CUF = generation ÷ (capacity × 24 × days) × 100.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Up to
              <Input type="month" value={upto} max={todayIST().slice(0, 7)} onChange={(e) => e.target.value && setUpto(e.target.value)} className="w-40" />
            </label>
            {can.export && (
              <Button variant="outline" size="sm" onClick={exportMain}>
                <Download className="mr-2 h-4 w-4" /> Export Excel
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">S.N</TableHead>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">AC kW</TableHead>
                <TableHead className="text-right">DC kWp</TableHead>
                <TableHead className="text-right">LOA kW</TableHead>
                <TableHead>Full load from</TableHead>
                <TableHead className="text-right">Total kWh</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">CUF on DC %</TableHead>
                <TableHead className="text-right">CUF on AC %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.plants.map((p, i) => (
                <TableRow key={p.site_id}>
                  <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {p.name}
                    {p.location && <span className="block text-xs font-normal text-muted-foreground">{p.location}</span>}
                  </TableCell>
                  <TableCell className="tabular text-right">{blank(p.capacity_ac_kw) ? '—' : fmtNumber(p.capacity_ac_kw)}</TableCell>
                  <TableCell className="tabular text-right">{blank(p.capacity_dc_kwp) ? '—' : fmtNumber(p.capacity_dc_kwp)}</TableCell>
                  <TableCell className="tabular text-right">{blank(p.loa_capacity_kw) ? '—' : fmtNumber(p.loa_capacity_kw)}</TableCell>
                  <TableCell className="whitespace-nowrap">{monthName(p.full_load_from)}</TableCell>
                  <TableCell className="tabular text-right">{blank(p.total_kwh) ? '—' : fmtNumber(p.total_kwh, 0)}</TableCell>
                  <TableCell className="tabular text-right">{p.days ?? '—'}</TableCell>
                  <TableCell className="tabular text-right font-medium">{pct(p.cuf_dc)}</TableCell>
                  <TableCell className="tabular text-right font-medium">{pct(p.cuf_ac)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Month by month</CardTitle>
            <CardDescription>
              The month&apos;s recorded total where there is one, otherwise the daily readings. A month still running
              counts the days so far.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <FilterSelect value={metric} onChange={(v) => setMetric(v as Metric)} options={METRICS} />
            </div>
            <div className="w-28">
              <FilterSelect value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => [String(y), String(y)] as [string, string])} />
            </div>
            {can.export && (
              <Button variant="outline" size="sm" onClick={exportMonthly}>
                <Download className="mr-2 h-4 w-4" /> Export Excel
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plant</TableHead>
                {MONTHS.map((m) => (
                  <TableHead key={m} className="text-right">{m}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {grid.map((row) => (
                <TableRow key={row.site}>
                  <TableCell className="whitespace-nowrap font-medium">{row.site}</TableCell>
                  {row.months.map((m, i) => (
                    <TableCell
                      key={i}
                      className={`tabular text-right ${m?.running ? 'italic text-muted-foreground' : ''}`}
                      title={m ? `${m.source ?? 'no data'} · ${m.days} day(s)${m.running ? ' · month still running' : ''}` : undefined}
                    >
                      {cell(m)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-5 py-3 text-xs text-muted-foreground">
            Italic: the month is still running. {fmtDate(todayIST())}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
