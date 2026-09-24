// Daily generation: a one-row-per-site entry grid for a chosen date, plus
// the history with export. Saving goes through save_generation(), which
// upserts one row per site per day under the caller's RLS.
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Loader2, Save, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtCapacity, fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, Pagination, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSites } from '@/features/admin/api';
import { fetchGeneration, useGeneration, useGenerationForDate, useSolarSites, type GenerationFilters } from '@/features/om/api';
import { fmtKwh } from '@/features/om/shared';

const PAGE_SIZE = 25;
type Entry = { generation_kwh: string; expected_kwh: string; irradiation: string; grid: string; plant: string; remarks: string };
const emptyEntry = (): Entry => ({ generation_kwh: '', expected_kwh: '', irradiation: '', grid: '', plant: '', remarks: '' });

export function GenerationPage() {
  const can = useCan('om.generation');
  const qc = useQueryClient();
  const sites = useSites();
  const solar = useSolarSites();
  const [date, setDate] = useState(todayIST());
  const existing = useGenerationForDate(date);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [saving, setSaving] = useState(false);

  const activeSites = useMemo(() => (sites.data ?? []).filter((s) => s.status === 'active'), [sites.data]);
  const expectedYield = useMemo(
    () => Object.fromEntries((solar.data ?? []).map((s) => [s.site_id, safeNum(s.expected_yield)])),
    [solar.data],
  );

  useEffect(() => {
    const next: Record<string, Entry> = {};
    for (const s of activeSites) {
      const row = existing.data?.[s.id];
      const suggested = expectedYield[s.id] ? String(Math.round(expectedYield[s.id] * safeNum(s.capacity_kwp))) : '';
      next[s.id] = row
        ? {
            generation_kwh: String(safeNum(row.generation_kwh)),
            expected_kwh: row.expected_kwh == null ? suggested : String(safeNum(row.expected_kwh)),
            irradiation: row.irradiation_kwh_m2 == null ? '' : String(safeNum(row.irradiation_kwh_m2)),
            grid: String(safeNum(row.grid_outage_hrs)),
            plant: String(safeNum(row.plant_outage_hrs)),
            remarks: row.remarks ?? '',
          }
        : { ...emptyEntry(), expected_kwh: suggested };
    }
    setEntries(next);
  }, [activeSites, existing.data, expectedYield]);

  const setEntry = (siteId: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [siteId]: { ...e[siteId], ...patch } }));

  const dayTotal = Object.values(entries).reduce((sum, e) => sum + safeNum(e.generation_kwh), 0);
  const filled = Object.values(entries).filter((e) => e.generation_kwh !== '').length;

  async function save() {
    const rows = activeSites
      .filter((s) => entries[s.id]?.generation_kwh !== '')
      .map((s) => ({
        site_id: s.id,
        gen_date: date,
        generation_kwh: safeNum(entries[s.id].generation_kwh),
        expected_kwh: entries[s.id].expected_kwh || null,
        irradiation_kwh_m2: entries[s.id].irradiation || null,
        grid_outage_hrs: safeNum(entries[s.id].grid),
        plant_outage_hrs: safeNum(entries[s.id].plant),
        remarks: entries[s.id].remarks || null,
      }));
    if (!rows.length) return toast.error('Enter at least one reading.');
    setSaving(true);
    const { data, error } = await supabase.rpc('save_generation', { p_rows: rows });
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${fmtNumber(data ?? rows.length)} reading(s) saved for ${fmtDate(date)}`);
    await qc.invalidateQueries({ queryKey: ['generation'] });
    await qc.invalidateQueries({ queryKey: ['generation-date'] });
    await qc.invalidateQueries({ queryKey: ['generation-summary'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  }

  return (
    <>
      <PageHeader icon={Zap} title="Generation" description="Daily energy readings per site — the basis for the monitor, CUF and reports." />

      <Tabs defaultValue={can.create ? 'entry' : 'history'}>
        <TabsList>
          {can.create && <TabsTrigger value="entry">Record readings</TabsTrigger>}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {can.create && (
          <TabsContent value="entry">
            <Card>
              <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <CardTitle>Readings for a day</CardTitle>
                  <CardDescription>One row per site. Leave a site blank if there is no reading yet.</CardDescription>
                </div>
                <div className="flex items-end gap-3">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-muted-foreground">Date</span>
                    <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} className="w-44" />
                  </label>
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" /> : <Save />} Save readings
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {sites.isLoading || existing.isLoading ? (
                  <TableSkeleton cols={6} />
                ) : !activeSites.length ? (
                  <EmptyState icon={Zap} title="No sites assigned" />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm">
                        <thead className="bg-slate-50/80">
                          <tr className="border-y text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-4 py-2 text-left font-semibold">Site</th>
                            <th className="w-32 px-2 py-2 text-right font-semibold">Generation kWh</th>
                            <th className="w-32 px-2 py-2 text-right font-semibold">Expected kWh</th>
                            <th className="w-28 px-2 py-2 text-right font-semibold">Irradiation</th>
                            <th className="w-24 px-2 py-2 text-right font-semibold">Grid out (h)</th>
                            <th className="w-24 px-2 py-2 text-right font-semibold">Plant out (h)</th>
                            <th className="px-2 py-2 text-left font-semibold">Remarks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {activeSites.map((s) => {
                            const e = entries[s.id] ?? emptyEntry();
                            const saved = Boolean(existing.data?.[s.id]);
                            return (
                              <tr key={s.id}>
                                <td className="px-4 py-2">
                                  <div className="font-medium">{s.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {fmtCapacity(s.capacity_kwp)}
                                    {saved ? ' · already saved' : ''}
                                  </div>
                                </td>
                                <td className="px-2 py-2">
                                  <Input inputMode="decimal" value={e.generation_kwh} onChange={(ev) => setEntry(s.id, { generation_kwh: ev.target.value })} className="h-8 text-right" />
                                </td>
                                <td className="px-2 py-2">
                                  <Input inputMode="decimal" value={e.expected_kwh} onChange={(ev) => setEntry(s.id, { expected_kwh: ev.target.value })} className="h-8 text-right" />
                                </td>
                                <td className="px-2 py-2">
                                  <Input inputMode="decimal" value={e.irradiation} onChange={(ev) => setEntry(s.id, { irradiation: ev.target.value })} className="h-8 text-right" placeholder="kWh/m²" />
                                </td>
                                <td className="px-2 py-2">
                                  <Input inputMode="decimal" value={e.grid} onChange={(ev) => setEntry(s.id, { grid: ev.target.value })} className="h-8 text-right" />
                                </td>
                                <td className="px-2 py-2">
                                  <Input inputMode="decimal" value={e.plant} onChange={(ev) => setEntry(s.id, { plant: ev.target.value })} className="h-8 text-right" />
                                </td>
                                <td className="px-2 py-2">
                                  <Input value={e.remarks} onChange={(ev) => setEntry(s.id, { remarks: ev.target.value })} className="h-8" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                      <span className="text-muted-foreground">
                        {fmtNumber(filled)} of {fmtNumber(activeSites.length)} site(s) filled
                      </span>
                      <span className="tabular font-semibold">Day total {fmtKwh(dayTotal, 1)}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="history">
          <GenerationHistory />
        </TabsContent>
      </Tabs>
    </>
  );
}

function GenerationHistory() {
  const can = useCan('om.generation');
  const sites = useSites();
  const today = todayIST();
  const [filters, setFilters] = useState<GenerationFilters>({
    siteId: 'all',
    from: `${today.slice(0, 7)}-01`,
    to: today,
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const history = useGeneration(filters);
  const update = (patch: Partial<GenerationFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));

  async function onExport() {
    try {
      const { rows } = await fetchGeneration(filters, true);
      await exportCsv('om.generation', `generation-${filters.from}-to-${filters.to}`, rows, [
        { header: 'Date', value: (r) => r.gen_date },
        { header: 'Site', value: (r) => r.sites?.name },
        { header: 'Generation (kWh)', value: (r) => safeNum(r.generation_kwh) },
        { header: 'Expected (kWh)', value: (r) => r.expected_kwh },
        { header: 'Irradiation (kWh/m2)', value: (r) => r.irradiation_kwh_m2 },
        { header: 'Grid outage (h)', value: (r) => safeNum(r.grid_outage_hrs) },
        { header: 'Plant outage (h)', value: (r) => safeNum(r.plant_outage_hrs) },
        { header: 'Source', value: (r) => r.source },
        { header: 'Remarks', value: (r) => r.remarks },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end">
        <label className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">From</span>
          <Input type="date" value={filters.from} max={filters.to} onChange={(e) => update({ from: e.target.value })} className="w-40" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">To</span>
          <Input type="date" value={filters.to} min={filters.from} onChange={(e) => update({ to: e.target.value })} className="w-40" />
        </label>
        <div className="grid flex-1 gap-1.5 sm:max-w-xs">
          <span className="text-xs text-muted-foreground">Site</span>
          <FilterSelect value={filters.siteId} onChange={(v) => update({ siteId: v })} options={[['all', 'All my sites'], ...(sites.data ?? []).map((s) => [s.id, s.name] as [string, string])]} />
        </div>
        {can.export && (
          <Button variant="outline" onClick={onExport}>
            <Download /> Export
          </Button>
        )}
      </div>

      {history.isLoading ? (
        <TableSkeleton cols={6} />
      ) : history.error ? (
        <ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} />
      ) : !history.data?.rows.length ? (
        <EmptyState icon={Zap} title="No readings for this period" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Site</TableHead>
              <TableHead className="text-right">Generation</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Outage (grid / plant)</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data.rows.map((r) => {
              const pct = r.expected_kwh ? (safeNum(r.generation_kwh) / safeNum(r.expected_kwh)) * 100 : null;
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.gen_date)}</TableCell>
                  <TableCell className="font-medium">{r.sites?.name ?? '—'}</TableCell>
                  <TableCell className="tabular text-right font-medium">{fmtKwh(r.generation_kwh, 1)}</TableCell>
                  <TableCell className="tabular text-right">
                    {r.expected_kwh ? fmtKwh(r.expected_kwh, 1) : '—'}
                    {pct !== null && (
                      <div className={`text-xs ${pct >= 95 ? 'text-green-700' : pct >= 80 ? 'text-amber-600' : 'text-destructive'}`}>{fmtNumber(pct, 1)}%</div>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm">
                    {fmtNumber(r.grid_outage_hrs, 2)} / {fmtNumber(r.plant_outage_hrs, 2)} h
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{r.remarks ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Pagination page={filters.page} pageSize={PAGE_SIZE} total={history.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
    </Card>
  );
}
