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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
