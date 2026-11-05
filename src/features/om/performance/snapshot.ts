// A picture of one day's Team Performance, laid out like the Excel sheet:
// the "O&M TEAM PERFORMANCE" title, the date, an orange header row and one
// gridded row per technician. Drawn on a canvas, so it needs no library and
// can be shared on WhatsApp or by email as a plain PNG.
import { fmtDate, safeNum } from '@/lib/format';
import type { TechScore } from '@/features/om/opsApi';

interface Col {
  header: string;
  width: number;
  align: 'left' | 'right';
  value: (r: TechScore) => string;
}

const COLS: Col[] = [
  { header: 'Date', width: 100, align: 'left', value: (r) => fmtDate(r.score_date) },
  { header: 'Site', width: 120, align: 'left', value: (r) => r.site },
  { header: 'Technician', width: 190, align: 'left', value: (r) => r.technician },
  { header: 'Attendance /20', width: 100, align: 'right', value: (r) => String(safeNum(r.attendance)) },
  { header: 'Daily work /25', width: 100, align: 'right', value: (r) => String(safeNum(r.daily_work)) },
  { header: 'Task assigned /10', width: 112, align: 'right', value: (r) => String(safeNum(r.task_assigned)) },
  { header: 'Task status', width: 112, align: 'left', value: (r) => (r.task_status === '—' ? '' : r.task_status ?? '') },
  { header: 'Form submit /25', width: 104, align: 'right', value: (r) => String(safeNum(r.form_submit)) },
  { header: 'Auto /80', width: 74, align: 'right', value: (r) => String(safeNum(r.auto_score)) },
  { header: 'Monthly /20', width: 84, align: 'right', value: (r) => (r.monthly_review == null ? '' : String(safeNum(r.monthly_review))) },
  { header: 'Total /100', width: 84, align: 'right', value: (r) => String(safeNum(r.total_score)) },
  { header: 'Band', width: 70, align: 'left', value: (r) => r.band ?? '' },
  { header: 'Remarks', width: 290, align: 'left', value: (r) => (r.remarks ?? '').trim() },
];

const FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const PAD = 6;
const LINE = 18;
const ORANGE = '#e8740c';
const GRID = '#c7c7c7';

/** Split text into lines that fit the width (keeps the line breaks it already has). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  if (!text) return [''];
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** The day's records as a PNG, sorted by site and technician. */
export async function teamPerformanceImage(records: TechScore[], day: string): Promise<Blob> {
  const rows = [...records].sort((a, b) => a.site.localeCompare(b.site) || a.technician.localeCompare(b.technician));
  const tableW = COLS.reduce((s, c) => s + c.width, 0);
  const margin = 16;
  const scale = 2;   // sharp on phones and when zoomed

  // Measure first: every row is as tall as its longest wrapped cell.
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `14px ${FONT}`;
  const cells = rows.map((r) => COLS.map((c) => wrap(probe, c.value(r), c.width - PAD * 2)));
  const rowH = cells.map((cs) => Math.max(...cs.map((l) => l.length)) * LINE + 8);
  probe.font = `bold 14px ${FONT}`;
  const heads = COLS.map((c) => wrap(probe, c.header, c.width - PAD * 2));
  const headH = Math.max(...heads.map((l) => l.length)) * LINE + 10;
  const titleH = 34;
  const dateH = 26;
  const emptyH = rows.length ? 0 : 40;
  const height = margin * 2 + titleH + dateH + headH + rowH.reduce((s, h) => s + h, 0) + emptyH;
  const width = margin * 2 + tableW;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';

  const x0 = margin;
  let y = margin;
  const box = (x: number, top: number, w: number, h: number, stroke = GRID) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, w, h);
  };

  // Title and date, centred across the table.
  ctx.fillStyle = '#000000';
  ctx.font = `bold 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('O&M TEAM PERFORMANCE', x0 + tableW / 2, y + 7);
  box(x0, y, tableW, titleH, '#1f7a4d');
  y += titleH;
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(fmtDate(day), x0 + tableW / 2, y + 5);
  box(x0, y, tableW, dateH);
  y += dateH;

  // Orange header row, white bold text.
  ctx.fillStyle = ORANGE;
  ctx.fillRect(x0, y, tableW, headH);
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  let x = x0;
  COLS.forEach((c, i) => {
    ctx.textAlign = 'left';
    heads[i].forEach((l, j) => ctx.fillText(l, x + PAD, y + 5 + j * LINE));
    x += c.width;
  });
  y += headH;

  // One row per technician.
  ctx.font = `14px ${FONT}`;
  rows.forEach((_, ri) => {
    let cx = x0;
    COLS.forEach((c, ci) => {
      box(cx, y, c.width, rowH[ri]);
      ctx.fillStyle = '#000000';
      ctx.textAlign = c.align;
      const tx = c.align === 'right' ? cx + c.width - PAD : cx + PAD;
      cells[ri][ci].forEach((l, j) => ctx.fillText(l, tx, y + 5 + j * LINE));
      cx += c.width;
    });
    y += rowH[ri];
  });
  if (!rows.length) {
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText('No technician records for this day.', x0 + tableW / 2, y + 12);
    box(x0, y, tableW, emptyH);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be made.'))), 'image/png'));
}
