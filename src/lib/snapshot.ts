// A table drawn as a picture, laid out like the Excel sheets: a title, a
// date line, an orange header row and one gridded row per record. Drawn on
// a canvas, so it needs no library and can be shared on WhatsApp or by
// email as a plain PNG.

export interface SnapColumn<T> {
  header: string;
  width: number;
  align?: 'left' | 'right';
  value: (r: T) => string;
}

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

/** The rows as a PNG under a title and a date line. */
export async function tableImage<T>({ title, subtitle, columns, rows, empty = 'Nothing to show for this day.' }: {
  title: string; subtitle: string; columns: SnapColumn<T>[]; rows: T[]; empty?: string;
}): Promise<Blob> {
  const tableW = columns.reduce((s, c) => s + c.width, 0);
  const margin = 16;
  const scale = 2;   // sharp on phones and when zoomed

  // Measure first: every row is as tall as its longest wrapped cell.
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `14px ${FONT}`;
  const cells = rows.map((r) => columns.map((c) => wrap(probe, c.value(r), c.width - PAD * 2)));
  const rowH = cells.map((cs) => Math.max(...cs.map((l) => l.length)) * LINE + 8);
  probe.font = `bold 14px ${FONT}`;
  const heads = columns.map((c) => wrap(probe, c.header, c.width - PAD * 2));
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
  ctx.fillText(title, x0 + tableW / 2, y + 7);
  box(x0, y, tableW, titleH, '#1f7a4d');
  y += titleH;
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(subtitle, x0 + tableW / 2, y + 5);
  box(x0, y, tableW, dateH);
  y += dateH;

  // Orange header row, white bold text.
  ctx.fillStyle = ORANGE;
  ctx.fillRect(x0, y, tableW, headH);
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  let x = x0;
  columns.forEach((c, i) => {
    ctx.textAlign = 'left';
    heads[i].forEach((l, j) => ctx.fillText(l, x + PAD, y + 5 + j * LINE));
    x += c.width;
  });
  y += headH;

  // One row per record.
  ctx.font = `14px ${FONT}`;
  rows.forEach((_, ri) => {
    let cx = x0;
    columns.forEach((c, ci) => {
      box(cx, y, c.width, rowH[ri]);
      ctx.fillStyle = '#000000';
      ctx.textAlign = c.align ?? 'left';
      const tx = c.align === 'right' ? cx + c.width - PAD : cx + PAD;
      cells[ri][ci].forEach((l, j) => ctx.fillText(l, tx, y + 5 + j * LINE));
      cx += c.width;
    });
    y += rowH[ri];
  });
  if (!rows.length) {
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText(empty, x0 + tableW / 2, y + 12);
    box(x0, y, tableW, emptyH);
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be made.'))), 'image/png'));
}

/** Download the picture, and put it on the clipboard for WhatsApp or an email. True when copied. */
export async function shareImage(blob: Blob, filename: string): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }
  } catch { /* the download is enough */ }
  return false;
}
