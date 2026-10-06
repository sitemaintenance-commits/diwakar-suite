// Site Updates — the site engineer's Daily Progress Report (DPR), in the
// format the projects team used on WhatsApp: materials received, the
// running status of every activity, today's work, tomorrow's plan, notes,
// safety and photos. Filed here for any site; heads read every site's DPRs
// by date, open one as the familiar report, copy it for WhatsApp or print
// it. The same form and list sit on each project's page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Camera, ClipboardCheck, Copy, Download, Loader2, Plus, Printer, Send, Trash2,
} from 'lucide-react';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, Field, PageHeader, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { downloadDocument, uploadDocument, useDocuments } from '@/features/crm/api';
import type { DocumentRow } from '@/lib/types';
import type { WorkStatus } from '@/features/projects/api';
import { stageOf, WORK, WORK_FRONTS, type WorkFront } from '@/features/projects/shared';

export interface DprActivity {
  name: string;
  status: WorkStatus;
  done?: number | string | null;
  total?: number | string | null;
  unit?: string | null;
  note?: string | null;
}

export type SiteUpdate = Record<WorkFront, WorkStatus> & {
  id: string;
  project_id: string;
  project: string;
  update_date: string;
  engineer_name: string | null;
  work_description: string | null;
  challenges: string | null;
  remarks: string | null;
  materials_received: boolean | null;
  materials_items: string | null;
  activities: DprActivity[] | null;
  tomorrow_plan: string | null;
  safety_followed: boolean | null;
  safety_note: string | null;
  photos: number;
};

interface SiteUpdateList {
  can_file: boolean;
  can_edit: boolean;
  activity_template: { name: string; unit?: string }[];
  projects: { id: string; name: string; stage: string; capacity_kwp: number; site: string | null }[];
  missing_today: { id: string; name: string }[];
  rows: SiteUpdate[];
}

const ALL = '__all__';
const SINCE_EVER = '2000-01-01';
const MAX_PHOTO = 25 * 1024 * 1024;
const WORK_OPTIONS = (Object.keys(WORK) as WorkStatus[]).map((k) => [k, WORK[k].label] as [string, string]);
const YES_NO: [string, string][] = [['', '—'], ['yes', 'Yes'], ['no', 'No']];
const BLANK_FRONTS = Object.fromEntries(WORK_FRONTS.map(([k]) => [k, 'not_started'])) as Record<WorkFront, WorkStatus>;

function daysBefore(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}
const yn = (b: boolean | null | undefined) => (b == null ? '' : b ? 'yes' : 'no');
const fromYn = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);
const lines = (s: string | null | undefined) => (s ?? '').split('\n').map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

/** "Completed", "936/5292 Nos", "In progress (trench pending)". */
export function activityStatus(a: DprActivity) {
  const qty = a.total != null && a.total !== '' ? `${fmtNumber(a.done ?? 0)}/${fmtNumber(a.total)}${a.unit ? ` ${a.unit}` : ''}` : null;
  const label = (WORK[a.status] ?? WORK.not_started).label;
  const head = qty && a.status !== 'completed' ? qty : qty ? `${label} · ${qty}` : label;
  return a.note ? `${head} (${a.note})` : head;
}

/** The DPR as the team's WhatsApp text. */
export function dprText(u: SiteUpdate) {
  const out: string[] = [];
  out.push(`DPR:– ${u.project}`);
  out.push(`🗓️ Date: [${fmtDate(u.update_date)}]`);
  out.push('');
  out.push(`1️⃣ Materials Received Today - ${u.materials_received == null ? '—' : u.materials_received ? 'Yes' : 'No'}`);
  if (u.materials_items) out.push(`(Item – ${u.materials_items})`);
  out.push('');
  out.push('2️⃣ Running Work Status...');
  (u.activities ?? []).forEach((a, i) => out.push(`${i + 1}. ${a.name} :- ${activityStatus(a)}`));
  out.push('');
  out.push('*Today Work*');
  lines(u.work_description).forEach((l, i) => out.push(`${i + 1}. ${l}`));
  out.push('');
  out.push('*Tomorrow Work Plan*');
  lines(u.tomorrow_plan).forEach((l, i) => out.push(`${i + 1}. ${l}`));
  out.push('');
  out.push(`5️⃣ General Notes / Observations.... ${u.remarks ?? ''}`.trimEnd());
  if (u.challenges) out.push(`Challenges: ${u.challenges}`);
  out.push('');
  out.push(`6️⃣ Safety rules is followed by team... ${u.safety_followed == null ? '—' : u.safety_followed ? 'Yes' : 'No'}${u.safety_note ? ` (${u.safety_note})` : ''}`);
  out.push('');
  out.push(`📸 Photos Attached:- ${u.photos ? `Yes (${u.photos})` : 'No'}`);
  if (u.engineer_name) out.push(`— ${u.engineer_name}`);
  return out.join('\n');
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
/** File (or correct) one day's DPR. With no projectId, the site is picked. */
export function SiteUpdateForm({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const { access } = useAccess();
  const photoRef = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState(projectId ?? '');
  const [date, setDate] = useState(todayIST());
  const [fronts, setFronts] = useState<Record<WorkFront, WorkStatus>>({ ...BLANK_FRONTS });
  const [engineer, setEngineer] = useState('');
  const [materialsReceived, setMaterialsReceived] = useState('');
  const [materialsItems, setMaterialsItems] = useState('');
  const [activities, setActivities] = useState<DprActivity[]>([]);
  const [work, setWork] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [notes, setNotes] = useState('');
  const [challenges, setChallenges] = useState('');
  const [safety, setSafety] = useState('');
  const [safetyNote, setSafetyNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  // The chosen site's DPR for the chosen day, and its last one before it.
  const day = useSiteUpdates(date, date, project || null);
  const before = useSiteUpdates(daysBefore(date, 90), daysBefore(date, 1), project || null);
  const filed = project ? day.data?.rows.find((r) => r.project_id === project) ?? null : null;
  const previous = project ? before.data?.rows.find((r) => r.project_id === project) ?? null : null;
  const projects = day.data?.projects ?? [];
  const locked = Boolean(filed) && day.data?.can_edit === false;
  const ready = day.isFetched && (!project || before.isFetched);

  // Load once per site and date, so typing is never overwritten. A new DPR
  // starts from the site's previous one: the running status carries over.
  const loadKey = `${project}|${date}|${filed?.id ?? ''}|${previous?.id ?? ''}|${ready}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    if (!ready || loadKey === loadedKey) return;
    setLoadedKey(loadKey);
    const base = filed ?? previous;
    setFronts(base ? Object.fromEntries(WORK_FRONTS.map(([k]) => [k, base[k]])) as Record<WorkFront, WorkStatus> : { ...BLANK_FRONTS });
    const startList = (base?.activities?.length ? base.activities : (day.data?.activity_template ?? []).map((t) => ({ name: t.name, unit: t.unit, status: 'not_started' as WorkStatus })));
    setActivities(startList.map((a) => ({ ...a, status: (a as DprActivity).status ?? 'not_started' })));
    setEngineer(filed?.engineer_name ?? access?.profile?.full_name ?? '');
    setMaterialsReceived(yn(filed?.materials_received));
    setMaterialsItems(filed?.materials_items ?? '');
    setWork(filed?.work_description ?? '');
    setTomorrow(filed?.tomorrow_plan ?? '');
    setNotes(filed?.remarks ?? '');
    setChallenges(filed?.challenges ?? '');
    setSafety(yn(filed?.safety_followed));
    setSafetyNote(filed?.safety_note ?? '');
    setPhotos([]);
  }, [loadKey, loadedKey, ready, filed, previous, day.data?.activity_template, access?.profile?.full_name]);

  const setActivity = (i: number, patch: Partial<DprActivity>) =>
    setActivities((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  async function save() {
    if (!project) return toast.error('Choose the site.');
    if (!work.trim()) return toast.error("Write today's work.");
    if (materialsReceived === '') return toast.error('Say whether materials were received today.');
    if (safety === '') return toast.error('Say whether the safety rules were followed.');
    setBusy(true);
    try {
      const { data: id, error } = await supabase.rpc('save_project_update', {
        p_project_id: project,
        p_date: date,
        p_stages: fronts,
        p_work_description: work.trim() || null,
        p_challenges: challenges.trim() || null,
        p_remarks: notes.trim() || null,
        p_engineer_name: engineer.trim() || null,
        p_dpr: {
          materials_received: fromYn(materialsReceived),
          materials_items: materialsReceived === 'yes' ? materialsItems : '',
          activities,
          tomorrow_plan: tomorrow,
          safety_followed: fromYn(safety),
          safety_note: safetyNote,
        },
      });
      if (error) throw error;
      for (const file of photos) {
        await uploadDocument({ moduleKey: 'projects.updates', entityType: 'project_update', entityId: id as string, file, category: 'DPR photo' });
      }
      await qc.invalidateQueries({ queryKey: ['site_updates'] });
      await qc.invalidateQueries({ queryKey: ['project', project] });
      setPhotos([]);
      if (photoRef.current) photoRef.current.value = '';
      toast.success(filed ? 'DPR corrected.' : 'DPR filed.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Daily Progress Report (DPR)</CardTitle>
        <CardDescription>
          {filed
            ? `Already filed for ${fmtDate(date)}${locked ? ' — only a project manager can change it.' : ' — saving corrects it.'}`
            : previous ? `Running status carried over from ${fmtDate(previous.update_date)} — update what changed.` : 'One report per site per day.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-6">
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

        <Section n="1" title="Materials received today">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Received?" required>
              <FilterSelect value={materialsReceived} onChange={setMaterialsReceived} options={YES_NO} />
            </Field>
            {materialsReceived === 'yes' && (
              <Field label="Items" className="sm:col-span-3" hint="Item and quantity, e.g. Solar module – 620 Nos, DC cable – 2 drums">
                <Textarea rows={2} value={materialsItems} onChange={(e) => setMaterialsItems(e.target.value)} />
              </Field>
            )}
          </div>
        </Section>

        <Section n="2" title="Running work status">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="min-w-[14rem]">Activity</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead className="w-24">Done</TableHead>
                  <TableHead className="w-24">Total</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="min-w-[12rem]">Note</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="tabular text-muted-foreground">{i + 1}</TableCell>
                    <TableCell><Input className="h-8 w-full min-w-[14rem]" value={a.name} onChange={(e) => setActivity(i, { name: e.target.value })} /></TableCell>
                    <TableCell><FilterSelect value={a.status} onChange={(v) => setActivity(i, { status: v as WorkStatus })} options={WORK_OPTIONS} /></TableCell>
                    <TableCell><Input className="h-8 w-20" inputMode="decimal" value={a.done ?? ''} onChange={(e) => setActivity(i, { done: e.target.value })} /></TableCell>
                    <TableCell><Input className="h-8 w-20" inputMode="decimal" value={a.total ?? ''} onChange={(e) => setActivity(i, { total: e.target.value })} /></TableCell>
                    <TableCell><Input className="h-8 w-20" value={a.unit ?? ''} onChange={(e) => setActivity(i, { unit: e.target.value })} placeholder="Nos" /></TableCell>
                    <TableCell><Input className="h-8 w-full min-w-[12rem]" value={a.note ?? ''} onChange={(e) => setActivity(i, { note: e.target.value })} placeholder="e.g. trench pending 5 inverters" /></TableCell>
                    <TableCell>
                      <Button size="icon-sm" variant="ghost" aria-label="Remove activity" onClick={() => setActivities((l) => l.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-2 flex justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setActivities((l) => [...l, { name: '', status: 'not_started' }])}><Plus /> Add activity</Button>
            <span className="self-center text-xs text-muted-foreground">Quantities like 936/5292 Nos: fill Done and Total.</span>
          </div>
          <details className="mt-3 rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Work fronts (quick status)</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {WORK_FRONTS.map(([key, label]) => (
                <Field key={key} label={label}>
                  <FilterSelect value={fronts[key]} onChange={(v) => setFronts((f) => ({ ...f, [key]: v as WorkStatus }))} options={WORK_OPTIONS} />
                </Field>
              ))}
            </div>
          </details>
        </Section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section n="3" title="Today's work">
            <Textarea rows={5} value={work} onChange={(e) => setWork(e.target.value)} placeholder={'One item per line\nPurlin installation work\nPrecast wire fencing'} />
          </Section>
          <Section n="4" title="Tomorrow's work plan">
            <Textarea rows={5} value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} placeholder={'One item per line\nModule installation\nOuter earthing'} />
          </Section>
        </div>

        <Section n="5" title="General notes / observations">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
            <Textarea rows={2} value={challenges} onChange={(e) => setChallenges(e.target.value)} placeholder="Challenges / hold-ups (rain, approvals, material)" />
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section n="6" title="Safety rules followed by the team?">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FilterSelect value={safety} onChange={setSafety} options={YES_NO} />
              <Input className="sm:col-span-2" value={safetyNote} onChange={(e) => setSafetyNote(e.target.value)} placeholder="e.g. PPE not available" />
            </div>
          </Section>
          <Section n="📸" title="Photos">
            <input ref={photoRef} type="file" accept="image/*" multiple capture="environment"
              className="text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                const big = picked.filter((x) => x.size > MAX_PHOTO);
                if (big.length) toast.error(`Larger than 25 MB: ${big.map((x) => x.name).join(', ')}`);
                setPhotos(picked.filter((x) => x.size <= MAX_PHOTO));
              }} />
            <p className="mt-1 text-xs text-muted-foreground">
              {photos.length ? `${photos.length} photo(s) will be attached` : filed?.photos ? `${filed.photos} photo(s) attached — add more if needed` : 'Site photos from the phone camera or gallery.'}
            </p>
          </Section>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={busy || locked || (!projectId && !project)}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {filed ? 'Save correction' : 'File DPR'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-soft px-1.5 text-xs text-primary">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

// ----------------------------------------------------------- the report
function DprDialog({ dpr, onClose }: { dpr: SiteUpdate | null; onClose: () => void }) {
  const docs = useDocuments('project_update', dpr?.id);
  if (!dpr) return null;
  const text = dprText(dpr);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>DPR – {dpr.project}</DialogTitle>
          <DialogDescription>{fmtDate(dpr.update_date)}{dpr.engineer_name ? ` · ${dpr.engineer_name}` : ''}</DialogDescription>
        </DialogHeader>
        <DprView dpr={dpr} />
        {docs.data && docs.data.length > 0 && <PhotoStrip docs={docs.data} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Copied — paste it in WhatsApp.'), () => toast.error('Could not copy.'))}>
            <Copy /> Copy for WhatsApp
          </Button>
          <Button onClick={() => printDpr([dpr])}><Printer /> Print / PDF</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DprView({ dpr }: { dpr: SiteUpdate }) {
  const block = (title: string, body: React.ReactNode) => (
    <div className="rounded-lg border p-3">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {body}
    </div>
  );
  const list = (s: string | null) => lines(s).length
    ? <ol className="list-decimal space-y-0.5 pl-5 text-sm">{lines(s).map((l, i) => <li key={i}>{l}</li>)}</ol>
    : <p className="text-sm text-muted-foreground">—</p>;
  return (
    <div className="grid gap-3">
      {block('1 · Materials received today', (
        <p className="text-sm">{dpr.materials_received == null ? '—' : dpr.materials_received ? 'Yes' : 'No'}{dpr.materials_items ? ` — ${dpr.materials_items}` : ''}</p>
      ))}
      {block('2 · Running work status', dpr.activities?.length ? (
        <ol className="grid gap-1 text-sm">
          {dpr.activities.map((a, i) => (
            <li key={i} className="flex items-start justify-between gap-3 border-b pb-1 last:border-0">
              <span>{i + 1}. {a.name}</span>
              <Badge variant={(WORK[a.status] ?? WORK.not_started).tone} className="shrink-0 whitespace-normal text-right">{activityStatus(a)}</Badge>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted-foreground">—</p>)}
      <div className="grid gap-3 sm:grid-cols-2">
        {block("3 · Today's work", list(dpr.work_description))}
        {block("4 · Tomorrow's plan", list(dpr.tomorrow_plan))}
      </div>
      {block('5 · General notes / observations', (
        <div className="text-sm">
          <p className="whitespace-pre-line">{dpr.remarks ?? '—'}</p>
          {dpr.challenges && <p className="mt-1 whitespace-pre-line text-amber-700">Challenges: {dpr.challenges}</p>}
        </div>
      ))}
      {block('6 · Safety rules followed', (
        <p className={`text-sm ${dpr.safety_followed === false ? 'font-medium text-destructive' : ''}`}>
          {dpr.safety_followed == null ? '—' : dpr.safety_followed ? 'Yes' : 'No'}{dpr.safety_note ? ` — ${dpr.safety_note}` : ''}
        </p>
      ))}
    </div>
  );
}

function PhotoStrip({ docs }: { docs: DocumentRow[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const d of docs) {
        const { data } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, 600);
        if (data?.signedUrl) out[d.id] = data.signedUrl;
      }
      if (live) setUrls(out);
    })();
    return () => { live = false; };
  }, [docs]);
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">📸 Photos ({docs.length})</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {docs.map((d) => (
          <button key={d.id} type="button" onClick={() => void downloadDocument(d).catch((e) => toast.error(errorMessage(e)))}
            className="aspect-square overflow-hidden rounded-lg border bg-muted" title={d.file_name}>
            {urls[d.id] && (d.mime_type ?? '').startsWith('image/')
              ? <img src={urls[d.id]} alt={d.file_name} className="h-full w-full object-cover" />
              : <span className="p-1 text-xs">{d.file_name}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** One or more DPRs, print-ready in a new tab (Save as PDF from the dialog). */
function printDpr(dprs: SiteUpdate[]) {
  const w = window.open('', '_blank');
  if (!w) return toast.error('Allow pop-ups for this site to print.');
  const body = dprs.map((u) => {
    const li = (s: string | null) => lines(s).map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted">—</li>';
    return `<section>
      <h2>DPR – ${esc(u.project)} <span>${esc(fmtDate(u.update_date))}${u.engineer_name ? ` · ${esc(u.engineer_name)}` : ''}</span></h2>
      <h3>1. Materials received today</h3><p>${u.materials_received == null ? '—' : u.materials_received ? 'Yes' : 'No'}${u.materials_items ? ` — ${esc(u.materials_items)}` : ''}</p>
      <h3>2. Running work status</h3>
      <table>${(u.activities ?? []).map((a, i) => `<tr><td>${i + 1}. ${esc(a.name)}</td><td>${esc(activityStatus(a))}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table>
      <div class="two"><div><h3>3. Today's work</h3><ol>${li(u.work_description)}</ol></div><div><h3>4. Tomorrow's plan</h3><ol>${li(u.tomorrow_plan)}</ol></div></div>
      <h3>5. General notes / observations</h3><p>${esc(u.remarks ?? '—')}${u.challenges ? `<br>Challenges: ${esc(u.challenges)}` : ''}</p>
      <h3>6. Safety rules followed</h3><p class="${u.safety_followed === false ? 'bad' : ''}">${u.safety_followed == null ? '—' : u.safety_followed ? 'Yes' : 'No'}${u.safety_note ? ` — ${esc(u.safety_note)}` : ''}</p>
      <p class="muted">Photos attached: ${u.photos ? `Yes (${u.photos})` : 'No'}</p>
    </section>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>DPR</title><style>
    body{font:12px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;margin:24px}
    section{border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:14px;break-inside:avoid}
    h2{font-size:15px;margin:0 0 8px;border-bottom:2px solid #ea580c;padding-bottom:6px}h2 span{float:right;font-weight:500;color:#475569;font-size:12px}
    h3{font-size:11px;color:#475569;margin:10px 0 3px;text-transform:uppercase}p,ol{margin:0}ol{padding-left:18px}
    table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #f1f5f9;padding:2px 0}td+td{text-align:right}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.muted{color:#64748b}.bad{color:#b91c1c;font-weight:600}
    @media print{body{margin:0}@page{margin:12mm}}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ----------------------------------------------------------------- table
export function SiteUpdatesTable({ rows, showProject }: { rows: SiteUpdate[]; showProject?: boolean }) {
  const [open, setOpen] = useState<SiteUpdate | null>(null);
  if (!rows.length) {
    return <EmptyState icon={ClipboardCheck} title="No DPRs" description="The day's report appears here once it is filed." />;
  }
  const safetyBadge = (b: boolean | null) =>
    b == null ? <span className="text-muted-foreground">—</span> : <Badge variant={b ? 'success' : 'destructive'}>{b ? 'Yes' : 'No'}</Badge>;
  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {showProject && <TableHead>Site</TableHead>}
              <TableHead>Engineer</TableHead>
              <TableHead>Today's work</TableHead>
              <TableHead>Tomorrow's plan</TableHead>
              <TableHead>Materials</TableHead>
              <TableHead>Safety</TableHead>
              <TableHead className="text-right">Photos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(u)}>
                <TableCell className="whitespace-nowrap">{fmtDate(u.update_date)}</TableCell>
                {showProject && <TableCell className="whitespace-nowrap font-medium">{u.project}</TableCell>}
                <TableCell className="whitespace-nowrap text-sm">{u.engineer_name ?? '—'}</TableCell>
                <TableCell className="min-w-[16rem] max-w-[24rem] text-sm"><span className="line-clamp-3 whitespace-pre-line">{u.work_description ?? '—'}</span></TableCell>
                <TableCell className="min-w-[12rem] max-w-[18rem] text-sm text-muted-foreground"><span className="line-clamp-3 whitespace-pre-line">{u.tomorrow_plan ?? '—'}</span></TableCell>
                <TableCell className="text-sm">{u.materials_received == null ? '—' : u.materials_received ? 'Yes' : 'No'}</TableCell>
                <TableCell>{safetyBadge(u.safety_followed)}</TableCell>
                <TableCell className="tabular text-right">{u.photos ? <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{u.photos}</span> : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DprDialog dpr={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** The project page's tab: this project's form and every DPR it has. */
export function ProjectSiteUpdates({ projectId, canFile }: { projectId: string; canFile: boolean }) {
  const list = useSiteUpdates(SINCE_EVER, todayIST(), projectId);
  return (
    <>
      {canFile && <SiteUpdateForm projectId={projectId} />}
      <Card>
        <CardHeader>
          <CardTitle>DPR history</CardTitle>
          <CardDescription>{fmtNumber(list.data?.rows.length)} day(s) recorded · click a day to open its report</CardDescription>
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
  const [from, setFrom] = useState(daysBefore(todayIST(), 30));
  const [to, setTo] = useState(todayIST());
  const [site, setSite] = useState(ALL);
  const list = useSiteUpdates(from, to, site === ALL ? null : site);
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const missing = list.data?.missing_today ?? [];

  async function onExport() {
    try {
      await exportXlsx('projects.updates', `dpr-${from}-to-${to}`, rows, [
        { header: 'Date', value: (r) => fmtDate(r.update_date), width: 12 },
        { header: 'Site', value: (r) => r.project, width: 24 },
        { header: 'Engineer', value: (r) => r.engineer_name ?? '', width: 18 },
        { header: 'Materials received', value: (r) => (r.materials_received == null ? '' : r.materials_received ? 'Yes' : 'No'), width: 10 },
        { header: 'Material items', value: (r) => r.materials_items ?? '', width: 30 },
        { header: 'Running work status', value: (r) => (r.activities ?? []).map((a, i) => `${i + 1}. ${a.name} :- ${activityStatus(a)}`).join('\n'), width: 60 },
        { header: "Today's work", value: (r) => r.work_description ?? '', width: 50 },
        { header: "Tomorrow's plan", value: (r) => r.tomorrow_plan ?? '', width: 40 },
        { header: 'Notes', value: (r) => r.remarks ?? '', width: 30 },
        { header: 'Challenges', value: (r) => r.challenges ?? '', width: 30 },
        { header: 'Safety followed', value: (r) => (r.safety_followed == null ? '' : r.safety_followed ? 'Yes' : 'No'), width: 10 },
        { header: 'Safety note', value: (r) => r.safety_note ?? '', width: 24 },
        { header: 'Photos', value: (r) => r.photos, width: 8 },
        ...WORK_FRONTS.map(([k, l]) => ({ header: l, value: (r: SiteUpdate) => (WORK[r[k]] ?? WORK.not_started).label, width: 14 })),
      ], { sheet: 'DPR', title: ['DAILY PROGRESS REPORTS', `${fmtDate(from)} to ${fmtDate(to)}`] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title="Site Updates (DPR)"
        description="The site engineer's Daily Progress Report for each project site — filled here, read and printed by the head."
        actions={
          <>
            <Button variant="outline" onClick={() => printDpr(rows)} disabled={!rows.length}><Printer /> Print all</Button>
            <Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export</Button>
          </>
        }
      />

      {missing.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-medium">No DPR yet today:</span>
          {missing.map((m) => <Badge key={m.id} variant="warning">{m.name}</Badge>)}
        </div>
      )}

      {list.data?.can_file && <SiteUpdateForm />}

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || daysBefore(todayIST(), 30))} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value || todayIST())} /></Field>
          <div className="sm:w-64">
            <Field label="Site">
              <FilterSelect value={site} onChange={setSite}
                options={[[ALL, 'All sites'], ...(list.data?.projects ?? []).map((p) => [p.id, p.name] as [string, string])]} />
            </Field>
          </div>
          <Button variant="ghost" onClick={() => { setFrom(SINCE_EVER); setTo(todayIST()); }}>All time</Button>
          <span className="text-sm text-muted-foreground sm:ml-auto">{fmtNumber(rows.length)} report(s) · click one to open it</span>
        </div>
        {list.isLoading ? <TableSkeleton cols={6} /> : list.error
          ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
          : <SiteUpdatesTable rows={rows} showProject />}
      </Card>
    </>
  );
}
