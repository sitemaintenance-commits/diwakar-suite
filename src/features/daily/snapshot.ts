// One day's Department Review as a picture: every department in the old
// Daily Review CRM's order, with its status, key numbers and remarks.
import { fmtDate } from '@/lib/format';
import { recordExport } from '@/lib/export';
import { shareImage, tableImage, type SnapColumn } from '@/lib/snapshot';
import { DEPARTMENT_HEADS } from '@/features/daily/heads';
import type { PrintableReview } from '@/features/daily/print';
import { keyNumbers, keyRemarks, remarksOf, reportedBy } from '@/features/daily/reviewExcel';

type Dept = PrintableReview['departments'][number];

const HEALTH: Record<string, string> = { on_track: 'On track', needs_attention: 'Needs attention', critical: 'Critical' };

const COLS: SnapColumn<Dept>[] = [
  { header: 'Department', width: 150, value: (d) => d.name },
  { header: 'Status', width: 110, value: (d) => (d.today ? `${HEALTH[d.today.health] ?? d.today.health}${d.today.status === 'draft' ? ' (draft)' : ''}` : 'Not filed') },
  { header: 'Reported by', width: 130, value: (d) => (d.today ? reportedBy(d.name, d.today) : '') },
  { header: 'Key numbers', width: 340, value: (d) => keyNumbers(d.today) },
  { header: "Department Head's Remarks", width: 340, value: (d) => keyRemarks(d.today) },
  { header: 'CCM Remarks', width: 200, value: (d) => remarksOf(d.today, 'ccm_remark') },
  { header: 'Founder Remarks', width: 200, value: (d) => remarksOf(d.today, 'founder_remark') },
];

/** Draws, records in the audit log, downloads and copies the day. True when copied. */
export async function snapshotReviewDay(moduleKey: string, review: PrintableReview, company: string): Promise<boolean> {
  const order = Object.keys(DEPARTMENT_HEADS);
  const rank = (name: string) => (order.indexOf(name) === -1 ? order.length : order.indexOf(name));
  const rows = [...review.departments].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const reported = rows.filter((d) => d.today && d.today.status !== 'draft').length;
  const blob = await tableImage({
    title: 'DEPARTMENT REVIEW',
    subtitle: `${company} · ${fmtDate(review.date)} · ${reported} of ${rows.length} departments reported`,
    columns: COLS,
    rows,
    empty: 'No departments.',
  });
  await recordExport(moduleKey, `Downloaded the ${review.date} department review snapshot`);
  return shareImage(blob, `department-review-${review.date}.png`);
}
