// A look inside an Excel file without downloading it: browsers cannot show
// one in a tab, so the workbook is read here and drawn as a table.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState } from '@/components/common';
import { fetchDocumentBlob, type LibraryDoc } from '@/features/documents/api';

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_COLS = 60;

interface Sheet { name: string; rows: { number: number; cells: string[] }[]; columns: number; total: number }

function cellText(cell: import('exceljs').Cell): string {
  if (cell.isMerged && cell.master !== cell) return '';
  const value = cell.formula ? cell.result : cell.value;
  if (value instanceof Date) return fmtDate(value);
  if (typeof value === 'number') {
    if (String(cell.numFmt ?? '').includes('%')) return `${Number((value * 100).toFixed(2))}%`;
    return String(Number(value.toFixed(4)));
  }
  try {
    return cell.text;
  } catch {
    return '';
  }
}

async function readWorkbook(doc: LibraryDoc): Promise<Sheet[]> {
  if ((doc.size_bytes ?? 0) > MAX_BYTES) throw new Error('This file is too large to preview. Download it to open it in Excel.');
  const blob = await fetchDocumentBlob(doc);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets.filter((ws) => ws.state === 'visible').map((ws) => {
    const rows: Sheet['rows'] = [];
    let columns = 0;
    let total = 0;
    ws.eachRow((row, number) => {
      total += 1;
      if (rows.length >= MAX_ROWS) return;
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(row.cellCount, MAX_COLS); c += 1) cells.push(cellText(row.getCell(c)));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      columns = Math.max(columns, cells.length);
      rows.push({ number, cells });
    });
    return { name: ws.name, rows, columns, total };
  });
}

export function SpreadsheetPreview({ doc, onDownload, onClose }: { doc: LibraryDoc | null; onDownload: (d: LibraryDoc) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(0);
  const book = useQuery({
    queryKey: ['spreadsheet-preview', doc?.id],
    queryFn: () => readWorkbook(doc!),
    enabled: Boolean(doc),
    retry: false,
    gcTime: 0,
  });
  const sheets = book.data ?? [];
  const sheet = sheets[picked] ?? sheets[0];

  function close() {
    setPicked(0);
    onClose();
  }

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">{doc?.file_name}</DialogTitle>
          <DialogDescription>Values only: colours and charts show when the file is opened in Excel.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0">
          {book.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Opening the file…</div>
          ) : book.error ? (
            <ErrorState message={errorMessage(book.error)} onRetry={() => book.refetch()} />
          ) : (
            <>
              {sheets.length > 1 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {sheets.map((s, i) => (
                    <Button key={s.name} size="sm" variant={s === sheet ? 'default' : 'outline'} onClick={() => setPicked(i)}>{s.name}</Button>
                  ))}
                </div>
              )}
              {sheet?.rows.length ? (
                <div className="max-h-[60vh] overflow-auto rounded-lg border">
                  <table className="border-collapse text-xs">
                    <tbody>
                      {sheet.rows.map((r) => (
                        <tr key={r.number}>
                          <th scope="row" className="sticky left-0 border bg-muted px-2 py-1 text-right font-normal text-muted-foreground">{r.number}</th>
                          {Array.from({ length: sheet.columns }, (_, c) => (
                            <td key={c} title={r.cells[c]} className="max-w-xs truncate border px-2 py-1">{r.cells[c]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">This sheet is empty.</p>
              )}
              {sheet && sheet.total > sheet.rows.length && (
                <p className="mt-2 text-xs text-muted-foreground">Showing the first {fmtNumber(sheet.rows.length)} of {fmtNumber(sheet.total)} rows. Download the file to see them all.</p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Close</Button>
          {doc && <Button onClick={() => onDownload(doc)}><Download /> Download</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
