// Build the O&M history import from BOTH legacy sources.
//
//   node scripts/om-history.mjs <o&m-crm-export.json> [sheets-dir]
//
// The office workbooks ("Sites DC Load <Month> 2026.xlsx") and the live O&M
// CRM disagree on a few dozen plant-days, and each is right about different
// things:
//
//   * generation -- the workbooks. The live app's 31 July is a copy of 2 July
//     for every plant, it holds 0 where the workbooks have a reading (Budhwara
//     6 Aug, Suaap and Bhojusar 17 Sep), and it carries a dozen single-cell
//     typos the workbooks do not.
//   * insolation, outage times and remarks -- the live app. The workbooks'
//     Daily Report tabs have copied date headings and shifted columns, and
//     cannot be dated reliably.
//
// So each plant-day takes its generation from the workbook where it has one
// and from the app otherwise, and everything else from the app (insolation
// falls back to the workbook's Insolation tab). Days after the workbooks stop
// come from the app alone.
//
// Writes, next to the export:
//   om-history-import.json       the payload for Administration -> Data Import
//   om-history-differences.csv   every plant-day where the two disagreed, and
//                                which value was used, for the O&M head
//
// Generation is read the way scripts/extract-generation.py does: the Master
// tab is dated (column A), so it is the source of truth; plant tabs are used
// only for a plant the Master tab could not date (January), and only when the
// tab has a column for every day of the month.
import ExcelJS from 'exceljs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [exportPath, sheetsArg] = process.argv.slice(2);
if (!exportPath) {
  console.error('usage: node scripts/om-history.mjs <o&m-crm-export.json> [sheets-dir]');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = sheetsArg ?? join(root, '..', 'sheets');
const OUT_DIR = dirname(exportPath);

const FILES = [['Jan', 1], ['Feb', 2], ['Mar', 3], ['Apr', 4], ['May', 5], ['June', 6], ['July', 7], ['Aug', 8], ['Sept', 9]];
const YEAR = 2026;
const PLANTS = ['Bassi', 'Bhojusar', 'Budhwara', 'Budsu', 'Ganeshgarh', 'Indo Ka Bas', 'Jerthi', 'Kadel', 'Niwai', 'Sadas', 'Suaap', 'Thikariya'];
const ALIAS = { swap: 'Suaap', badsu: 'Budsu' };
const SUMMARY = new Set(['master', 'daily report', 'insolation', 'monthly', 'monthly report', 'sheet1', 'overall', 'shutdown']);
const MAX_INSOLATION = 9; // app.max_insolation(); the importer drops anything above it

function canon(label) {
  const s = String(label ?? '').trim().toLowerCase();
  if (!s) return null;
  if (ALIAS[s]) return ALIAS[s];
  return PLANTS.find((p) => s.startsWith(p.toLowerCase())) ?? null;
}
function cached(cell) {
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map((t) => t.text).join('');
    else if ('formula' in v || 'sharedFormula' in v || 'error' in v) v = null;
  }
  return v ?? null;
}
const num = (v) => (typeof v === 'number' ? v : v === null || String(v).trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
function isoOf(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = num(v);
  if (n === null || n < 40000 || n > 60000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10);
}
const pad = (n) => String(n).padStart(2, '0');
const daysIn = (m) => new Date(Date.UTC(YEAR, m, 0)).getUTCDate();

// ---------------------------------------------------------------- workbooks
const sheetGen = new Map(); // "Plant|YYYY-MM-DD" -> kWh
const sheetIns = new Map();
const notes = [];

for (const [label, month] of FILES) {
  const file = join(SHEETS, `Sites DC Load ${label} ${YEAR}.xlsx`);
  if (!existsSync(file)) { notes.push(`missing workbook: ${file}`); continue; }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const tab = (name) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === name);
  const inMonth = (iso) => iso && iso.startsWith(`${YEAR}-${pad(month)}-`);

  // Master tab: a header row naming at least three plants, then one dated row per day.
  const covered = new Set();
  const master = tab('master');
  if (master) {
    let hdr = null;
    for (let r = 1; r <= 10 && !hdr; r++) {
      const cols = {};
      master.getRow(r).eachCell((c, col) => { const p = canon(cached(c)); if (p) cols[col] = p; });
      if (Object.keys(cols).length >= 3) hdr = { r, cols };
    }
    if (hdr) {
      master.eachRow((row, r) => {
        if (r <= hdr.r) return;
        const iso = isoOf(cached(row.getCell(1)));
        if (!inMonth(iso)) return;
        for (const [col, plant] of Object.entries(hdr.cols)) {
          const kwh = num(cached(row.getCell(Number(col))));
          if (kwh > 0) { sheetGen.set(`${plant}|${iso}`, Math.round(kwh * 1000) / 1000); covered.add(plant); }
        }
      });
    }
  }

  // Plant tabs, only for plants the Master tab could not date.
  for (const ws of wb.worksheets) {
    const raw = ws.name.trim();
    if (SUMMARY.has(raw.toLowerCase())) continue;
    const plant = canon(raw);
    if (!plant || covered.has(plant)) continue;
    const perRow = new Map();
    ws.eachRow((row, r) => row.eachCell((c) => {
      if (String(cached(c) ?? '').trim().toLowerCase().startsWith('inverter generat')) perRow.set(r, (perRow.get(r) ?? 0) + 1);
    }));
    if (!perRow.size) { notes.push(`${label} / ${raw}: no day headers`); continue; }
    const hdrRow = [...perRow.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const dayCols = [];
    ws.getRow(hdrRow).eachCell((c, col) => {
      if (String(cached(c) ?? '').trim().toLowerCase().startsWith('inverter generat')) dayCols.push(col);
    });
    let totalRow = null;
    for (let r = hdrRow + 1; r <= ws.rowCount && !totalRow; r++)
      if (String(cached(ws.getCell(r, 1)) ?? '').trim().toLowerCase() === 'total') totalRow = r;
    if (!totalRow) { notes.push(`${label} / ${raw}: no Total row`); continue; }
    const invRows = [];
    for (let r = hdrRow + 1; r < totalRow; r++)
      if (String(cached(ws.getCell(r, 1)) ?? '').toLowerCase().startsWith('inverter')) invRows.push(r);
    const dim = daysIn(month);
    if (dayCols.length < dim) {
      notes.push(`${label} / ${raw}: only ${dayCols.length} of ${dim} day columns and no dated Master row — skipped rather than guessed`);
      continue;
    }
    dayCols.slice(0, dim).forEach((col, i) => {
      let tot = 0, seen = 0;
      for (const r of invRows) { const v = num(cached(ws.getCell(r, col))); if (v > 0) { tot += v; seen++; } }
      if (seen) sheetGen.set(`${plant}|${YEAR}-${pad(month)}-${pad(i + 1)}`, Math.round(tot * 1000) / 1000);
    });
  }

  // Insolation tab: dated rows; a date outside the file's month is a stale
  // copy (September's tab carries August's dates) and is ignored.
  const ins = tab('insolation');
  if (ins) {
    let hdr = null;
    for (let r = 1; r <= 10 && !hdr; r++) {
      const cols = {};
      ins.getRow(r).eachCell((c, col) => { const p = canon(cached(c)); if (p) cols[col] = p; });
      if (Object.keys(cols).length >= 3) hdr = { r, cols };
    }
    let stale = 0;
    if (hdr) ins.eachRow((row, r) => {
      if (r <= hdr.r) return;
      const iso = isoOf(cached(row.getCell(1)));
      if (!iso) return;
      if (!inMonth(iso)) { stale++; return; }
      for (const [col, plant] of Object.entries(hdr.cols)) {
        const v = num(cached(row.getCell(Number(col))));
        if (v > 0 && v <= MAX_INSOLATION) sheetIns.set(`${plant}|${iso}`, v);
      }
    });
    if (stale) notes.push(`${label} / Insolation: ${stale} row(s) dated outside ${label} ignored`);
  }
}

// ---------------------------------------------------------------- the app
const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
const app = new Map();
for (const [date, rows] of Object.entries(exported.reports ?? {})) {
  for (const r of rows) {
    const plant = canon(r.short) ?? canon(r.site);
    if (plant) app.set(`${plant}|${date}`, r);
  }
}

// ---------------------------------------------------------------- merge
const keys = [...new Set([...sheetGen.keys(), ...app.keys()])].sort((a, b) => {
  const [pa, da] = a.split('|'); const [pb, db] = b.split('|');
  return da.localeCompare(db) || pa.localeCompare(pb);
});
const reports = {};
const diffs = [];
const byMonth = {};
let fromSheet = 0, fromApp = 0, sheetOnly = 0;
for (const key of keys) {
  const [plant, date] = key.split('|');
  const a = app.get(key);
  const appKwh = num(a?.generation) ?? 0;
  const sheetKwh = sheetGen.get(key);
  let generation, source;
  if (sheetKwh > 0) { generation = sheetKwh; source = 'workbook'; fromSheet++; }
  else { generation = appKwh; source = 'app'; if (appKwh > 0) fromApp++; }
  if (sheetKwh > 0 && !a) sheetOnly++;
  else if (sheetKwh > 0 && Math.abs(sheetKwh - appKwh) > 1) {
    diffs.push([plant, date, sheetKwh, appKwh, generation, appKwh === 0 ? 'app has 0' : 'values differ']);
  }
  const appIns = num(a?.insolation);
  const insolation = appIns > 0 && appIns <= MAX_INSOLATION ? appIns : sheetIns.get(key) ?? (appIns > 0 ? appIns : '');
  const outage = String(a?.outage ?? '').trim();
  const remarks = String(a?.remarks ?? '').trim();
  // No energy and no outage written: nothing to record (a plant not yet
  // commissioned, or a day nobody filled in).
  if (!(generation > 0) && (!outage || /^(no|nil|none|na|n\/a|-)$/i.test(outage))) continue;
  (reports[date] ??= []).push({ short: plant, generation, insolation, outage, remarks, source });
  if (generation > 0) byMonth[date.slice(0, 7)] = (byMonth[date.slice(0, 7)] ?? 0) + generation;
}

const payloadPath = join(OUT_DIR, 'om-history-import.json');
const diffPath = join(OUT_DIR, 'om-history-differences.csv');
writeFileSync(payloadPath, JSON.stringify({ reports }));
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(diffPath, '﻿' + [['Plant', 'Date', 'Workbook kWh', 'App kWh', 'Used kWh', 'Why'], ...diffs]
  .map((r) => r.map(csv).join(',')).join('\r\n'));

const readings = Object.values(reports).reduce((n, r) => n + r.filter((x) => x.generation > 0).length, 0);
console.log(`workbook readings ${sheetGen.size}, app plant-days ${app.size}`);
console.log(`merged: ${readings} readings (${fromSheet} generation from the workbooks, ${fromApp} from the app alone)`);
console.log(`plant-days where the two disagreed: ${diffs.length} (the workbook value was used; see the CSV)`);
console.log(`plant-days only in the workbooks: ${sheetOnly}`);
console.log('\n  month        MWh');
let total = 0;
for (const m of Object.keys(byMonth).sort()) { total += byMonth[m]; console.log(`  ${m} ${(byMonth[m] / 1000).toFixed(1).padStart(10)}`); }
console.log(`  total   ${(total / 1000).toFixed(1).padStart(10)}`);
console.log(`\nwritten: ${payloadPath}\n         ${diffPath}`);
if (notes.length) console.log('\nnotes:\n  - ' + notes.join('\n  - '));
