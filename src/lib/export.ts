import { supabase } from '@/lib/supabase';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface XlsxColumn<T> {
  header: string;
  value: (row: T) => unknown;
  /** Excel number format, e.g. '#,##0.00'. Numbers without one keep Excel's default. */
  numFmt?: string;
  width?: number;
}

/**
 * Export rows to a real .xlsx workbook: title rows, a bold header, number
 * formats, an optional totals row and a frozen header. The export is recorded
 * in the audit log -- refused, and nothing downloaded, without EXPORT on the module.
 * The spreadsheet library is loaded only when someone exports.
 */
export async function exportXlsx<T>(
  moduleKey: string,
  filename: string,
  rows: T[],
  columns: XlsxColumn<T>[],
  opts: { sheet?: string; title?: string[]; totals?: Record<number, unknown> } = {},
) {
  await exportXlsxBook(moduleKey, filename, [{ name: opts.sheet ?? 'Sheet1', rows, columns, title: opts.title, totals: opts.totals }]);
}

export interface XlsxSheet<T> {
  name: string;
  rows: T[];
  columns: XlsxColumn<T>[];
  title?: string[];
  totals?: Record<number, unknown>;
  /** Lines written under the table, e.g. "Report analyzed by : CCM". */
  footer?: string[];
}

/**
 * Writes the export to the audit log first; the database refuses it (and
 * nothing is downloaded) without EXPORT permission on the module.
 */
export async function recordExport(moduleKey: string, summary: string) {
  const { error } = await supabase.rpc('log_event', { p_action: 'export', p_module: moduleKey, p_summary: summary, p_details: null });
  if (error) throw new Error(error.message);
}

/** The same as exportXlsx, with several sheets in one workbook. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportXlsxBook(moduleKey: string, filename: string, sheets: XlsxSheet<any>[]) {
  await recordExport(moduleKey, `Exported ${sheets.reduce((n, s) => n + s.rows.length, 0)} row(s) to ${filename}`);

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Diwakar Solar Management Suite';
  const text = (v: unknown) => {
    const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no formula injection
  };

  for (const sheet of sheets) {
    const { columns } = sheet;
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    for (const line of sheet.title ?? []) {
      const r = ws.addRow([line]);
      ws.mergeCells(r.number, 1, r.number, columns.length);
      r.font = { bold: true, size: r.number === 1 ? 13 : 11 };
      r.alignment = { horizontal: 'center' };
    }
    const header = ws.addRow(columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8740C' } };
    });
    ws.views = [{ state: 'frozen', ySplit: header.number }];

    for (const row of sheet.rows) {
      const r = ws.addRow(columns.map((c) => {
        const v = c.value(row);
        return v === null || v === undefined || v === '' ? null : typeof v === 'number' || v instanceof Date ? v : text(v);
      }));
      r.alignment = { vertical: 'top', wrapText: true };
    }
    if (sheet.totals) {
      const t = ws.addRow(columns.map((_, i) => sheet.totals![i] ?? null));
      t.font = { bold: true };
      t.eachCell((c) => {
        c.border = { top: { style: 'thin' } };
      });
    }
    for (const line of sheet.footer ?? []) {
      const f = ws.addRow([line]);
      ws.mergeCells(f.number, 1, f.number, columns.length);
      f.font = { italic: true };
    }
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.numFmt) col.numFmt = c.numFmt;
      // Without a set width, wide enough for the header and what is in the column.
      const longest = sheet.rows.slice(0, 500).reduce<number>((w, row) => {
        const v = c.value(row);
        return Math.max(w, v === null || v === undefined ? 0 : String(v).length);
      }, c.header.length);
      col.width = c.width ?? Math.min(40, Math.max(10, longest + 2));
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  download(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
  );
}
