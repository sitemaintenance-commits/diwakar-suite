// Site Updates — the site engineer's day-wise update, which the old Project
// CRM collected with a Google Form: where each work front stands, the work
// done and the challenges. Filed here for any site, and read across sites
// by date; the same form and table sit on each project's page.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, Download, Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber, todayIST } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { useAccess } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, Field, PageHeader, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import type { WorkStatus } from '@/features/projects/api';
import { stageOf, WORK, WORK_FRONTS, type WorkFront } from '@/features/projects/shared';

export type SiteUpdate = Record<WorkFront, WorkStatus> & {
  id: string;
  project_id: string;
  project: string;
  update_date: string;
  engineer_name: string | null;
  work_description: string | null;
  challenges: string | null;
  remarks: string | null;
};

interface SiteUpdateList {
  can_file: boolean;
  can_edit: boolean;
  projects: { id: string; name: string; stage: string; capacity_kwp: number; site: string | null }[];
  rows: SiteUpdate[];
}

const ALL = '__all__';
const SINCE_EVER = '2000-01-01';
const WORK_OPTIONS = (Object.keys(WORK) as WorkStatus[]).map((k) => [k, WORK[k].label] as [string, string]);
const BLANK_FRONTS = Object.fromEntries(WORK_FRONTS.map(([k]) => [k, 'not_started'])) as Record<WorkFront, WorkStatus>;

function daysAgo(n: number) {
  const d = new Date(`${todayIST()}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

export function useSiteUpdates(from: string, to: string, project: string | null) {
  return useQuery({
    queryKey: ['site_updates', from, to, project ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_site_updates', { p_from: from, p_to: to, p_project: project });
      if (error) throw error;
      return data as SiteUpdateList;
    },
  });
}

// ------------------------------------------------------------------ form
/** File (or correct) one day's update. With no projectId, the site is picked. */
export function SiteUpdateForm({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const { access } = useAccess();
  const [project, setProject] = useState(projectId ?? '');
  const [date, setDate] = useState(todayIST());
  const [fronts, setFronts] = useState<Record<WorkFront, WorkStatus>>({ ...BLANK_FRONTS });
  const [engineer, setEngineer] = useState('');
  const [work, setWork] = useState('');
  const [challenges, setChallenges] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  // The chosen site's update for the chosen day, if one is filed already.
  const day = useSiteUpdates(date, date, project || null);
  const filed = project ? day.data?.rows.find((r) => r.project_id === project) ?? null : null;
  const projects = day.data?.projects ?? [];
  const locked = Boolean(filed) && day.data?.can_edit === false;

  // Load the day's update once per site and date, so typing is never overwritten.
  const loadKey = `${project}|${date}|${filed?.id ?? ''}|${day.isFetched}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    if (!day.isFetched || loadKey === loadedKey) return;
    setLoadedKey(loadKey);
    setFronts(filed ? Object.fromEntries(WORK_FRONTS.map(([k]) => [k, filed[k]])) as Record<WorkFront, WorkStatus> : { ...BLANK_FRONTS });
    setEngineer(filed?.engineer_name ?? access?.profile?.full_name ?? '');
    setWork(filed?.work_description ?? '');
    setChallenges(filed?.challenges ?? '');
    setRemarks(filed?.remarks ?? '');
  }, [loadKey, loadedKey, day.isFetched, filed, access?.profile?.full_name]);

  async function save() {
    if (!project) return toast.error('Choose the site.');
    if (!work.trim()) return toast.error('Write the work done today.');
    setBusy(true);
    const { error } = await supabase.rpc('save_project_update', {
      p_project_id: project,
      p_date: date,
      p_stages: fronts,
      p_work_description: work.trim() || null,
      p_challenges: challenges.trim() || null,
      p_remarks: remarks.trim() || null,
      p_engineer_name: engineer.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['site_updates'] });
    await qc.invalidateQueries({ queryKey: ['project_updates'] });
    await qc.invalidateQueries({ queryKey: ['project', project] });
    toast.success(filed ? 'Site update corrected.' : 'Site update filed.');
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Day-wise site update</CardTitle>
        <CardDescription>
          {filed ? `Already filed for ${fmtDate(date)}${locked ? ' — only a project manager can change it.' : ' — saving corrects it.'}` : 'Where each work front stands today'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!projectId && (
            <Field label="Site" required className="lg:col-span-2">
              <FilterSelect value={project} onChange={setProject} placeholder="Choose the site"
                options={projects.map((p) => [p.id, `${p.name} · ${stageOf(p.stage).label}`] as [string, string])} />
            </Field>
          )}
          <Field label="Date">
            <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
          </Field>
          <Field label="Site engineer">
            <Input value={engineer} onChange={(e) => setEngineer(e.target.value)} placeholder="Name" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {WORK_FRONTS.map(([key, label]) => (
            <Field key={key} label={label}>
              <FilterSelect value={fronts[key]} onChange={(v) => setFronts((f) => ({ ...f, [key]: v as WorkStatus }))} options={WORK_OPTIONS} />
            </Field>
          ))}
        </div>
        <Field label="Work description" required>
          <Textarea rows={3} value={work} onChange={(e) => setWork(e.target.value)} placeholder="What was done at site today" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Challenges">
            <Textarea rows={2} value={challenges} onChange={(e) => setChallenges(e.target.value)} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy || locked || (!projectId && !project)}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {filed ? 'Save correction' : 'File update'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- table
export function SiteUpdatesTable({ rows, showProject }: { rows: SiteUpdate[]; showProject?: boolean }) {
  if (!rows.length) {
    return <EmptyState icon={ClipboardCheck} title="No site updates" description="The day's update appears here once it is filed." />;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            {showProject && <TableHead>Site</TableHead>}
            <TableHead>Engineer</TableHead>
            {WORK_FRONTS.map(([k, l]) => <TableHead key={k} className="whitespace-nowrap">{l}</TableHead>)}
            <TableHead>Work description</TableHead>
            <TableHead>Challenges</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="whitespace-nowrap">{fmtDate(u.update_date)}</TableCell>
              {showProject && <TableCell className="whitespace-nowrap font-medium">{u.project}</TableCell>}
              <TableCell className="whitespace-nowrap text-sm">{u.engineer_name ?? '—'}</TableCell>
              {WORK_FRONTS.map(([k]) => {
                const w = WORK[u[k]] ?? WORK.not_started;
                return <TableCell key={k}><Badge variant={w.tone}>{w.label}</Badge></TableCell>;
              })}
              <TableCell className="min-w-[16rem] whitespace-pre-line text-sm">{u.work_description ?? '—'}</TableCell>
              <TableCell className="min-w-[12rem] whitespace-pre-line text-sm text-muted-foreground">{u.challenges ?? '—'}</TableCell>
              <TableCell className="min-w-[10rem] whitespace-pre-line text-sm text-muted-foreground">{u.remarks ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The project page's tab: this project's form and every update it has. */
export function ProjectSiteUpdates({ projectId, canFile }: { projectId: string; canFile: boolean }) {
  const list = useSiteUpdates(SINCE_EVER, todayIST(), projectId);
  return (
    <>
      {canFile && <SiteUpdateForm projectId={projectId} />}
      <Card>
        <CardHeader>
          <CardTitle>Update history</CardTitle>
          <CardDescription>{fmtNumber(list.data?.rows.length)} day(s) recorded</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {list.isLoading ? <TableSkeleton cols={6} /> : list.error
            ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
            : <SiteUpdatesTable rows={list.data?.rows ?? []} />}
        </CardContent>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ page
export function SiteUpdatesPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayIST());
  const [site, setSite] = useState(ALL);
  const list = useSiteUpdates(from, to, site === ALL ? null : site);
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);

  async function onExport() {
    try {
      await exportXlsx('projects.updates', `site-updates-${from}-to-${to}`, rows, [
        { header: 'Date', value: (r) => fmtDate(r.update_date), width: 12 },
        { header: 'Site', value: (r) => r.project, width: 24 },
        { header: 'Engineer', value: (r) => r.engineer_name ?? '', width: 18 },
        ...WORK_FRONTS.map(([k, l]) => ({ header: l, value: (r: SiteUpdate) => (WORK[r[k]] ?? WORK.not_started).label, width: 14 })),
        { header: 'Work description', value: (r) => r.work_description ?? '', width: 50 },
        { header: 'Challenges', value: (r) => r.challenges ?? '', width: 30 },
        { header: 'Remarks', value: (r) => r.remarks ?? '', width: 30 },
      ], { sheet: 'Site updates', title: ['DAY-WISE SITE UPDATES', `${fmtDate(from)} to ${fmtDate(to)}`] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title="Site Updates"
        description="The site engineer's day-wise update for each project site — work fronts, work done and challenges."
        actions={<Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export</Button>}
      />

      {list.data?.can_file && <SiteUpdateForm />}

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || daysAgo(30))} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value || todayIST())} /></Field>
          <div className="sm:w-64">
            <Field label="Site">
              <FilterSelect value={site} onChange={setSite}
                options={[[ALL, 'All sites'], ...(list.data?.projects ?? []).map((p) => [p.id, p.name] as [string, string])]} />
            </Field>
          </div>
          <Button variant="ghost" onClick={() => { setFrom(SINCE_EVER); setTo(todayIST()); }}>All time</Button>
          <span className="text-sm text-muted-foreground sm:ml-auto">{fmtNumber(rows.length)} update(s)</span>
        </div>
        {list.isLoading ? <TableSkeleton cols={6} /> : list.error
          ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
          : <SiteUpdatesTable rows={rows} showProject />}
      </Card>
    </>
  );
}
