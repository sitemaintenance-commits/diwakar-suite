// A print-ready page of one day's Department Review, opened in a new tab:
// the browser's print dialog saves it as PDF. The same content the old
// Daily Review CRM printed: headline numbers, then every department.
import { fmtDate } from '@/lib/format';
import { DEPARTMENT_HEADS } from '@/features/daily/heads';

interface Metric { label: string; value: string }
interface Report {
  health: string;
  status: string;
  work_completed: string | null;
  issues: string | null;
  next_day_plan: string | null;
  remarks: string | null;
  reporter: string | null;
  metrics: Metric[];
  reviews: { action: string; comment: string | null; by: string | null }[];
}
export interface PrintableReview {
  date: string;
  compare_date: string;
  headline: { metrics: Metric[]; note: string | null } | null;
  departments: { name: string; today: Report | null; previous: Report | null }[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const para = (s: string | null | undefined) => (s ? esc(s).replace(/\n/g, '<br>') : '<span class="muted">—</span>');

const HEALTH: Record<string, [string, string]> = {
  on_track: ['On track', '#15803d'],
  needs_attention: ['Needs attention', '#b45309'],
  critical: ['Critical', '#b91c1c'],
};

const reviewRemarks = (r: Report, action: string) =>
  r.reviews?.filter((x) => x.action === action && x.comment).map((x) => x.comment).join('\n') ?? '';

// Keep older issues and plans in the same Department Head's Remarks field used
// by the Excel export, so historical reports lose no information.
const departmentHeadRemarks = (r: Report) => [
  r.work_completed,
  r.issues ? `Issues: ${r.issues}` : null,
  r.next_day_plan ? `Plan for tomorrow: ${r.next_day_plan}` : null,
].filter(Boolean).join('\n\n');

const field = (label: string, value: string | null | undefined, className = '') =>
  `<div class="field ${className}"><h3>${esc(label)}</h3><div class="field-value">${para(value)}</div></div>`;

export function printDayReview(review: PrintableReview, company: string) {
  // Open first: a tab opened after an await is often blocked.
  const w = window.open('', '_blank');
  if (!w) throw new Error('Allow pop-ups for this site to print the review.');

  const reported = review.departments.filter((d) => d.today && d.today.status !== 'draft').length;
  const headline = review.headline?.metrics?.length
    ? `<div class="headline">${review.headline.metrics
        .map((m) => `<div><span>${esc(m.label)}</span><b>${esc(m.value)}</b></div>`).join('')}</div>
       ${review.headline.note ? `<p class="note">${esc(review.headline.note)}</p>` : ''}`
    : '';

  const departments = review.departments.map((d) => {
    const r = d.today;
    if (!r) {
      return `<section class="dept"><h2>${esc(d.name)} <em class="missing">Not filed</em></h2></section>`;
    }
    const [label, color] = HEALTH[r.health] ?? [r.health, '#475569'];
    const metrics = r.metrics?.filter((m) => m.label)?.length
      ? r.metrics.filter((m) => m.label)
          .map((m) => `<div class="number"><span>${esc(m.label)}</span><b>${para(m.value)}</b></div>`).join('')
      : '<span class="muted">—</span>';
    const reportedBy = DEPARTMENT_HEADS[d.name] ?? r.reporter;
    return `<section class="dept">
      <h2>${esc(d.name)} <span class="pill" style="color:${color};border-color:${color}">${esc(label)}</span>
        ${r.status === 'draft' ? '<em class="missing">Draft</em>' : ''}</h2>
      <div class="identity-fields">
        ${field('Review date', fmtDate(review.date))}
        ${field('Department', d.name)}
        ${field('Reported by', reportedBy)}
      </div>
      <div class="report-fields">
        <div class="field"><h3>Key numbers</h3><div class="field-value">${metrics}</div></div>
        ${field("Department Head's Remarks", departmentHeadRemarks(r))}
        ${field('CCM Remarks', reviewRemarks(r, 'ccm_remark'))}
        ${field('Founder Remarks', reviewRemarks(r, 'founder_remark'))}
      </div>
    </section>`;
  }).join('');

  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>Department Review · ${esc(fmtDate(review.date))}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; margin: 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #ea580c; padding-bottom: 8px; margin-bottom: 14px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 2px 0 0; color: #475569; }
  .headline { display: flex; flex-wrap: wrap; gap: 8px 20px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 14px; }
  .headline span { display: block; color: #9a3412; font-size: 11px; }
  .headline b { font-size: 15px; }
  .note { color: #475569; margin: 6px 0 0; }
  .dept { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-top: 12px; break-inside: avoid; }
  .dept h2 { font-size: 14px; margin: 0 0 4px; display: flex; gap: 8px; align-items: center; }
  .pill { font-size: 10px; font-weight: 600; border: 1px solid; border-radius: 999px; padding: 1px 8px; }
  .missing { color: #b91c1c; font-size: 11px; font-style: normal; font-weight: 600; }
  .muted { color: #64748b; margin: 0; }
  h3 { font-size: 10px; color: #475569; margin: 0 0 4px; }
  p { margin: 0; }
  .identity-fields, .report-fields { display: grid; gap: 1px; background: #e2e8f0; border: 1px solid #e2e8f0; }
  .identity-fields { grid-template-columns: .9fr 1.35fr 1.15fr; margin-top: 8px; }
  .report-fields { grid-template-columns: 1fr 1fr; margin-top: 1px; }
  .field { min-width: 0; background: #fff; padding: 7px 9px; }
  .field-value { color: #0f172a; overflow-wrap: anywhere; }
  .number { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 2px 0; }
  .number + .number { border-top: 1px solid #f1f5f9; }
  .number span { color: #475569; }
  .number b { font-weight: 500; }
  footer { margin-top: 16px; color: #94a3b8; font-size: 10px; }
  @media print { body { margin: 0; } @page { margin: 12mm; } }
</style></head><body>
<header>
  <div><h1>Department Review</h1><p>${esc(company)}</p></div>
  <div style="text-align:right"><b>${esc(fmtDate(review.date))}</b><p>${reported} of ${review.departments.length} departments reported</p></div>
</header>
${headline}
${departments}
<footer>Printed ${esc(new Date().toLocaleString('en-IN'))}</footer>
</body></html>`);
  w.document.close();
  w.focus();
  // Let the page lay out before the print dialog opens.
  setTimeout(() => w.print(), 300);
}
