// The Department Review in the old Daily Review CRM site's workbook layout:
// Department reports, HR Report, Admin Report, Headline numbers, Founder
// remarks and Department metrics, each under the brand, day and summary
// lines. Used both to download a day and to read a workbook for import.
import { download, recordExport } from '@/lib/export';
import { DEPARTMENT_HEADS } from '@/features/daily/heads';

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
  headline?: { metrics: Metric[]; note: string | null } | null;
  departments: { name: string; today: Report | null }[];
}

type Cell = string | number | Date | null;
type ExcelJSModule = typeof import('exceljs');
type Worksheet = import('exceljs').Worksheet;

const BRAND_RED = 'FFAF511A';
const HEADER_FILL = 'FFFFEEDD';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const keyNumbers = (r: Report | null) => (r?.metrics ?? []).filter((m) => m.label).map((m) => `${m.label}: ${m.value}`).join('\n');
// Issues and tomorrow's plan are no longer asked for; older reports that have
// them keep them under the day's remarks so nothing is lost.
const keyRemarks = (r: Report | null) => [
  r?.work_completed,
  r?.issues ? `Issues: ${r.issues}` : null,
  r?.next_day_plan ? `Plan for tomorrow: ${r.next_day_plan}` : null,
].filter(Boolean).join('\n\n');
const remarksOf = (r: Report | null, action: string) =>
  (r?.reviews ?? []).filter((x) => x.action === action && x.comment).map((x) => x.comment).join('\n');
const reportedBy = (name: string, r: Report | null) => DEPARTMENT_HEADS[name] ?? r?.reporter ?? '';
const noFormula = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/** "Daily Review CRM - Mon, 28 Sept 2026", as the old site wrote it. */
function dayTitle(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `Daily Review CRM - ${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Rough height so wrapped text shows in full (Excel does not grow rows it did not lay out). */
function rowHeight(values: Cell[], widths: number[]) {
  let lines = 1;
  values.forEach((v, i) => {
    if (typeof v !== 'string' || !v) return;
    const perLine = Math.max(8, Math.floor((widths[i] ?? 15) * 1.15));
    lines = Math.max(lines, v.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0));
  });
  return Math.max(32, lines * 15 + 6);
}

/**
 * One sheet in the old site's layout: brand, day and summary lines, a
 * section title, a peach header row, the rows, and optional footer lines.
 */
function addSheet(
  wb: InstanceType<ExcelJSModule['Workbook']>,
  opts: { name: string; title: string; summary: string; brand: string; heading: string; headers: string[]; widths: number[];
    rows: Cell[][]; footer?: string[] },
): Worksheet {
  const ws = wb.addWorksheet(opts.name, {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const n = opts.headers.length;
  const line = (row: number, text: string, font: Partial<import('exceljs').Font>, height: number) => {
    ws.mergeCells(row, 1, row, n);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: 'Calibri', ...font };
    ws.getRow(row).height = height;
  };
  line(1, opts.brand, { size: 22, bold: true, color: { argb: BRAND_RED } }, 36);
  line(2, opts.title, { size: 12 }, 23);
  line(3, opts.summary, { size: 11 }, 25);
  ws.getRow(4).height = 10;
  line(5, opts.heading, { size: 12, bold: true, color: { argb: BRAND_RED } }, 24);

  const head = ws.getRow(6);
  head.values = opts.headers;
  head.height = 32;
  head.eachCell((c) => {
    c.font = { name: 'Calibri', size: 11, bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });

  opts.rows.forEach((values, i) => {
    const row = ws.getRow(7 + i);
    row.values = values.map((v) => (typeof v === 'string' ? noFormula(v) : v));
    row.height = rowHeight(values, opts.widths);
    for (let col = 1; col <= n; col++) {
      const c = row.getCell(col);
      c.font = { name: 'Calibri', size: 11 };
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = { top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' } };
      if (values[col - 1] instanceof Date) c.numFmt = 'dd mmm yyyy';
    }
  });
  const last = 6 + opts.rows.length;
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: Math.max(6, last), column: n } };

  (opts.footer ?? []).forEach((text, i) => {
    const r = last + 1 + i;
    ws.mergeCells(r, 1, r, n);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: 'Calibri', size: 11, italic: true };
    c.alignment = { horizontal: 'right' };
  });
  opts.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return ws;
}

// The remarks are written by each department's head, named under Reported by.
export const HEAD_REMARKS = "Department Head's Remarks";
const REPORT_HEADERS = ['Review date', 'Department', 'Reported by', 'Key numbers', HEAD_REMARKS, 'CCM Remarks', 'Founder Remarks'];
const ANALYZED_BY = ['Report analyzed by : CCM'];

/** Download one day as the old Daily Review CRM workbook. */
export async function downloadReviewDay(moduleKey: string, day: ReviewDay, brand = 'Diwakar Solar') {
  const date = new Date(`${day.date}T00:00:00Z`);
  // The old site's order (the heads list); any other department after them, A to Z.
  const order = Object.keys(DEPARTMENT_HEADS);
  const rank = (name: string) => (order.indexOf(name) === -1 ? order.length : order.indexOf(name));
  const depts = [...day.departments].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const reported = depts.filter((d) => d.today);
  const count = (h: string) => reported.filter((d) => d.today!.health === h).length;
  const summary = `${reported.length} of ${depts.length} departments reported   |   On track: ${count('on_track')}   |   Attention: ${count('needs_attention')}   |   Critical: ${count('critical')}`;
  const base = { title: dayTitle(day.date), summary, brand };

  const reportRow = (d: ReviewDay['departments'][number]): Cell[] => [
    date, d.name, reportedBy(d.name, d.today), keyNumbers(d.today), keyRemarks(d.today),
    remarksOf(d.today, 'ccm_remark'), remarksOf(d.today, 'founder_remark'),
  ];
  const deptSheet = (dept: string) => depts.filter((d) => d.name.toLowerCase() === dept.toLowerCase()).map(reportRow);

  // The day's founder remarks once each: one sent to every department is one line.
  const founder = new Map<string, string[]>();
  for (const d of reported) {
    for (const r of d.today!.reviews) {
      if (r.action === 'founder_remark' && r.comment) founder.set(r.comment, [...(founder.get(r.comment) ?? []), d.name]);
    }
  }
  const founderRows: Cell[][] = [...founder].map(([text, names]) => [date, names.length === reported.length ? text : `${text} (${names.join(', ')})`]);
  const headlineRows: Cell[][] = (day.headline?.metrics ?? []).filter((m) => m.label).map((m) => [date, m.label, m.value]);
  const metricRows: Cell[][] = reported.flatMap((d) =>
    d.today!.metrics.filter((m) => m.label).map((m) => [date, d.name, reportedBy(d.name, d.today), m.label, m.value] as Cell[]));

  await recordExport(moduleKey, `Exported the Department Review for ${day.date} (${depts.length} departments)`);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Diwakar Solar Management Suite';

  addSheet(wb, { ...base, name: 'Department reports', heading: 'Department reports', headers: REPORT_HEADERS,
    widths: [17, 31, 23, 34, 48, 44, 40], rows: depts.map(reportRow), footer: ANALYZED_BY });
  addSheet(wb, { ...base, name: 'HR Report', heading: 'HR Operations Review', headers: REPORT_HEADERS,
    widths: [17, 20, 23, 34, 48, 40, 40], rows: deptSheet('HR'), footer: ANALYZED_BY });
  addSheet(wb, { ...base, name: 'Admin Report', heading: 'Admin Operations Review', headers: REPORT_HEADERS,
    widths: [17, 20, 23, 34, 48, 40, 40], rows: deptSheet('Admin'), footer: ANALYZED_BY });
  addSheet(wb, { ...base, name: 'Headline numbers', heading: 'Company headline numbers', headers: ['Review date', 'Metric', 'Value'],
    widths: [19, 48, 27], rows: headlineRows.length ? headlineRows : [[date, '', '']] });
  addSheet(wb, { ...base, name: 'Founder remarks', heading: 'Founder Remarks', headers: ['Review date', 'Remarks and action points'],
    widths: [19, 95], rows: founderRows.length ? founderRows : [[date, '']] });
  addSheet(wb, { ...base, name: 'Department metrics', heading: 'Department key numbers', headers: ['Review date', 'Department', 'Reported by', 'Metric', 'Value'],
    widths: [19, 32, 24, 35, 24], rows: metricRows });

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `diwakar-daily-review-${day.date}.xlsx`);
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
  if (h.startsWith('today key remarks') || h.startsWith('work completed') || h.startsWith("department head's remarks") || h.startsWith('department head remarks')) return 'updates';
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
  const preferred = wb.worksheets.find((w) => ['daily reports', 'department reports'].includes(w.name.trim().toLowerCase()));
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
        const cell = row.getCell(Number(col));
        // A cell merged into another (a full-width line such as "Report
        // analyzed by : CCM") repeats that cell's text; it is not a value.
        const v = cell.isMerged && cell.master.address !== cell.address ? null : cellText(cell.value);
        if (field === 'metrics') r.metrics = parseMetrics(v);
        else if (field === 'date') r.date = toIsoDate(v);
        else r[field] = v;
      }
      // Rows without a department are the sheet's own lines, e.g. "Report analyzed by : CCM";
      // a department row with nothing filled in (one that did not report) is not a report to import.
      const empty = !r.metrics.length && !r.updates && !r.issues && !r.plan && !r.ccm && !r.founder;
      if (r.department && !empty) rows.push(r);
    });
    return rows;
  }
  throw new Error('No sheet with "Review date" and "Department" columns. Upload the Department Review workbook.');
}
