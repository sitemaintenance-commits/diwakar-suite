// The technician's daily field form — the direct replacement for the
// "SOLAR PLANT DAILY GENERATION REPORT" Google Form. Same questions, same
// order:
//   Date · Site · INV-01 … INV-n · Any grid / plant failure today? ·
//   Which side? · Failure reason · Failure timing · Details · Weather
// plus the insolation reading, which the form never asked for.
// The total is the sum of the inverter readings and is computed in the
// database on save. A technician only sees the sites assigned to them,
// and nothing else on this page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, Sun, Trash2, TriangleAlert, Zap } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtNumber, fmtRelative, safeNum, todayIST } from '@/lib/format';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, Field, PageHeader } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { fmtKwhDay } from '@/features/om/shared';
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
    outage_windows: OutageWindow[] | null;
    remarks: string | null;
    readings: { label: string; kwh: number | string }[];
    source: string;
    weather: string | null;
    had_failure: boolean | null;
    failure_side: 'gss' | 'plant' | null;
    failure_reason: string | null;
  } | null;
}

interface FieldEntryData {
  date: string;
  sites: EntrySite[];
  /** Absent when the database predates the reason list (migration 20260929000001). */
  failure_reasons?: { side: 'gss' | 'plant'; label: string }[];
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


/** One stretch of time the plant was down. */
export interface OutageWindow {
  kind: 'grid' | 'plant';
  from: string;
  to: string;
}

const isTime = (v: string) => /^\d{1,2}:\d{2}$/.test((v ?? '').trim());

/** Minutes between two HH:MM values; a reversed window counts as nothing. */
function windowMinutes(w: OutageWindow): number {
  if (!isTime(w.from) || !isTime(w.to)) return 0;
  const [fh, fm] = w.from.split(':').map(Number);
  const [th, tm] = w.to.split(':').map(Number);
  return Math.max(th * 60 + tm - (fh * 60 + fm), 0);
}

export function outageHours(windows: OutageWindow[], kind?: OutageWindow['kind']): number {
  return windows
    .filter((w) => !kind || w.kind === kind)
    .reduce((n, w) => n + windowMinutes(w), 0) / 60;
}

/** The Google Form's weather choices, in its order. */
export const WEATHER = ['Clear Weather', 'Lightly Cloudy', 'Fully Cloudy', 'Light Rain', 'Heavy Rain', 'Sandstorm', 'Dusty / Hazy'];
export const SIDE_LABEL = { gss: 'GSS side failure', plant: 'Plant side failure' } as const;
const OTHER = 'Other';

const label = (i: number) => `INV-${String(i + 1).padStart(2, '0')}`;

interface SheetSync {
  at?: string;
  error?: string;
  added?: number;
  updated?: number;
  kept_suite_version?: number;
  unknown_sites?: string[];
}

export function DailyEntryPage() {
  const { access, setting, refresh: refreshAccess } = useAccess();
  const can = useCan('om.daily_entry');
  const qc = useQueryClient();
  const lastSync = setting<SheetSync | null>('generation_sheet_last_sync', null);
  const [syncing, setSyncing] = useState(false);

  /** Pull the technicians' Google Form sheet in now (it also runs every 30 minutes). */
  async function syncNow() {
    setSyncing(true);
    try {
      const { data: out, error } = await supabase.functions.invoke('sheet-sync', { body: {} });
      if (error) {
        const payload = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
        throw new Error(payload?.error ?? error.message);
      }
      const r = out as SheetSync;
      toast.success(`Google Sheet synced: ${fmtNumber(r.added)} new, ${fmtNumber(r.updated)} updated${r.kept_suite_version ? `, ${fmtNumber(r.kept_suite_version)} kept as edited here` : ''}.`);
      loadedFor.current = '';
      await Promise.all([qc.invalidateQueries({ queryKey: ['field-entry'] }), refreshAccess()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }
  const [date, setDate] = useState(todayIST());
  const data = useFieldEntry(date);
  const [siteId, setSiteId] = useState('');
  const [readings, setReadings] = useState<string[]>([]);
  const [insolation, setInsolation] = useState('');
  const [windows, setWindows] = useState<OutageWindow[]>([]);
  const [remarks, setRemarks] = useState('');
  const [weather, setWeather] = useState('');
  const [failure, setFailure] = useState<'' | 'yes' | 'no'>('');
  const [side, setSide] = useState<'' | 'gss' | 'plant'>('');
  const [reason, setReason] = useState('');
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
    setWindows(site.entry?.outage_windows ?? []);
    setRemarks(site.entry?.remarks ?? '');
    setWeather(site.entry?.weather ?? '');
    const e = site.entry;
    setFailure(!e ? '' : e.had_failure ?? (safeNum(e.grid_outage_hrs) + safeNum(e.plant_outage_hrs) > 0) ? 'yes' : 'no');
    setSide(e?.failure_side ?? '');
    const listed = (data.data?.failure_reasons ?? []).some((r) => r.label === e?.failure_reason);
    if (e?.source === 'sheet' && e.failure_reason && !listed) {
      setReason(OTHER);
      setRemarks([e.remarks, e.failure_reason].filter(Boolean).join('\n'));
    } else {
      setReason(e?.failure_reason ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, siteId, date]);

  const reasons = useMemo(
    () => (data.data?.failure_reasons ?? []).filter((r) => !side || r.side === side),
    [data.data?.failure_reasons, side],
  );

  const total = useMemo(() => readings.reduce((sum, r) => sum + safeNum(r), 0), [readings]);
  const filled = readings.filter((r) => r.trim() !== '').length;

  async function save() {
    if (!site) return;
    if (filled === 0) return toast.error('Enter at least one inverter reading.');
    if (!failure) return toast.error('Answer whether there was a grid or plant failure today.');
    if (failure === 'yes') {
      if (!side) return toast.error('Choose which side the failure came from.');
      if (!reason) return toast.error('Choose the failure reason.');
      if (reason === OTHER && !remarks.trim()) return toast.error('Describe the failure in the details.');
    }
    if (!weather) return toast.error('Choose the weather condition.');
    setBusy(true);
    const { error } = await supabase.rpc('save_field_entry', {
      p_site_id: site.site_id,
      p_date: date,
      p_readings: readings
        .map((value, i) => ({ label: label(i), kwh: safeNum(value), entered: value.trim() !== '' }))
        .filter((r) => r.entered)
        .map(({ label: l, kwh }) => ({ label: l, kwh })),
      p_insolation: insolation ? safeNum(insolation) : null,
      p_grid_outage: 0,
      p_plant_outage: 0,
      p_remarks: remarks.trim() || null,
      p_outage_windows: failure === 'yes' ? windows.filter((w) => isTime(w.from) && isTime(w.to)) : [],
      p_weather: weather,
      p_had_failure: failure === 'yes',
      p_failure_side: failure === 'yes' ? side : null,
      p_failure_reason: failure === 'yes' ? reason : null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    loadedFor.current = '';   // pick up the stored version on the next load
    toast.success(`${site.name}: ${fmtKwhDay(total, 1)} saved for ${fmtDate(date)}`);
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

      {(can.create || can.edit) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm">
          <FileSpreadsheet className="h-4 w-4 text-green-700" />
          <span className="font-medium">Google Sheet</span>
          <span className="text-muted-foreground">
            {lastSync?.error
              ? `last sync failed: ${lastSync.error}`
              : lastSync?.at
                ? `synced ${fmtRelative(lastSync.at)} · the technicians' form answers come in every 30 minutes`
                : "the technicians' form answers come in every 30 minutes"}
            {lastSync?.unknown_sites?.length ? ` · not matched to a site: ${lastSync.unknown_sites.join(', ')}` : ''}
          </span>
          <Button size="sm" variant="outline" className="ml-auto" disabled={syncing} onClick={() => void syncNow()}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
          </Button>
        </div>
      )}

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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Daily generation form</CardTitle>
              <CardDescription>
                {site?.entry?.source === 'sheet' ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <FileSpreadsheet className="h-4 w-4" /> From the technicians' Google Form — edit and save to correct it; the sheet will not change it again.
                  </span>
                ) : site?.entry ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-4 w-4" /> Already submitted for this day — saving again will correct it.
                  </span>
                ) : (
                  'One entry per site per day.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {data.data && !data.data.failure_reasons && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    The database has not been updated for this form yet, so the failure reasons are missing and saving will
                    fail. An administrator needs to run the latest database update (migration 20260929000001).
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <div className="grid gap-4 rounded-xl border p-4">
                <div>
                  <p className="text-sm font-medium">
                    Any grid / plant failure today? <span className="text-destructive">*</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Answer Yes if there was any shutdown, grid failure or plant interruption.</p>
                </div>
                <Choice
                  value={failure}
                  onChange={(v) => {
                    setFailure(v as 'yes' | 'no');
                    if (v === 'no') setWindows([]);
                  }}
                  options={[['yes', 'Yes'], ['no', 'No']]}
                />

                {failure === 'yes' && (
                  <>
                    <Field label="Failure / shutdown from which side?">
                      <Choice
                        value={side}
                        onChange={(v) => {
                          setSide(v as 'gss' | 'plant');
                          // A reason from the other side no longer fits.
                          if (reason && reason !== OTHER && !data.data?.failure_reasons?.some((r) => r.label === reason && r.side === v)) setReason('');
                        }}
                        options={[['gss', SIDE_LABEL.gss], ['plant', SIDE_LABEL.plant]]}
                      />
                    </Field>
                    <Field label="Failure reason" hint={side ? 'The causes the team records most often. Choose Other and describe it below if none fits.' : 'Choose the side first.'}>
                      <FilterSelect
                        value={reason}
                        onChange={setReason}
                        placeholder={side ? 'Choose the reason' : 'Choose the side first'}
                        options={[...reasons.map((r) => [r.label, r.label] as [string, string]), [OTHER, 'Other (describe in the details)']]}
                      />
                    </Field>
                    <OutageEditor windows={windows} onChange={setWindows} defaultKind={side === 'plant' ? 'plant' : 'grid'} />
                  </>
                )}
              </div>

              <Field
                label={failure === 'yes' ? 'Failure details' : 'Remarks'}
                htmlFor="fe_rem"
                hint={failure === 'yes'
                  ? 'The issue, the equipment affected and the action taken.'
                  : 'Cleaning, visitors, anything else the O&M head should know.'}
              >
                <Textarea id="fe_rem" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>

              <Field label="Weather condition *">
                <FilterSelect value={weather} onChange={setWeather} placeholder="Choose" options={WEATHER.map((w) => [w, w] as [string, string])} />
              </Field>

              <div className="flex flex-col gap-3 rounded-xl border bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Total generation</div>
                  <div className="tabular text-2xl font-bold">{fmtKwhDay(total, 1)}</div>
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
                        <span className="tabular font-medium">{fmtKwhDay(r.generation_kwh)}</span>
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


/**
 * Outage as the O&M team has always written it: the windows the plant
 * was down, not a decimal. The hours are added up here and again in the
 * database, so the record and the number can never drift apart.
 */
function OutageEditor({
  windows,
  onChange,
  defaultKind = 'grid',
}: {
  windows: OutageWindow[];
  onChange: (w: OutageWindow[]) => void;
  defaultKind?: OutageWindow['kind'];
}) {
  const set = (i: number, patch: Partial<OutageWindow>) =>
    onChange(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const grid = outageHours(windows, 'grid');
  const plant = outageHours(windows, 'plant');

  return (
    <div className="grid gap-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Failure timing</p>
          <p className="text-xs text-muted-foreground">
            From and to, for every interruption today.
          </p>
        </div>
        <div className="tabular text-xs text-muted-foreground">
          Grid {fmtNumber(grid, 2)} h · Plant {fmtNumber(plant, 2)} h
        </div>
      </div>

      {windows.map((w, i) => {
        const bad = (w.from || w.to) && (!isTime(w.from) || !isTime(w.to));
        const reversed = !bad && isTime(w.from) && isTime(w.to) && windowMinutes(w) === 0;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="w-28">
              <FilterSelect
                value={w.kind}
                onChange={(v) => set(i, { kind: v as OutageWindow['kind'] })}
                options={[['grid', 'Grid'], ['plant', 'Plant']]}
              />
            </div>
            <Input
              type="time"
              value={w.from}
              onChange={(e) => set(i, { from: e.target.value })}
              className="w-32"
              aria-label={`Window ${i + 1} from`}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="time"
              value={w.to}
              onChange={(e) => set(i, { to: e.target.value })}
              className="w-32"
              aria-label={`Window ${i + 1} to`}
            />
            <span className="tabular min-w-[4.5rem] text-sm text-muted-foreground">
              {isTime(w.from) && isTime(w.to) ? `${fmtNumber(windowMinutes(w))} min` : ''}
            </span>
            {reversed && <span className="text-xs text-destructive">ends before it starts</span>}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onChange(windows.filter((_, j) => j !== i))}
              aria-label={`Remove window ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...windows, { kind: defaultKind, from: '', to: '' }])}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add window
        </Button>
      </div>
    </div>
  );
}


/** A small segmented choice, the Google Form's radio buttons. */
function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            value === v ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
