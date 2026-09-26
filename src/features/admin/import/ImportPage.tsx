// Data Import — the one-time move of the four legacy applications'
// history into the suite.
//
// Every importer is idempotent: a record that is already here is left
// alone. "Check first" runs the same code with p_dry_run, so you can see
// what would land before anything is written.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Blocks, ClipboardCheck, FileUp, Loader2, Play, Search, Sun } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtNumber } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common';

/** A small CSV reader: quoted fields, embedded commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** "7/29/2026" or "2026-07-29" → "2026-07-29". */
function toIsoDate(value: string): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m) return null;
  const [, a, b, y] = m;
  return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
}

/** The PMS form sheet → the rows import_work_logs expects. */
function parsePmsCsv(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('That does not look like a CSV export.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const at = (name: string) => head.indexOf(name.toLowerCase());
  const iEmp = at('Employee Name');
  const iDate = at('Date');
  if (iEmp < 0) throw new Error('No "Employee Name" column — is this the daily working sheet export?');
  const iPost = at('Post');
  const iDept = at('Department');
  const iPriority = at('Priority');
  const iRemarks = at('Remarks');
  const iStamp = at('Timestamp');

  return rows.slice(1).map((r) => {
    const tasks: { description: string; status: string }[] = [];
    for (let n = 1; n <= 10; n++) {
      const d = at(`Task ${n}`);
      const st = at(`Task ${n} Status`);
      const description = d >= 0 ? (r[d] ?? '').trim() : '';
      if (description) tasks.push({ description, status: st >= 0 ? (r[st] ?? '').trim() : '' });
    }
    return {
      employee: (r[iEmp] ?? '').trim(),
      post: iPost >= 0 ? (r[iPost] ?? '').trim() : '',
      department: iDept >= 0 ? (r[iDept] ?? '').trim() : '',
      date: toIsoDate(iDate >= 0 ? r[iDate] : '') ?? toIsoDate(iStamp >= 0 ? r[iStamp] : ''),
      priority: iPriority >= 0 ? (r[iPriority] ?? '').trim() : '',
      remarks: iRemarks >= 0 ? (r[iRemarks] ?? '').trim() : '',
      tasks,
    };
  }).filter((x) => x.employee && x.date);
}

interface Result {
  inserted?: number;
  skipped?: number;
  ignored?: number;
  employees_created?: number;
  unknown_sites?: string[];
  unknown_departments?: string[];
  unknown_employees?: string[];
  from?: string;
  to?: string;
  dry_run?: boolean;
}

interface Source {
  key: string;
  title: string;
  icon: typeof Sun;
  rpc: string;
  arg: string;
  description: string;
  where: string;
  accept: string;
  /** Turn what was pasted or uploaded into the RPC payload. */
  prepare: (raw: string) => unknown;
}

const SOURCES: Source[] = [
  {
    key: 'om',
    title: 'O&M generation history',
    icon: Sun,
    rpc: 'import_om_generation',
    arg: 'p_payload',
    description: 'Daily generation, insolation, grid outage and remarks for every site.',
    where:
      'In the O&M CRM, press "Export JSON" on the Dashboard tab and paste the file here. ' +
      'The browser key solar-crm-v2 holds the same thing.',
    accept: '.json',
    prepare: (raw) => JSON.parse(raw),
  },
  {
    key: 'daily',
    title: 'Daily Review reports',
    icon: ClipboardCheck,
    rpc: 'import_daily_reports',
    arg: 'p_payload',
    description: 'Department reports with their metrics, highlights and blockers.',
    where:
      'Open the old Daily Review CRM, choose Settings → Export backup, then upload the downloaded JSON file here.',
    accept: '.json',
    prepare: (raw) => JSON.parse(raw),
  },
  {
    key: 'pms',
    title: 'PMS daily working sheets',
    icon: Blocks,
    rpc: 'import_work_logs',
    arg: 'p_rows',
    description: 'Form responses: employee, date, up to ten tasks with their status, priority and remarks.',
    where: 'Download the "Daily Employee Working Sheet" responses from Google Sheets as CSV and drop the file here.',
    accept: '.csv,.txt',
    prepare: (raw) => (raw.trim().startsWith('[') ? JSON.parse(raw) : parsePmsCsv(raw)),
  },
];

export function ImportPage() {
  const can = useCan('admin.import');

  return (
    <>
      <PageHeader
        icon={FileUp}
        title="Data Import"
        description="Bring the history of the four legacy applications into the suite. Running an import twice is safe."
      />

      <Card className="mb-6">
        <CardContent className="grid gap-2 p-4 text-sm text-muted-foreground">
          <p>
            Each importer checks your permission first, refuses sites you are not assigned to, and writes what it did to
            the audit log. Records that already exist are <strong>skipped, never overwritten</strong> — so a correction
            made here survives a re-import.
          </p>
          <p>Use <strong>Check first</strong> to see what would land before anything is written.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        {SOURCES.map((s) => (
          <ImportCard key={s.key} source={s} canImport={can.create} />
        ))}
      </div>
    </>
  );
}

function ImportCard({ source, canImport }: { source: Source; canImport: boolean }) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState<'check' | 'run' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const Icon = source.icon;

  async function run(dryRun: boolean) {
    if (!raw.trim()) return toast.error('Paste the export, or choose a file.');
    let payload: unknown;
    try {
      payload = source.prepare(raw);
    } catch (e) {
      return toast.error(`That file could not be read: ${(e as Error).message}`);
    }
    setBusy(dryRun ? 'check' : 'run');
    const { data, error } = await supabase.rpc(source.rpc, { [source.arg]: payload, p_dry_run: dryRun });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    setResult(data as Result);
    if (!dryRun) {
      await qc.invalidateQueries();
      toast.success(`Imported ${fmtNumber((data as Result).inserted)} record(s).`);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRaw(await file.text());
    setResult(null);
    toast.success(`${file.name} loaded (${fmtNumber(Math.round(file.size / 1024))} KB).`);
  }

  const unknown = result?.unknown_sites ?? result?.unknown_departments ?? result?.unknown_employees ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>{source.title}</CardTitle>
            <CardDescription>{source.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">{source.where}</p>
        <Textarea
          rows={4}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setResult(null);
          }}
          placeholder="Paste the export here, or choose a file below"
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept={source.accept}
            onChange={onFile}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => run(true)} disabled={busy !== null || !raw.trim()}>
            {busy === 'check' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Check first
          </Button>
          <Button size="sm" onClick={() => run(false)} disabled={!canImport || busy !== null || !raw.trim()}>
            {busy === 'run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Import
          </Button>
        </div>

        {result && (
          <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={result.dry_run ? 'secondary' : 'success'}>
                {result.dry_run ? 'Dry run — nothing written' : 'Imported'}
              </Badge>
              <span className="tabular">
                {fmtNumber(result.inserted)} {result.dry_run ? 'would be added' : 'added'}
              </span>
              <span className="tabular text-muted-foreground">· {fmtNumber(result.skipped)} already here</span>
              {result.ignored ? (
                <span className="tabular text-amber-600">· {fmtNumber(result.ignored)} could not be matched</span>
              ) : null}
              {result.employees_created ? (
                <span className="tabular text-muted-foreground">· {fmtNumber(result.employees_created)} employee(s) created</span>
              ) : null}
            </div>
            {result.from && (
              <p className="text-xs text-muted-foreground">
                Covering {result.from} to {result.to}
              </p>
            )}
            {unknown.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Not matched in the suite: </span>
                {unknown.map((u) => (
                  <Badge key={u} variant="warning" className="mr-1">
                    {u}
                  </Badge>
                ))}
                <p className="mt-1 text-muted-foreground">
                  Add these first if their history matters, then run the import again.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
