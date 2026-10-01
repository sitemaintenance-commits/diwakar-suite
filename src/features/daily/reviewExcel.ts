// The Department Review in the legacy workbook's shape ("Daily Review Update
// Tracker.xlsx"): one row per department and day, the same eight columns,
// and the same three sheets -- Daily Reports, HR Reports, Admin Reports.
// Used both to download a day and to read a workbook for import.
import { exportXlsxBook, type XlsxColumn } from '@/lib/export';

interface Metric { label: string; value: string }
interface Report {
  health: string;
  status: string;
  work_completed: string | null;
  issues: string | null;
  next_day_plan: string | null;
  reporter: string | null;
  metrics: Metric[];
  reviews: { action: string; comment: string | null }[];
}
export interface ReviewDay {
  date: string;
  compare_date: string;
  departments: { name: string; today: Report | null }[];
}

export interface ReviewNames {
  founder: string;     // Founder Remarks (Sunil Bansal)
  coordinator: string; // Today Key Remarks Updates (Jitendra Sharma)
}

const HEALTH_LABEL: Record<string, string> = { on_track: 'On track', needs_attention: 'Needs attention', critical: 'Critical' };

type Row = { date: Date; name: string; r: Report | null };

function columns(names: ReviewNames): XlsxColumn<Row>[] {
  const remarks = (r: Report | null, action: string) =>
    (r?.reviews ?? []).filter((x) => x.action === action && x.comment).map((x) => x.comment).join('\n');
  return [
    { header: 'Review date', value: (x) => x.date, numFmt: 'dd mmm yyyy', width: 14 },
    { header: 'Department', value: (x) => x.name, width: 24 },
    { header: 'Reported by', value: (x) => x.r?.reporter ?? '', width: 22 },
    { header: 'Status', value: (x) => (x.r ? HEALTH_LABEL[x.r.health] ?? x.r.health : 'Not reported'), width: 16 },
    {
      header: 'Department updates',
      value: (x) => (x.r?.metrics ?? []).filter((m) => m.label).map((m) => `${m.label}: ${m.value}`).join('\n'),
      width: 42,
    },
    {
      header: `Today Key Remarks Updates (${names.coordinator})`,
      // The legacy sheet has no columns for issues or tomorrow's plan; they
      // follow the day's remarks so nothing typed in the suite is lost.
      value: (x) => [
        x.r?.work_completed,
        x.r?.issues ? `Issues: ${x.r.issues}` : null,
        x.r?.next_day_plan ? `Plan for tomorrow: ${x.r.next_day_plan}` : null,
      ].filter(Boolean).join('\n\n'),
      width: 55,
    },
    { header: 'CCM Remarks', value: (x) => remarks(x.r, 'ccm_remark'), width: 40 },
    { header: `Founder Remarks (${names.founder})`, value: (x) => remarks(x.r, 'founder_remark'), width: 40 },
  ];
}

/** Download one day as the legacy workbook. */
export async function downloadReviewDay(moduleKey: string, day: ReviewDay, names: ReviewNames) {
  const date = new Date(`${day.date}T00:00:00Z`);
  const all: Row[] = day.departments.map((d) => ({ date, name: d.name, r: d.today }));
  const only = (name: string) => all.filter((x) => x.name.toLowerCase() === name.toLowerCase());
  const cols = columns(names);
  const footer = ['Report analyzed by : CCM'];
  await exportXlsxBook(moduleKey, `department-review-${day.date}`, [
    { name: 'Daily Reports', rows: all, columns: cols, footer },
    { name: 'HR Reports', rows: only('HR'), columns: cols, footer },
    { name: 'Admin Reports', rows: only('Admin'), columns: cols, footer },
  ]);
}

// ------------------------------------------------------------------ import
export interface ImportRow {
  date: string | null;
  department: string | null;
  reporter: string | null;
  status: string | null;
  metrics: Metric[];
  updates: string | null;
  issues: string | null;
  plan: string | null;
  ccm: string | null;
  founder: string | null;
}

function cellText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
  }
  const s = String(v).trim();
  return s || null;
}

function toIsoDate(s: string | null): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})[-/. ](\d{1,2}|[A-Za-z]{3,9})[-/. ](\d{4})$/);
  if (dmy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const m = /^\d+$/.test(dmy[2]) ? Number(dmy[2]) : months.indexOf(dmy[2].slice(0, 3).toLowerCase()) + 1;
    if (m >= 1) return `${dmy[3]}-${String(m).padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return s; // the server refuses anything it cannot read as a date
}

/** "Label: value" lines, as the Department updates column holds them. */
function parseMetrics(s: string | null): Metric[] {
  if (!s) return [];
  return s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(':');
    return i > 0 ? { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : { label: line, value: '' };
  });
}

type Field = keyof Omit<ImportRow, 'metrics'> | 'metrics';
function fieldFor(header: string): Field | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^(review )?date$|^review date/.test(h)) return 'date';
  if (h.startsWith('department updates') || h.startsWith('key numbers')) return 'metrics';
  if (h === 'department') return 'department';
  if (h.startsWith('reported by')) return 'reporter';
  if (h === 'status' || h === 'health') return 'status';
  if (h.startsWith('today key remarks') || h.startsWith('work completed')) return 'updates';
  if (h.startsWith('issues')) return 'issues';
  if (h.startsWith('plan for tomorrow')) return 'plan';
  if (h.startsWith('ccm remark')) return 'ccm';
  if (h.startsWith('founder remark')) return 'founder';
  return null;
}

/**
 * Read the department rows of a Department Review workbook: the legacy
 * tracker, the old site's download, or the suite's own. The "Daily Reports"
 * sheet when there is one (the HR and Admin sheets repeat its rows), else the
 * first sheet whose headings name a review date and a department.
 */
export async function readReviewWorkbook(file: File): Promise<ImportRow[]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const preferred = wb.worksheets.find((w) => w.name.trim().toLowerCase() === 'daily reports');
  for (const ws of preferred ? [preferred] : wb.worksheets) {
    let headRow = 0;
    const map: Record<number, Field> = {};
    ws.eachRow((row, n) => {
      if (headRow) return;
      const found: Record<number, Field> = {};
      row.eachCell((c, col) => {
        const f = fieldFor(cellText(c.value) ?? '');
        if (f) found[col] = f;
      });
      const fields = Object.values(found);
      if (fields.includes('date') && fields.includes('department')) {
        headRow = n;
        Object.assign(map, found);
      }
    });
    if (!headRow) continue;
    const rows: ImportRow[] = [];
    ws.eachRow((row, n) => {
      if (n <= headRow) return;
      const r: ImportRow = { date: null, department: null, reporter: null, status: null, metrics: [], updates: null, issues: null, plan: null, ccm: null, founder: null };
      for (const [col, field] of Object.entries(map)) {
        const v = cellText(row.getCell(Number(col)).value);
        if (field === 'metrics') r.metrics = parseMetrics(v);
        else if (field === 'date') r.date = toIsoDate(v);
        else r[field] = v;
      }
      if (r.date || r.department) rows.push(r);
    });
    return rows;
  }
  throw new Error('No sheet with "Review date" and "Department" columns. Upload the Department Review workbook.');
}
