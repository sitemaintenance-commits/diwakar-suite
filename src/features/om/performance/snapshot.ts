// A picture of one day's Team Performance, laid out like the Excel sheet:
// the "O&M TEAM PERFORMANCE" title, the date, an orange header row and one
// gridded row per technician.
import { fmtDate, safeNum } from '@/lib/format';
import { tableImage, type SnapColumn } from '@/lib/snapshot';
import type { TechScore } from '@/features/om/opsApi';

const COLS: SnapColumn<TechScore>[] = [
  { header: 'Date', width: 100, value: (r) => fmtDate(r.score_date) },
  { header: 'Site', width: 120, value: (r) => r.site },
  { header: 'Technician', width: 190, value: (r) => r.technician },
  { header: 'Attendance /20', width: 100, align: 'right', value: (r) => String(safeNum(r.attendance)) },
  { header: 'Daily work /25', width: 100, align: 'right', value: (r) => String(safeNum(r.daily_work)) },
  { header: 'Task assigned /10', width: 112, align: 'right', value: (r) => String(safeNum(r.task_assigned)) },
  { header: 'Task status', width: 112, value: (r) => (r.task_status === '—' ? '' : r.task_status ?? '') },
  { header: 'Form submit /25', width: 104, align: 'right', value: (r) => String(safeNum(r.form_submit)) },
  { header: 'Auto /80', width: 74, align: 'right', value: (r) => String(safeNum(r.auto_score)) },
  { header: 'Monthly /20', width: 84, align: 'right', value: (r) => (r.monthly_review == null ? '' : String(safeNum(r.monthly_review))) },
  { header: 'Total /100', width: 84, align: 'right', value: (r) => String(safeNum(r.total_score)) },
  { header: 'Band', width: 70, value: (r) => r.band ?? '' },
  { header: 'Remarks', width: 290, value: (r) => (r.remarks ?? '').trim() },
];

/** The day's records as a PNG, sorted by site and technician. */
export function teamPerformanceImage(records: TechScore[], day: string): Promise<Blob> {
  const rows = [...records].sort((a, b) => a.site.localeCompare(b.site) || a.technician.localeCompare(b.technician));
  return tableImage({ title: 'O&M TEAM PERFORMANCE', subtitle: fmtDate(day), columns: COLS, rows, empty: 'No technician records for this day.' });
}
