// Site Operations — the daily site register the O&M CRM keeps under
// "Site Operations": an administration checklist, a patrol register by
// time slot and a security checklist, filled at the plant for one site,
// one date and one shift.
//
// The check points come from the database, not from this file, so the
// O&M head can add or retire one without a release.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2, ClipboardCheck, Clock, Download, Loader2, Save, Send, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, safeNum, todayIST } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useSiteOps, useOpsSummary, type OpsCheck, type OpsShift, type OpsUrgency } from '@/features/om/opsApi';

const URGENCY: Record<OpsUrgency, { label: string; tone: 'secondary' | 'warning' | 'destructive' }> = {
  normal: { label: 'Normal', tone: 'secondary' },
  urgent: { label: 'Urgent', tone: 'warning' },
  critical: { label: 'Critical', tone: 'destructive' },
};

/** OK / Not OK / N-A, the three answers the register allows. */
function CheckToggle({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: OpsCheck;
  onChange: (v: OpsCheck) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const options: [OpsCheck, string][] = [
    ['ok', 'OK'],
    ['not_ok', 'Not OK'],
    ['na', 'N/A'],
  ];
  const tone: Record<string, string> = {
    ok: 'bg-green-600 text-white',
    not_ok: 'bg-red-600 text-white',
    na: 'bg-slate-500 text-white',
  };
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === v ? 'pending' : v)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-60 ${
            value === v ? tone[v] : 'text-muted-foreground hover:bg-muted'
          } ${compact ? '' : 'sm:px-3'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function monthsAgo(days: number) {
  const d = new Date(`${todayIST()}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function SiteOperationsPage() {
  const can = useCan('om.operations');
  const qc = useQueryClient();

  const [date, setDate] = useState(todayIST());
  const [shift, setShift] = useState<OpsShift>('day');
  const [siteId, setSiteId] = useState<string | null>(null);
  const ops = useSiteOps(date, siteId, shift);
  const data = ops.data;

  const [entries, setEntries] = useState<Record<string, OpsCheck>>({});
  const [itemRemarks, setItemRemarks] = useState<Record<string, string>>({});
  const [technician, setTechnician] = useState('');
  const [memberId, setMemberId] = useState<string>('');
  const [urgency, setUrgency] = useState<OpsUrgency>('normal');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);

  // Pick the first site the user is allowed to fill.
  useEffect(() => {
    if (!siteId && data?.sites?.length) setSiteId(data.sites[0].site_id);
  }, [data, siteId]);

  // Load once per site+date+shift; a background refetch must not wipe
  // answers a technician is in the middle of giving.
  const loadedFor = useRef('');
  useEffect(() => {
    if (!data || !siteId) return;
    const key = `${siteId}|${date}|${shift}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const next: Record<string, OpsCheck> = {};
    const nextRemarks: Record<string, string> = {};
    for (const item of data.checklist) {
      next[item.id] = data.entries[item.id]?.status ?? 'pending';
      nextRemarks[item.id] = data.entries[item.id]?.remarks ?? '';
    }
    setEntries(next);
    setItemRemarks(nextRemarks);
    setTechnician(data.log?.technician_name ?? '');
    setMemberId(data.log?.member_id ?? '');
    setUrgency(data.log?.urgency ?? 'normal');
    setRemarks(data.log?.remarks ?? '');
  }, [data, siteId, date, shift]);

  const sections = useMemo(() => {
    const list = data?.checklist ?? [];
    return {
      administration: list.filter((i) => i.section === 'administration'),
      patrol: list.filter((i) => i.section === 'patrol'),
      security: list.filter((i) => i.section === 'security'),
    };
  }, [data]);

  const done = (section: keyof typeof sections) => sections[section].filter((i) => entries[i.id] === 'ok').length;
  const total = data?.checklist.length ?? 0;
  const allDone = Object.values(entries).filter((v) => v === 'ok').length;
  const readiness = total ? Math.round((allDone / total) * 100) : 0;
  const submitted = data?.log?.status === 'submitted';
  const locked = submitted && !can.approve;
  const editable = (data?.log ? can.edit : can.create) && !locked;

  async function save(submit: boolean) {
    if (!siteId) return;
    setBusy(submit ? 'submit' : 'draft');
    const { error } = await supabase.rpc('save_site_ops', {
      p_site_id: siteId,
      p_date: date,
      p_shift: shift,
      p_entries: (data?.checklist ?? []).map((i) => ({
        item_id: i.id,
        status: entries[i.id] ?? 'pending',
        remarks: itemRemarks[i.id]?.trim() || null,
      })),
      p_technician_name: technician.trim() || null,
      p_member_id: memberId || null,
      p_urgency: urgency,
      p_remarks: remarks.trim() || null,
      p_submit: submit,
    });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    loadedFor.current = '';
    await qc.invalidateQueries({ queryKey: ['site-ops'] });
    await qc.invalidateQueries({ queryKey: ['site-ops-summary'] });
    toast.success(submit ? 'Register submitted for the day.' : 'Draft saved.');
  }

  if (ops.isLoading) {
    return (
      <>
        <PageHeader icon={ShieldCheck} title="Site Operations" description="Daily administration, patrol and security register." />
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  if (ops.error) {
    return (
      <>
        <PageHeader icon={ShieldCheck} title="Site Operations" />
        <Card>
          <ErrorState message={errorMessage(ops.error)} onRetry={() => ops.refetch()} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="Site Operations"
        description="The daily site register: administration work, the patrol rounds and the security check points."
        actions={
          <Badge variant={readiness === 100 ? 'success' : readiness > 0 ? 'warning' : 'secondary'}>
            {fmtNumber(readiness)}% ready
          </Badge>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Site</span>
            <FilterSelect
              value={siteId ?? ''}
              onChange={(v) => setSiteId(v)}
              options={(data?.sites ?? []).map((s) => [s.site_id, s.location ? `${s.name} — ${s.location}` : s.name] as [string, string])}
              placeholder="Select site"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Shift</span>
            <FilterSelect value={shift} onChange={(v) => setShift(v as OpsShift)} options={[['day', 'Day'], ['night', 'Night']]} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Technician</span>
            {data?.technicians.length ? (
              <FilterSelect
                value={memberId || technician}
                onChange={(v) => {
                  const m = data.technicians.find((t) => t.id === v);
                  if (m) {
                    setMemberId(m.id);
                    setTechnician(m.name);
                  }
                }}
                options={data.technicians.map((t) => [t.id, t.name] as [string, string])}
                placeholder="Select technician"
              />
            ) : (
              <Input value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="Name" disabled={!editable} />
            )}
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Urgency</span>
            <FilterSelect
              value={urgency}
              onChange={(v) => setUrgency(v as OpsUrgency)}
              options={[['normal', 'Normal'], ['urgent', 'Urgent'], ['critical', 'Critical']]}
            />
          </label>
        </CardContent>
      </Card>

      {!data?.sites.length ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="No sites assigned"
            description="Ask your administrator to assign the sites you look after to your account."
          />
        </Card>
      ) : (
        <>
          {submitted && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" />
              Submitted {data.log?.submitted_at ? fmtDate(data.log.submitted_at) : ''} · {fmtNumber(safeNum(data.log?.readiness))}% ready
              {locked && ' · ask a supervisor to reopen it to make changes'}
            </div>
          )}

          {/* ---------------------------------------- administration */}
          <Card className="mb-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Administration checklist</CardTitle>
                <CardDescription>Daily site administration work status</CardDescription>
              </div>
              <Badge variant="secondary">
                {done('administration')}/{sections.administration.length}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">S.No</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead className="hidden lg:table-cell">Frequency</TableHead>
                    <TableHead className="hidden xl:table-cell">Scope / check points</TableHead>
                    <TableHead className="hidden lg:table-cell">Responsible</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-48">Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.administration.map((item, i) => (
                    <TableRow key={item.id}>
                      <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{item.frequency}</TableCell>
                      <TableCell className="hidden max-w-xs text-sm text-muted-foreground xl:table-cell">{item.scope_points}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{item.responsible}</TableCell>
                      <TableCell>
                        <CheckToggle
                          value={entries[item.id] ?? 'pending'}
                          onChange={(v) => setEntries((p) => ({ ...p, [item.id]: v }))}
                          disabled={!editable}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={itemRemarks[item.id] ?? ''}
                          onChange={(e) => setItemRemarks((p) => ({ ...p, [item.id]: e.target.value }))}
                          disabled={!editable}
                          className="h-8"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ---------------------------------------- patrol */}
          <Card className="mb-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Patrol register</CardTitle>
                <CardDescription>Patrol area status by time</CardDescription>
              </div>
              <Badge variant="secondary">
                {done('patrol')}/{sections.patrol.length}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {sections.patrol.map((item) => (
                <div key={item.id} className="rounded-xl border p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    {item.slot}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.title}</p>
                  <div className="mt-2">
                    <CheckToggle
                      value={entries[item.id] ?? 'pending'}
                      onChange={(v) => setEntries((p) => ({ ...p, [item.id]: v }))}
                      disabled={!editable}
                      compact
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* ---------------------------------------- security */}
          <Card className="mb-6">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Daily security checklist</CardTitle>
                <CardDescription>Every point checked before the shift closes</CardDescription>
              </div>
              <Badge variant="secondary">
                {done('security')}/{sections.security.length}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sections.security.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.scope_points}</p>
                  </div>
                  <CheckToggle
                    value={entries[item.id] ?? 'pending'}
                    onChange={(v) => setEntries((p) => ({ ...p, [item.id]: v }))}
                    disabled={!editable}
                    compact
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Final remarks</CardTitle>
              <CardDescription>Anything the O&amp;M head should read with this register</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Textarea
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                disabled={!editable}
                placeholder="Observations, work done, anything left open…"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {allDone} of {total} check points marked OK · {fmtNumber(readiness)}% ready
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => save(false)} disabled={!editable || busy !== null}>
                    {busy === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save draft
                  </Button>
                  <Button onClick={() => save(true)} disabled={!editable || busy !== null}>
                    {busy === 'submit' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Submit register
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <RegisterHistory canExport={can.export} />
    </>
  );
}

// ------------------------------------------------------------------ history
function RegisterHistory({ canExport }: { canExport: boolean }) {
  const [from, setFrom] = useState(monthsAgo(13));
  const [to, setTo] = useState(todayIST());
  const summary = useOpsSummary(from, to, 'all');
  const s = summary.data;

  async function onExport() {
    if (!s?.logs.length) return;
    try {
      await exportCsv('om.operations', `site-register-${from}-to-${to}`, s.logs, [
        { header: 'Date', value: (r) => r.log_date },
        { header: 'Site', value: (r) => r.site },
        { header: 'Shift', value: (r) => r.shift },
        { header: 'Technician', value: (r) => r.technician ?? '' },
        { header: 'Urgency', value: (r) => r.urgency },
        { header: 'Status', value: (r) => r.status },
        { header: 'Administration', value: (r) => r.admin },
        { header: 'Patrol', value: (r) => r.patrol },
        { header: 'Security', value: (r) => r.security },
        { header: 'Ready %', value: (r) => safeNum(r.readiness) },
        { header: 'Open points', value: (r) => r.issues.join('; ') },
        { header: 'Remarks', value: (r) => r.remarks ?? '' },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Registers submitted" value={fmtNumber(s?.submitted)} hint={`${fmtDate(from)} – ${fmtDate(to)}`} icon={ClipboardCheck} />
        <StatCard label="Average readiness" value={`${fmtNumber(s?.avg_readiness, 1)}%`} icon={CheckCircle2} tone="green" />
        <StatCard label="Points not OK" value={fmtNumber(s?.open_points)} hint="Across the period" icon={TriangleAlert} tone="red" />
      </div>

      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Register history</CardTitle>
            <CardDescription>Every register filed for your sites</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              From
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36" />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              To
              <Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} className="h-9 w-36" />
            </label>
            {canExport && (
              <Button variant="outline" size="sm" onClick={onExport} disabled={!s?.logs.length}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!s?.logs.length ? (
            <EmptyState icon={ClipboardCheck} title="No registers in this period" description="Registers appear here as soon as they are submitted." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Technician</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Patrol</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead className="text-right">Ready</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Open points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(l.log_date)}</TableCell>
                    <TableCell className="font-medium">{l.site}</TableCell>
                    <TableCell className="capitalize">{l.shift}</TableCell>
                    <TableCell>{l.technician ?? '—'}</TableCell>
                    <TableCell className="tabular">{l.admin}</TableCell>
                    <TableCell className="tabular">{l.patrol}</TableCell>
                    <TableCell className="tabular">{l.security}</TableCell>
                    <TableCell className="tabular text-right">{fmtNumber(l.readiness, 0)}%</TableCell>
                    <TableCell>
                      <Badge variant={URGENCY[l.urgency].tone}>{URGENCY[l.urgency].label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {l.issues.length ? l.issues.join(', ') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
