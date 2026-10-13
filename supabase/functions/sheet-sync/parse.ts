// Parsing the technicians' Google Form sheet (one tab a month). No Deno or
// network code here, so it can be tested on its own.

export interface SheetTab { gid: string; name: string }
export interface Window { kind: 'grid' | 'plant'; from: string; to: string }
export interface SheetRow {
  site: string;
  date: string;               // YYYY-MM-DD
  submitted_at: string | null; // ISO, India time
  readings: { label: string; kwh: number }[];
  total: number | null;
  had_failure: boolean | null;
  side: 'gss' | 'plant' | null;
  windows: Window[];
  timing: string | null;
  reason: string | null;
  weather: string | null;
}

/** The tabs of a spreadsheet, newest first, read from its page. */
export function parseTabs(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  const re = /\[(\d+),0,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"([^\\]+)/g;
  for (const m of html.matchAll(re)) tabs.push({ gid: m[2], name: m[3] });
  return tabs;
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes and new lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const num = (s: string | undefined) => {
  const t = (s ?? '').replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** "Budhwara, Pisangan – 4.340 MW" -> "Budhwara". */
export function siteKey(s: string) {
  return s.split(/,|\s[-–—]\s/)[0].trim();
}

/** dd/mm/yyyy -> yyyy-mm-dd */
function isoDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** "01/10/2026 08:46:00" (India time) -> ISO */
function isoStamp(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}+05:30`;
}

/**
 * Free-text failure timing to windows: "4:04pm to 4:35pm",
 * "7.56-8.00am,2.01-2.04pm", "10:39 AM to 11:20 AM or 02:03 PM to 2:37 PM".
 * Times come in pairs; a time without am/pm takes its partner's. Anything
 * that does not read cleanly gives no windows (the text is kept instead).
 */
export function parseTiming(text: string | null, kind: 'grid' | 'plant'): Window[] {
  if (!text) return [];
  const t = text.toLowerCase().replace(/(\d)\.(\d{2})/g, '$1:$2');
  const tokens = [...t.matchAll(/(\d{1,2}):\s?(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/g)]
    .map((m) => ({ h: Number(m[1]), min: Number(m[2]), ap: m[3] ? m[3][0] : null as string | null }));
  if (!tokens.length || tokens.length % 2) return [];
  const out: Window[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const a = tokens[i], b = tokens[i + 1];
    const apA = a.ap ?? b.ap, apB = b.ap ?? a.ap;
    const to24 = (h: number, ap: string | null) => (ap === 'p' && h < 12 ? h + 12 : ap === 'a' && h === 12 ? 0 : h);
    const fromM = to24(a.h, apA) * 60 + a.min;
    const toM = to24(b.h, apB) * 60 + b.min;
    if (a.min > 59 || b.min > 59 || fromM >= 24 * 60 || toM >= 24 * 60 || toM <= fromM || toM - fromM > 14 * 60) return [];
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push({ kind, from: hhmm(fromM), to: hhmm(toM) });
  }
  return out;
}

/** One tab's rows, keeping the latest answer for each site and day. */
export function parseSheet(csv: string): SheetRow[] {
  const rows = parseCsv(csv);
  const h = rows.findIndex((r) => norm(r[0] ?? '') === 'timestamp');
  if (h < 0) return [];
  const head = rows[h].map(norm);
  const col = (...names: string[]) => head.findIndex((x) => names.some((n) => x.startsWith(n)));
  const cDate = col('date'), cSite = col('site name', 'site'), cTotal = col('total generation', 'total');
  const cFail = col('any grid / plant failure', 'any grid', 'any failure');
  const cSide = col('failure / shutdown from which side', 'failure / shutdown', 'which side');
  const cTiming = col('failure timing'), cReason = col('failure reason'), cWeather = col('weather');
  const invCols = head.map((x, i) => [x, i] as const).filter(([x]) => /^inv[-\s]?\d+/.test(x));

  const latest = new Map<string, SheetRow>();
  for (const r of rows.slice(h + 1)) {
    const date = isoDate(r[cDate] ?? '') ?? isoDate(r[0] ?? '');
    const siteRaw = (r[cSite] ?? '').trim();
    if (!date || !siteRaw) continue;
    const failText = norm(r[cFail] ?? '');
    const had_failure = failText.startsWith('y') ? true : failText.startsWith('n') ? false : null;
    const sideText = norm(r[cSide] ?? '');
    const side = sideText.includes('plant') ? 'plant' : sideText.includes('gss') || sideText.includes('grid') ? 'gss' : null;
    const timing = (r[cTiming] ?? '').trim();
    const timingUseful = timing && !/^(no|nil|none|na|n\/a|-)$/i.test(timing) ? timing : null;
    const reason = (r[cReason] ?? '').trim();
    const row: SheetRow = {
      site: siteKey(siteRaw),
      date,
      submitted_at: isoStamp(r[0] ?? ''),
      readings: invCols.map(([x, i]) => ({ label: x.toUpperCase().replace(/\s+/g, ''), kwh: num(r[i]) }))
        .filter((x): x is { label: string; kwh: number } => x.kwh !== null),
      total: num(r[cTotal]),
      had_failure,
      side,
      windows: had_failure ? parseTiming(timingUseful, side === 'plant' ? 'plant' : 'grid') : [],
      timing: timingUseful,
      reason: reason && !/^(no|nil|none|na|n\/a|-)$/i.test(reason) ? reason : null,
      weather: (r[cWeather] ?? '').trim() || null,
    };
    const key = `${row.site.toLowerCase()}|${row.date}`;
    const prev = latest.get(key);
    if (!prev || (row.submitted_at ?? '') >= (prev.submitted_at ?? '')) latest.set(key, row);
  }
  return [...latest.values()];
}

export interface InsolationRow { site: string; date: string; insolation: number }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * The office report's Insolation tab: "INSOLATION DATA - OCTOBER 2026",
 * a row of site names, then one row a day with each site's insolation.
 * The month comes from the title -- the date cells keep an old month when
 * the tab is copied forward -- and the day from the date cell.
 */
export function parseInsolation(csv: string): InsolationRow[] {
  const rows = parseCsv(csv);
  let month = -1, year = 0;
  for (const r of rows.slice(0, 5)) {
    const m = /insolation data\s*[-–]\s*([a-z]+)\s+(\d{4})/i.exec((r[0] ?? '').trim());
    if (m) {
      month = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
      year = Number(m[2]);
    }
  }
  const h = rows.findIndex((r) => /^site name/i.test((r[0] ?? '').trim()));
  if (month < 0 || h < 0) return [];
  const sites = rows[h].map((s, i) => (i === 0 ? '' : s.split(/,|\s*[-–—]\s*/)[0].trim()));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: InsolationRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const d = /^(\d{1,2})[/\-.]/.exec((r[0] ?? '').trim());
    if (!d) continue;
    const day = Number(d[1]);
    if (day < 1 || day > daysInMonth) continue;
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    for (let i = 1; i < r.length; i++) {
      const v = num(r[i]);
      if (sites[i] && v !== null && v > 0) out.push({ site: sites[i], date, insolation: v });
    }
  }
  return out;
}

export interface ProjectUpdateRow {
  site: string;
  date: string;
  submitted_at: string | null;
  engineer: string | null;
  fronts: Record<string, string | null>;
  work: string | null;
  challenges: string | null;
  remarks: string | null;
}

const WORK_STATUS = (s: string | undefined): string | null => {
  const t = norm(s ?? '');
  if (!t) return null;
  if (t.startsWith('complete') || t === 'done') return 'completed';
  if (t.startsWith('in progress') || t.startsWith('ongoing') || t.startsWith('on going') || t.startsWith('wip')) return 'in_progress';
  if (t.startsWith('not started') || t.startsWith('pending')) return 'not_started';
  if (t.startsWith('hold') || t.startsWith('on hold')) return 'on_hold';
  return null;
};
const nothing = (s: string | undefined) => {
  const t = (s ?? '').trim();
  return !t || /^(no|nil|none|na|n\/a|-|\.)$/i.test(t) ? null : t;
};

/**
 * The projects team's Google Form sheet: one answer a row -- date, site,
 * engineer, the status of each work front, today's work, challenges and
 * remarks. Keeps the latest answer for each site and day.
 */
export function parseProjectSheet(csv: string): ProjectUpdateRow[] {
  const rows = parseCsv(csv);
  const h = rows.findIndex((r) => norm(r[0] ?? '') === 'timestamp');
  if (h < 0) return [];
  const head = rows[h].map(norm);
  // The first column whose heading contains the words (the sheet has a duplicated "Electrical Panel" column).
  const col = (...words: string[]) => head.findIndex((x) => words.every((w) => x.includes(w)));
  const c = {
    date: head.findIndex((x) => x === 'date' || x.startsWith('date')), site: col('site name'), engineer: col('engineer'),
    tl_work: col('tl work'), gss_bay: col('gss bay'), piling: col('piling'), icr_civil: col('icr'),
    panel: col('panel'), module_work: col('solar module'), inverter: col('inverter'), material: col('material'),
    cabling: col('cabling'), electrical: col('electrical connection'),
    work: col('work description'), challenges: col('challenges'), remarks: col('remarks'),
  };
  const fronts = ['tl_work', 'gss_bay', 'piling', 'icr_civil', 'panel', 'module_work', 'inverter', 'material', 'cabling', 'electrical'] as const;
  const latest = new Map<string, ProjectUpdateRow>();
  for (const r of rows.slice(h + 1)) {
    const date = isoDate(r[c.date] ?? '') ?? isoDate(r[0] ?? '');
    const siteRaw = (r[c.site] ?? '').trim();
    if (!date || !siteRaw) continue;
    const row: ProjectUpdateRow = {
      site: siteKey(siteRaw),
      date,
      submitted_at: isoStamp(r[0] ?? ''),
      engineer: (r[c.engineer] ?? '').trim().replace(/\b\w/g, (x) => x.toUpperCase()) || null,
      fronts: Object.fromEntries(fronts.map((k) => [k, c[k] >= 0 ? WORK_STATUS(r[c[k]]) : null])),
      work: nothing(r[c.work]),
      challenges: nothing(r[c.challenges]),
      remarks: nothing(r[c.remarks]),
    };
    const key = `${row.site.toLowerCase()}|${row.date}`;
    const prev = latest.get(key);
    if (!prev || (row.submitted_at ?? '') >= (prev.submitted_at ?? '')) latest.set(key, row);
  }
  return [...latest.values()];
}

export interface TechScoreRow {
  site: string;
  date: string;
  submitted_at: string | null;
  technician: string;
  attendance: number;
  daily_work: number;
  task_assigned: number;
  task_status: string | null;
  form_submit: number;
  monthly_review: number | null;
  remarks: string | null;
}

/**
 * The technicians' daily work tracker: one answer a row, scored as the O&M
 * CRM did -- Present 20 (half day 10), any work written 25, task assigned
 * "Yes" 10, form submitted "Yes" 25, and the monthly 20 if filled in the
 * sheet. Keeps the latest answer per technician, site and day.
 */
export function parseTechScores(csv: string): TechScoreRow[] {
  const rows = parseCsv(csv);
  const h = rows.findIndex((r) => norm(r[0] ?? '') === 'timestamp');
  if (h < 0) return [];
  const head = rows[h].map(norm);
  const col = (...words: string[]) => head.findIndex((x) => words.every((w) => x.includes(w)));
  const c = {
    tech: col('technician'), date: head.findIndex((x) => x === 'date' || x.startsWith('date')), site: col('site'),
    attendance: col('attendance'), work: col('daily work'), task: col('task assigned', 'marks'),
    status: col('status'), form: col('form submission'), remarks: col('remarks'), monthly: col('monthly score'),
  };
  if (c.task < 0) c.task = col('task assigned');
  const yes = (s: string | undefined) => norm(s ?? '').startsWith('y');
  const latest = new Map<string, TechScoreRow>();
  for (const r of rows.slice(h + 1)) {
    const date = isoDate(r[c.date] ?? '') ?? isoDate(r[0] ?? '');
    const siteRaw = (r[c.site] ?? '').trim();
    const tech = (r[c.tech] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || !siteRaw || !tech) continue;
    const att = norm(r[c.attendance] ?? '');
    const monthly = num(r[c.monthly]);
    const row: TechScoreRow = {
      site: siteKey(siteRaw),
      date,
      submitted_at: isoStamp(r[0] ?? ''),
      technician: tech,
      attendance: att.startsWith('present') ? 20 : att.includes('half') ? 10 : 0,
      daily_work: (r[c.work] ?? '').trim() ? 25 : 0,
      task_assigned: yes(r[c.task]) ? 10 : 0,
      task_status: (r[c.status] ?? '').trim() || null,
      form_submit: yes(r[c.form]) ? 25 : 0,
      monthly_review: monthly !== null && monthly >= 0 && monthly <= 20 ? Math.round(monthly) : null,
      remarks: nothing(r[c.remarks]),
    };
    const key = `${row.site.toLowerCase()}|${row.date}|${row.technician.toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || (row.submitted_at ?? '') >= (prev.submitted_at ?? '')) latest.set(key, row);
  }
  return [...latest.values()];
}
