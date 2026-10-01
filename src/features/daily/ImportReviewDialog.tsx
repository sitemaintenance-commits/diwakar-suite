// Import Excel on Management Review: the legacy "Daily Review Update
// Tracker" workbook, the old site's download, or the suite's own. The file
// is read in the browser; import_review_excel() previews, then writes.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readReviewWorkbook, type ImportRow } from '@/features/daily/reviewExcel';

interface Result {
  applied: boolean;
  total: number;
  added: { date: string; department: string; remarks: number }[];
  filled: { date: string; department: string; fields: string[] }[];
  unchanged: number;
  remarks: number;
  unknown_departments: string[];
  unreadable: number;
}

export function ImportReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setResult(null);
    setFileName('');
  }

  async function run(p_rows: ImportRow[], apply: boolean) {
    const { data, error } = await supabase.rpc('import_review_excel', { p_rows, p_apply: apply });
    if (error) throw error;
    return data as Result;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const read = await readReviewWorkbook(file);
      if (!read.length) throw new Error('The sheet has no department rows.');
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
      toast.success(`Imported: ${done.added.length} new report(s), ${done.filled.length} filled in, ${done.remarks} remark(s)`);
      await qc.invalidateQueries({ queryKey: ['daily-review'] });
      await qc.invalidateQueries({ queryKey: ['daily-month'] });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const nothing = result && result.added.length === 0 && result.filled.length === 0;
  const dates = rows ? [...new Set(rows.map((r) => r.date).filter(Boolean))].sort() : [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import department reports from Excel</DialogTitle>
          <DialogDescription>
            The Daily Review Update Tracker workbook, the old site’s Excel download, or this suite’s own: columns
            Review date, Department, Reported by, Status, Department updates, Today Key Remarks Updates, CCM Remarks
            and Founder Remarks. New department-days are added; reports already here only have empty parts filled,
            and remarks are added unless the same remark is already there.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 text-sm">
          {busy && !result ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />}
          <span>{fileName || 'Choose the .xlsx file'}</span>
          <input type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>

        {result && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {result.total} row(s){dates.length ? `, ${fmtDate(dates[0]!)}${dates.length > 1 ? ` to ${fmtDate(dates[dates.length - 1]!)}` : ''}` : ''}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{result.added.length} new report(s)</Badge>
              <Badge variant="info">{result.filled.length} to fill in</Badge>
              <Badge variant="secondary">{result.unchanged} already up to date</Badge>
              <Badge variant="warning">{result.remarks} remark(s) to add</Badge>
              {result.unknown_departments.length > 0 && <Badge variant="destructive">{result.unknown_departments.length} unknown department(s)</Badge>}
              {result.unreadable > 0 && <Badge variant="destructive">{result.unreadable} row(s) without a usable date</Badge>}
            </div>
            {result.unknown_departments.length > 0 && (
              <p className="text-destructive">
                Not departments in the suite, so skipped: {result.unknown_departments.join(', ')}. Rename them in the sheet,
                or add the department under HR &amp; Performance → Departments.
              </p>
            )}
            {result.added.length > 0 && (
              <section>
                <h3 className="mb-1 font-semibold">New reports</h3>
                <ul className="grid gap-0.5">
                  {result.added.map((a, i) => (
                    <li key={i}>{fmtDate(a.date)} · {a.department}{a.remarks ? ` · ${a.remarks} remark(s)` : ''}</li>
                  ))}
                </ul>
              </section>
            )}
            {result.filled.length > 0 && (
              <section>
                <h3 className="mb-1 font-semibold">Filled in</h3>
                <ul className="grid gap-0.5">
                  {result.filled.map((f, i) => (
                    <li key={i}>{fmtDate(f.date)} · {f.department}: {f.fields.join(', ')}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button disabled={busy || !result || !!nothing} onClick={() => void apply()}>
            {busy && result ? <Loader2 className="animate-spin" /> : <Upload />}
            {nothing ? 'Nothing to import' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
