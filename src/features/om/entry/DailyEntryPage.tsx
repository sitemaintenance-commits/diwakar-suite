// The technician's daily field form — the direct replacement for the
// Google Form used by the O&M CRM today. Same fields, same order:
//   Date · Site · Insolation · Grid outage · INV-01 … INV-n · Remarks
// The total is the sum of the inverter readings and is computed in the
// database on save. A technician only sees the sites assigned to them,
// and nothing else on this page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, Loader2, Save, Sun, TriangleAlert, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { useAccess } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, Field, PageHeader } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { fmtKwh } from '@/features/om/shared';
import { useInverterAnalysis } from '@/features/om/opsApi';

interface EntrySite {
  site_id: string;
  name: string;
  location: string | null;
  capacity_dc_kwp: number | string;
  inverter_count: number;
  stage: string;
  entry: {
    id: string;
    generation_kwh: number | string;
    irradiation: number | string | null;
    grid_outage_hrs: number | string;
    plant_outage_hrs: number | string;
    remarks: string | null;
    readings: { label: string; kwh: number | string }[];
    source: string;
  } | null;
}

interface FieldEntryData {
  date: string;
  sites: EntrySite[];
  recent: { date: string; site: string; generation_kwh: number | string; source: string }[];
}

function useFieldEntry(date: string) {
  return useQuery({
    queryKey: ['field-entry', date],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_field_entry', { p_date: date });
      if (error) throw error;
      return (data ?? { date, sites: [], recent: [] }) as FieldEntryData;
    },
  });
}

const label = (i: number) => `INV-${String(i + 1).padStart(2, '0')}`;

export function DailyEntryPage() {
  const { access } = useAccess();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIST());
  const data = useFieldEntry(date);
  const [siteId, setSiteId] = useState('');
  const [readings, setReadings] = useState<string[]>([]);
  const [insolation, setInsolation] = useState('');
  const [gridOutage, setGridOutage] = useState('');
  const [plantOutage, setPlantOutage] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const sites = data.data?.sites ?? [];
  const site = sites.find((s) => s.site_id === siteId) ?? sites[0];

  // Load the form once per site+date. A background refetch must never wipe
  // readings a technician is in the middle of typing.
  const loadedFor = useRef<string>('');
  useEffect(() => {
    if (!site) return;
    const key = `${site.site_id}|${date}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    if (siteId !== site.site_id) setSiteId(site.site_id);
    const count = site.inverter_count || 12;
    const existing = site.entry?.readings ?? [];
    setReadings(Array.from({ length: count }, (_, i) => {
      const found = existing.find((r) => r.label === label(i));
      return found ? String(safeNum(found.kwh)) : '';
    }));
    setInsolation(site.entry?.irradiation != null ? String(safeNum(site.entry.irradiation)) : '');
    setGridOutage(site.entry ? String(safeNum(site.entry.grid_outage_hrs)) : '');
    setPlantOutage(site.entry ? String(safeNum(site.entry.plant_outage_hrs)) : '');
    setRemarks(site.entry?.remarks ?? '');
  }, [site, siteId, date]);

  const total = useMemo(() => readings.reduce((sum, r) => sum + safeNum(r), 0), [readings]);
  const filled = readings.filter((r) => r.trim() !== '').length;

  async function save() {
    if (!site) return;
    if (filled === 0) return toast.error('Enter at least one inverter reading.');
    setBusy(true);
    const { error } = await supabase.rpc('save_field_entry', {
      p_site_id: site.site_id,
      p_date: date,
      p_readings: readings
        .map((value, i) => ({ label: label(i), kwh: safeNum(value), entered: value.trim() !== '' }))
        .filter((r) => r.entered)
        .map(({ label: l, kwh }) => ({ label: l, kwh })),
      p_insolation: insolation ? safeNum(insolation) : null,
      p_grid_outage: safeNum(gridOutage),
      p_plant_outage: safeNum(plantOutage),
      p_remarks: remarks.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    loadedFor.current = '';   // pick up the stored version on the next load
    toast.success(`${site.name}: ${fmtKwh(total, 1)} saved for ${fmtDate(date)}`);
    await qc.invalidateQueries({ queryKey: ['field-entry'] });
    await qc.invalidateQueries({ queryKey: ['generation'] });
    await qc.invalidateQueries({ queryKey: ['generation-summary'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  }

  const firstName = access?.profile?.full_name?.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        icon={ClipboardList}
        title="Daily Entry"
        description={`Fill in today's readings for your site${firstName ? `, ${firstName}` : ''}. The O&M head sees them straight away.`}
      />

      {data.isLoading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : data.error ? (
        <Card>
          <ErrorState message={errorMessage(data.error)} onRetry={() => data.refetch()} />
        </Card>
      ) : !sites.length ? (
        <Card>
          <EmptyState icon={Sun} title="No site assigned" description="Ask the O&M head to assign your site to your account." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Daily generation form</CardTitle>
              <CardDescription>
                {site?.entry ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-4 w-4" /> Already submitted for this day — saving again will correct it.
                  </span>
                ) : (
                  'One entry per site per day.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="fe_date">
                  <Input id="fe_date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Site">
                  {sites.length === 1 ? (
                    <Input value={`${site?.name}${site?.location ? ` – ${site.location}` : ''}`} disabled />
                  ) : (
                    <FilterSelect
                      value={siteId}
                      onChange={setSiteId}
                      options={sites.map((s) => [s.site_id, `${s.name}${s.location ? ` – ${s.location}` : ''}`] as [string, string])}
                    />
                  )}
                </Field>
                <Field label="Insolation (kWh/m²)" htmlFor="fe_ins" hint="Leave blank if the pyranometer reading is not available.">
                  <Input id="fe_ins" inputMode="decimal" value={insolation} onChange={(e) => setInsolation(e.target.value)} placeholder="e.g. 5.42" />
                </Field>
                <Field label="Grid outage (hours)" htmlFor="fe_grid">
                  <Input id="fe_grid" inputMode="decimal" value={gridOutage} onChange={(e) => setGridOutage(e.target.value)} placeholder="0" />
                </Field>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Inverter readings (kWh)</p>
                  <span className="text-xs text-muted-foreground">
                    {fmtNumber(filled)} of {fmtNumber(readings.length)} filled
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {readings.map((value, i) => (
                    <label key={i} className="grid gap-1">
                      <span className="text-xs font-medium text-muted-foreground">{label(i)}</span>
                      <Input
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => setReadings((rs) => rs.map((r, j) => (j === i ? e.target.value : r)))}
                        className="text-right"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Plant outage (hours)" htmlFor="fe_plant" hint="Time the plant itself was down.">
                  <Input id="fe_plant" inputMode="decimal" value={plantOutage} onChange={(e) => setPlantOutage(e.target.value)} placeholder="0" />
                </Field>
              </div>

              <Field label="Remarks" htmlFor="fe_rem" hint="Breakdowns, cleaning, visitors, anything the O&M head should know.">
                <Textarea id="fe_rem" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>

              <div className="flex flex-col gap-3 rounded-xl border bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Total generation</div>
                  <div className="tabular text-2xl font-bold">{fmtKwh(total, 1)}</div>
                </div>
                <Button size="lg" onClick={save} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Save />} {site?.entry ? 'Update entry' : 'Save entry'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
            {site && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{site.name}</CardTitle>
                  <CardDescription>{site.location ?? ''}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">DC capacity</span>
                    <span className="font-medium">{fmtCapacity(site.capacity_dc_kwp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Inverters</span>
                    <span className="font-medium">{fmtNumber(site.inverter_count)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Stage</span>
                    <Badge variant={site.stage === 'commissioned' ? 'success' : 'warning'}>{site.stage}</Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Last 7 days</CardTitle>
                <CardDescription>What has been submitted</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!data.data?.recent?.length ? (
                  <EmptyState icon={Zap} title="Nothing submitted yet" />
                ) : (
                  <ul className="divide-y border-t text-sm">
                    {data.data.recent.slice(0, 12).map((r, i) => (
                      <li key={i} className="flex items-center justify-between px-5 py-2">
                        <span>
                          {fmtDate(r.date)}
                          {sites.length > 1 && <span className="block text-xs text-muted-foreground">{r.site}</span>}
                        </span>
                        <span className="tabular font-medium">{fmtKwh(r.generation_kwh)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <InverterHealth siteId={site?.site_id} date={date} />
          </div>
        </div>
      )}
    </>
  );
}


/**
 * Per-inverter health, the way the O&M site tabs have always done it:
 * each inverter's output per kW of its OWN capacity, against the best
 * inverter on site that day. Comparing siblings under the same sky
 * cancels out the weather, so a weak string stands out even on a day
 * when the site total looks normal.
 */
function InverterHealth({ siteId, date }: { siteId: string | undefined; date: string }) {
  const analysis = useInverterAnalysis(siteId, date);
  const a = analysis.data;
  if (!a || !a.inverters.length || !Number(a.reported_count)) return null;

  const threshold = Math.round(safeNum(a.threshold) * 100);
  const flagged = Number(a.flagged);

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Inverter health</CardTitle>
          <CardDescription>
            Output per kW against the best inverter today. Anything under {fmtNumber(threshold)}% is worth a look.
          </CardDescription>
        </div>
        <Badge variant={flagged > 0 ? 'destructive' : 'success'}>
          {flagged > 0 ? `${fmtNumber(flagged)} to check` : 'All healthy'}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-2">
        {a.inverters.map((inv) => {
          const pct = inv.pct_of_best === null ? 0 : Math.round(safeNum(inv.pct_of_best) * 100);
          const weak = inv.status === 'Need to Check';
          const none = inv.status === 'No reading';
          return (
            <div key={inv.label} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  {inv.label}
                  {weak && <TriangleAlert className="ml-1.5 inline h-3.5 w-3.5 text-destructive" />}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {fmtNumber(inv.kwh, 1)} kWh · {fmtNumber(inv.dc_kwp, 1)} kWp
                  {inv.gen_per_kw !== null && ` · ${fmtNumber(inv.gen_per_kw, 2)} kWh/kWp`}
                  {!none && ` · ${fmtNumber(pct)}%`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full ${none ? 'bg-slate-300' : weak ? 'bg-red-500' : 'bg-primary'}`}
                  style={{ width: `${Math.max(none ? 0 : 2, Math.min(100, pct))}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="mt-1 text-xs text-muted-foreground">
          Best today: {fmtNumber(a.best_gen_per_kw, 2)} kWh/kWp across {fmtNumber(a.total_dc_kwp, 0)} kWp.
        </p>
      </CardContent>
    </Card>
  );
}
