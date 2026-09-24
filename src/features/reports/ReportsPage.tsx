// Centralised reports. Each report is one database function running as the
// caller, so a report can never reveal a row the user could not open in its
// own module — and the tab only appears if they hold the report permission.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarChart3, Download, FileWarning } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtCapacity, fmtDate, fmtINR, fmtNumber, safeNum, titleCase, todayIST } from '@/lib/format';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { fmtKwh } from '@/features/om/shared';

type ReportKey = 'crm' | 'generation' | 'om' | 'hr' | 'daily';

const REPORTS: { key: ReportKey; module: string; rpc: string; label: string; description: string }[] = [
  { key: 'crm', module: 'reports.crm', rpc: 'report_tenders', label: 'Tenders & quotations', description: 'Bid outcomes, win rate, EMD and quotation value' },
  { key: 'generation', module: 'reports.generation', rpc: 'report_generation', label: 'Generation', description: 'Energy per site and per month, with revenue where a tariff is set' },
  { key: 'om', module: 'reports.om', rpc: 'report_om', label: 'O&M', description: 'Tickets, downtime and maintenance per site' },
  { key: 'hr', module: 'reports.hr', rpc: 'report_hr', label: 'HR', description: 'Headcount, attendance, leave and tasks' },
  { key: 'daily', module: 'reports.daily', rpc: 'report_daily', label: 'Daily review', description: 'Reporting discipline and issues per department' },
];

function monthStart() {
  return `${todayIST().slice(0, 7)}-01`;
}

export function ReportsPage() {
  const { can } = useAccess();
  const available = REPORTS.filter((r) => can(r.module, 'view'));
  const [active, setActive] = useState<ReportKey | null>(available[0]?.key ?? null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIST());

  const report = REPORTS.find((r) => r.key === active);
  const query = useQuery({
    queryKey: ['report', active, from, to],
    enabled: Boolean(report),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(report!.rpc, { p_from: from, p_to: to });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });

  if (!available.length) {
    return (
      <>
        <PageHeader icon={BarChart3} title="Reports" />
        <Card>
          <EmptyState icon={FileWarning} title="No reports available" description="Ask your administrator for access to the reports you need." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={BarChart3} title="Reports" description="Every figure respects your permissions and your sites." />

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {available.map((r) => (
            <button
              key={r.key}
              onClick={() => setActive(r.key)}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                active === r.key ? 'border-primary bg-primary-soft text-primary' : 'bg-card hover:bg-muted'
              }`}
            >
              <div className="font-medium">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.description}</div>
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">From</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">To</span>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </label>
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : query.error ? (
        <Card>
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <ReportBody reportKey={active!} module={report!.module} label={report!.label} data={query.data ?? {}} from={from} to={to} />
      )}
    </>
  );
}

interface Row {
  [k: string]: unknown;
}

function ReportBody({
  reportKey,
  module,
  label,
  data,
  from,
  to,
}: {
  reportKey: ReportKey;
  module: string;
  label: string;
  data: Record<string, unknown>;
  from: string;
  to: string;
}) {
  const can = useCan(module);

  // Postgres jsonb does not preserve key order, so each report states the
  // column order it wants to be read in.
  const table: { title: string; rows: Row[]; columns: string[] } = useMemo(() => {
    const pick = (rows: Row[], columns: string[]) => columns.filter((c) => rows.some((r) => c in r));
    if (reportKey === 'crm') {
      const rows = (data.by_authority as Row[]) ?? [];
      return { title: 'By authority', rows, columns: pick(rows, ['authority', 'tenders', 'won', 'value', 'won_value']) };
    }
    if (reportKey === 'generation') {
      const rows = (data.by_site as Row[]) ?? [];
      return {
        title: 'By site',
        rows,
        columns: pick(rows, ['site', 'capacity_kwp', 'days_recorded', 'generation', 'expected', 'grid_outage', 'plant_outage', 'tariff', 'revenue']),
      };
    }
    if (reportKey === 'om') {
      const rows = (data.by_site as Row[]) ?? [];
      return { title: 'By site', rows, columns: pick(rows, ['site', 'tickets', 'open', 'downtime', 'maintenance_done', 'maintenance_pending']) };
    }
    if (reportKey === 'hr') {
      const rows = (data.by_department as Row[]) ?? [];
      return { title: 'By department', rows, columns: pick(rows, ['department', 'employees']) };
    }
    const rows = (data.by_department as Row[]) ?? [];
    return {
      title: 'By department',
      rows,
      columns: pick(rows, ['department', 'reports', 'on_track', 'needs_attention', 'critical', 'issues']),
    };
  }, [reportKey, data]);

  async function onExport() {
    if (!table.rows.length) return toast.error('Nothing to export for this period.');
    const columns = table.columns.map((k) => ({ header: titleCase(k), value: (r: Row) => r[k] }));
    try {
      await exportCsv(module, `${reportKey}-report-${from}-to-${to}`, table.rows, columns);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const cards = (() => {
    if (reportKey === 'crm') {
      const s = (data.summary ?? {}) as Row;
      return [
        { label: 'Tenders', value: fmtNumber(s.total) },
        { label: 'Won', value: `${fmtNumber(s.won)} (${s.win_rate == null ? '—' : `${fmtNumber(s.win_rate, 1)}%`})` },
        { label: 'Value won', value: fmtINR(s.value_won, true) },
        { label: 'EMD blocked', value: fmtINR(s.emd_blocked, true) },
      ];
    }
    if (reportKey === 'generation') {
      const byMonth = (data.by_month as Row[]) ?? [];
      return [
        { label: 'Total generation', value: fmtKwh(data.total) },
        { label: 'Months covered', value: fmtNumber(byMonth.length) },
        { label: 'Sites', value: fmtNumber(((data.by_site as Row[]) ?? []).length) },
        {
          label: 'Revenue (where tariff set)',
          value: fmtINR(((data.by_site as Row[]) ?? []).reduce((sum, r) => sum + safeNum(r.revenue), 0), true),
        },
      ];
    }
    if (reportKey === 'om') {
      const t = (data.tickets ?? {}) as Row;
      return [
        { label: 'Tickets raised', value: fmtNumber(t.raised) },
        { label: 'Still open', value: fmtNumber(t.open) },
        { label: 'Average downtime', value: t.avg_downtime_hours == null ? '—' : `${fmtNumber(t.avg_downtime_hours, 2)} h` },
        { label: 'Generation lost', value: fmtKwh(t.generation_loss) },
      ];
    }
    if (reportKey === 'hr') {
      const h = (data.headcount ?? {}) as Row;
      const a = (data.attendance ?? {}) as Row;
      const l = (data.leave ?? {}) as Row;
      return [
        { label: 'Active employees', value: fmtNumber(h.active) },
        { label: 'Attendance marked', value: fmtNumber(a.records) },
        { label: 'Present rate', value: a.present_rate == null ? '—' : `${fmtNumber(a.present_rate, 1)}%` },
        { label: 'Leave days approved', value: fmtNumber(l.days, 1) },
      ];
    }
    const s = (data.summary ?? {}) as Row;
    return [
      { label: 'Reports filed', value: fmtNumber(s.submitted) },
      { label: 'Reviewed', value: fmtNumber(s.reviewed) },
      { label: 'With issues', value: fmtNumber(s.with_issues) },
      { label: 'Critical days', value: fmtNumber(s.critical) },
    ];
  })();

  const formatCell = (key: string, value: unknown) => {
    if (value === null || value === undefined) return '—';
    if (key.includes('value') || key === 'revenue') return fmtINR(value, true);
    if (key === 'generation' || key === 'expected') return fmtKwh(value);
    if (key === 'capacity_kwp') return fmtCapacity(value);
    if (typeof value === 'number' || (!Number.isNaN(Number(value)) && typeof value !== 'boolean' && value !== ''))
      return <span className="tabular">{fmtNumber(value, String(value).includes('.') ? 2 : 0)}</span>;
    return String(value);
  };

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} />
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>
              {label} · {table.title}
            </CardTitle>
            <CardDescription>
              {fmtDate(from)} – {fmtDate(to)}
            </CardDescription>
          </div>
          {can.export && (
            <Button variant="outline" onClick={onExport}>
              <Download /> Export
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!table.rows.length ? (
            <EmptyState icon={BarChart3} title="No data for this period" description="Try a wider date range." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((k, i) => (
                    <TableHead key={k} className={i === 0 ? '' : 'text-right'}>
                      {titleCase(k)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((r, i) => (
                  <TableRow key={i}>
                    {table.columns.map((k, j) => (
                      <TableCell key={k} className={j === 0 ? 'font-medium' : 'text-right'}>
                        {formatCell(k, r[k])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {reportKey === 'generation' && ((data.by_month as Row[]) ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>By month</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Generation</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((data.by_month as Row[]) ?? []).map((m) => (
                  <TableRow key={String(m.month)}>
                    <TableCell className="font-medium">{String(m.month)}</TableCell>
                    <TableCell className="tabular text-right">{fmtKwh(m.generation)}</TableCell>
                    <TableCell className="tabular text-right">{m.expected ? fmtKwh(m.expected) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
