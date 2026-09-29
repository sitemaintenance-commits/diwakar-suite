// Import the HR system's "Employee Master Details" export (Employee Bulk
// Mail.xlsx). The file is read in the browser; import_employees() previews
// what it would do, and writes only when HR confirms.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type SheetRow = Record<string, string | null>;
interface ImportResult {
  applied: boolean;
  private_fields: boolean;
  total: number;
  added: { code: string; name: string; department: string | null; designation: string | null; location: string | null }[];
  updated: { code: string; name: string; fields: string[] }[];
  unchanged: number;
  differences: { code: string; name: string; field: string; suite: string | null; sheet: string | null }[];
  skipped: { code: string | null; name: string | null; reason: string }[];
}

// The export's column headings, and the name import_employees() expects.
const COLUMNS: Record<string, string> = {
  'employee number': 'code',
  'full name': 'name',
  'work email': 'email',
  'date of birth': 'dob',
  gender: 'gender',
  'mobile phone': 'phone',
  location: 'location',
  'legal entity': 'legal_entity',
  department: 'department',
  'job title': 'job_title',
  'date joined': 'joined',
  'employment status': 'status',
  'exit date': 'exit_date',
};
const DATES = new Set(['dob', 'joined', 'exit_date']);

function cellText(v: unknown, date: boolean): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return cellText(o.result, date);
  }
  const s = String(v).trim();
  // "27-07-2026" / "27/07/2026" typed as text.
  const dmy = date ? s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/) : null;
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s || null;
}

async function readSheet(file: File): Promise<SheetRow[]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  for (const ws of wb.worksheets) {
    // The heading row is the one that names "Employee Number"; a title row may sit above it.
    let headRow = 0;
    const keys: Record<number, string> = {};
    ws.eachRow((row, n) => {
      if (headRow) return;
      const found: Record<number, string> = {};
      row.eachCell((c, col) => {
        const key = COLUMNS[String(cellText(c.value, false) ?? '').toLowerCase().replace(/\s+/g, ' ').trim()];
        if (key) found[col] = key;
      });
      if (Object.values(found).includes('code')) {
        headRow = n;
        Object.assign(keys, found);
      }
    });
    if (!headRow) continue;
    const rows: SheetRow[] = [];
    ws.eachRow((row, n) => {
      if (n <= headRow) return;
      const r: SheetRow = {};
      for (const [col, key] of Object.entries(keys)) r[key] = cellText(row.getCell(Number(col)).value, DATES.has(key));
      if (r.code || r.name) rows.push(r);
    });
    return rows;
  }
  throw new Error('No "Employee Number" column found. Upload the Employee Master Details export from the HR system.');
}

export function EmployeeImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setResult(null);
    setFileName('');
  }

  async function run(p_rows: SheetRow[], apply: boolean) {
    const { data, error } = await supabase.rpc('import_employees', { p_rows, p_apply: apply });
    if (error) throw error;
    return data as ImportResult;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const read = await readSheet(file);
      if (!read.length) throw new Error('The sheet has no employees.');
      setRows(read);
      setFileName(file.name);
      setResult(await run(read, false));
    } catch (e) {
      toast.error(errorMessage(e));
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!rows) return;
    setBusy(true);
    try {
      const done = await run(rows, true);
      toast.success(`Imported: ${done.added.length} added, ${done.updated.length} updated`);
      await qc.invalidateQueries({ queryKey: ['employees'] });
      await qc.invalidateQueries({ queryKey: ['hr-summary'] });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const nothingToDo = result && result.added.length === 0 && result.updated.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from the HR sheet</DialogTitle>
          <DialogDescription>
            Upload the Employee Master Details export (Employee Bulk Mail.xlsx). New people are added; for people
            already here only empty details are filled in. Department and designation are kept as they are, and
            where the sheet says something different it is listed below for you to check.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 text-sm">
          {busy && !result ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />}
          <span>{fileName || 'Choose the .xlsx file'}</span>
          <input
            type="file"
            className="sr-only"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>

        {result && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{result.total} in the sheet</Badge>
              <Badge variant="success">{result.added.length} new</Badge>
              <Badge variant="info">{result.updated.length} to fill in</Badge>
              <Badge variant="secondary">{result.unchanged} already up to date</Badge>
              {result.differences.length > 0 && <Badge variant="warning">{result.differences.length} differences</Badge>}
              {result.skipped.length > 0 && <Badge variant="destructive">{result.skipped.length} skipped</Badge>}
            </div>
            {!result.private_fields && (
              <p className="text-xs text-muted-foreground">
                Date of birth and gender are left out: they need the Employee Private Data permission.
              </p>
            )}

            {result.added.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold">New employees</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead>Location</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.added.map((a) => (
                      <TableRow key={a.code}>
                        <TableCell><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.code}</div></TableCell>
                        <TableCell>{a.department ?? '—'}</TableCell>
                        <TableCell>{a.designation ?? '—'}</TableCell>
                        <TableCell>{a.location ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {result.updated.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold">Details filled in</h3>
                <ul className="space-y-1">
                  {result.updated.map((u) => (
                    <li key={u.code}><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">({u.code})</span>: {u.fields.join(', ')}</li>
                  ))}
                </ul>
              </section>
            )}

            {result.differences.length > 0 && (
              <section>
                <h3 className="mb-1 font-semibold">Where the HR sheet differs (not changed)</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  The suite keeps what people report in their daily PMS forms. Change these on the employee if the HR sheet is right.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>In the suite</TableHead>
                      <TableHead>In the HR sheet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.differences.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell>{d.name}</TableCell>
                        <TableCell>{d.field}</TableCell>
                        <TableCell>{d.suite ?? '—'}</TableCell>
                        <TableCell>{d.sheet ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {result.skipped.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold text-destructive">Skipped</h3>
                <ul className="space-y-1">
                  {result.skipped.map((s, i) => (
                    <li key={i}>{s.name ?? '—'} ({s.code ?? 'no number'}): {s.reason}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button disabled={busy || !result || !!nothingToDo} onClick={() => void apply()}>
            {busy && result ? <Loader2 className="animate-spin" /> : <Upload />}
            {nothingToDo ? 'Nothing to import' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
