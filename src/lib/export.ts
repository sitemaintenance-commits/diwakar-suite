import { supabase } from '@/lib/supabase';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection and quote as needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Export rows to CSV (opens in Excel). The export is recorded in the audit
 * log; the database refuses the audit call unless the user holds EXPORT on
 * the module, in which case nothing is downloaded.
 */
export async function exportCsv<T>(moduleKey: string, filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const { error } = await supabase.rpc('log_event', {
    p_action: 'export',
    p_module: moduleKey,
    p_summary: `Exported ${rows.length} row(s) to ${filename}`,
    p_details: null,
  });
  if (error) throw new Error(error.message);

  const lines = [columns.map((c) => cell(c.header)).join(','), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  download(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

function download(blob: Blob, name: string) {
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
 * formats, an optional totals row and a frozen header. Audited exactly like
 * exportCsv -- refused, and nothing downloaded, without EXPORT on the module.
 * The spreadsheet library is loaded only when someone exports.
 */
export async function exportXlsx<T>(
  moduleKey: string,
  filename: string,
  rows: T[],
  columns: XlsxColumn<T>[],
  opts: { sheet?: string; title?: string[]; totals?: Record<number, unknown> } = {},
) {
  const { error } = await supabase.rpc('log_event', {
    p_action: 'export',
    p_module: moduleKey,
    p_summary: `Exported ${rows.length} row(s) to ${filename}`,
    p_details: null,
  });
  if (error) throw new Error(error.message);

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Diwakar Solar Management Suite';
  const ws = wb.addWorksheet(opts.sheet ?? 'Sheet1');

  for (const line of opts.title ?? []) {
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

  const text = (v: unknown) => {
    const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no formula injection
  };
  for (const row of rows) {
    ws.addRow(columns.map((c) => {
      const v = c.value(row);
      return v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : text(v);
    }));
  }
  if (opts.totals) {
    const t = ws.addRow(columns.map((_, i) => opts.totals![i] ?? null));
    t.font = { bold: true };
    t.eachCell((c) => {
      c.border = { top: { style: 'thin' } };
    });
  }
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.numFmt) col.numFmt = c.numFmt;
    col.width = c.width ?? Math.min(40, Math.max(10, c.header.length + 2));
  });

  const buf = await wb.xlsx.writeBuffer();
  download(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
  );
}
