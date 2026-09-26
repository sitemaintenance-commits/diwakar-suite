"""Daily plant generation, dated from the Master tab.

The per-plant tabs cannot be dated reliably. They carry one block of
columns per day with no date on them, so the only way to date a reading
is to count from the first block -- and that is wrong whenever a plant
started partway through the month. Kadel's sixteen April columns are the
15th to the 30th, not the 1st to the 16th.

The Master tab has what the plant tabs lack: a real date in column A,
cached, one row per day, with a column per plant. So Master is the source
of truth for everything February onward.

January's Master holds uncalculated TRANSPOSE formulas for most plants,
so January falls back to the plant tabs -- safe there, because every
January plant except Indo Ka Bas has a full 31 columns, and Indo Ka Bas
is the one plant January's Master did cache.
"""
import sys, os, json, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx import Xlsx, col_index

BASE = os.environ.get('SHEETS_DIR') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'sheets')
OUT = os.environ.get('OUT_FILE') or os.path.join(os.getcwd(), 'om-generation-import.json')

FILES = [('Sites DC Load Jan 2026.xlsx', 2026, 1), ('Sites DC Load Feb 2026.xlsx', 2026, 2),
         ('Sites DC Load Mar 2026.xlsx', 2026, 3), ('Sites DC Load Apr 2026.xlsx', 2026, 4),
         ('Sites DC Load May 2026.xlsx', 2026, 5), ('Sites DC Load June 2026.xlsx', 2026, 6),
         ('Sites DC Load July 2026.xlsx', 2026, 7), ('Sites DC Load Aug 2026.xlsx', 2026, 8),
         ('Sites DC Load Sept 2026.xlsx', 2026, 9)]

PLANTS = ['Bassi', 'Bhojusar', 'Budhwara', 'Budsu', 'Ganeshgarh', 'Indo Ka Bas',
          'Jerthi', 'Kadel', 'Niwai', 'Sadas', 'Suaap', 'Thikariya']
ALIAS = {'swap': 'Suaap', 'badsu': 'Budsu'}
SUMMARY = {'master', 'daily report', 'insolation', 'monthly', 'monthly report',
           'sheet1', 'overall', 'shutdown'}
EPOCH = datetime.date(2026, 1, 1); S0 = 46023


def canon(label):
    s = str(label or '').strip()
    if not s:
        return None
    if s.lower() in ALIAS:
        return ALIAS[s.lower()]
    for p in PLANTS:
        if s.lower().startswith(p.lower()):
            return p
    return None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


gen, ins, notes = {}, {}, []
src = collections.Counter()

for fname, year, month in FILES:
    path = os.path.join(BASE, fname)
    if not os.path.exists(path):
        notes.append(f'MISSING FILE: {fname}')
        continue
    x = Xlsx(path)
    sheets = dict(x.sheets)
    dim = (datetime.date(year + (month == 12), (month % 12) + 1, 1)
           - datetime.timedelta(days=1)).day

    # ---------- Master: dated, authoritative
    covered = set()
    mt = next((t for t in sheets if t.strip().lower() == 'master'), None)
    if mt:
        g = x.grid(sheets[mt])
        hdr = next((r for r in sorted(g)[:10]
                    if sum(1 for v in g[r].values() if canon(v[0])) >= 3), None)
        if hdr is not None:
            cols = {c: canon(v[0]) for c, v in g[hdr].items() if canon(v[0])}
            for r in sorted(g):
                if r <= hdr:
                    continue
                s = num((g[r].get('A') or (None,))[0])
                if s is None:
                    continue
                d = EPOCH + datetime.timedelta(days=int(s) - S0)
                if d.year != year or d.month != month:
                    continue
                for c, site in cols.items():
                    v = num((g[r].get(c) or (None,))[0])
                    if v is not None and v > 0:
                        gen[(site, d.isoformat())] = round(v, 3)
                        covered.add(site)
                        src[f'{month:02d}-master'] += 1

    # ---------- plant tabs, only for plants Master could not date
    for tab, target in x.sheets:
        raw = tab.strip()
        if raw.lower() in SUMMARY:
            continue
        site = canon(raw)
        if site is None or site in covered:
            continue
        g = x.grid(target)
        per = collections.Counter()
        for r, cells in g.items():
            for c, (v, f) in cells.items():
                if str(v or '').strip().lower().startswith('inverter generat'):
                    per[r] += 1
        if not per:
            notes.append(f'{fname} / {raw}: no day headers')
            continue
        hdr_row = per.most_common(1)[0][0]
        day_cols = [c for c, (v, f) in sorted(g[hdr_row].items(), key=lambda kv: col_index(kv[0]))
                    if str(v or '').strip().lower().startswith('inverter generat')]
        total_row = next((r for r in sorted(g) if r > hdr_row
                          and str((g[r].get('A') or (None,))[0] or '').strip().lower() == 'total'), None)
        if total_row is None:
            notes.append(f'{fname} / {raw}: no Total row')
            continue
        inv_rows = [r for r in range(hdr_row + 1, total_row)
                    if str((g.get(r, {}).get('A') or ('',))[0] or '').lower().startswith('inverter')]
        if len(day_cols) < dim:
            notes.append(f'{fname} / {raw}: only {len(day_cols)} of {dim} day columns and '
                         f'Master could not date it - SKIPPED rather than guess')
            continue
        for d, col in enumerate(day_cols[:dim], start=1):
            tot, seen = 0.0, 0
            for r in inv_rows:
                v = num((g.get(r, {}).get(col) or (None,))[0])
                if v is not None and v > 0:
                    tot += v
                    seen += 1
            if seen:
                gen[(site, f'{year}-{month:02d}-{d:02d}')] = round(tot, 3)
                src[f'{month:02d}-tabs'] += 1

    # ---------- insolation (dates decide the month, not the file name)
    itab = next((t for t in sheets if t.strip().lower() == 'insolation'), None)
    if itab:
        g = x.grid(sheets[itab])
        hdr = next((r for r in sorted(g) if any(canon(v[0]) for v in g[r].values())), None)
        if hdr is not None:
            cols = {c: canon(v[0]) for c, v in g[hdr].items() if canon(v[0])}
            dated = [r for r in sorted(g) if r > hdr and num((g[r].get('A') or (None,))[0]) is not None]
            if len(dated) >= 20:                      # a daily grid, not the averages table
                for r in dated:
                    d = EPOCH + datetime.timedelta(days=int(num(g[r]['A'][0])) - S0)
                    for c, site in cols.items():
                        v = num((g[r].get(c) or (None,))[0])
                        if v is not None and v > 0:
                            ins[(site, d.isoformat())] = round(v, 3)

payload = []
for (site, iso), kwh in sorted(gen.items(), key=lambda kv: (kv[0][1], kv[0][0])):
    row = {'date': iso, 'site': site, 'generation': kwh}
    if (site, iso) in ins:
        row['insolation'] = ins[(site, iso)]
    payload.append(row)

json.dump(payload, open(OUT, 'w'), indent=0)

LEGACY = {'2026-01': 2408, '2026-02': 2938, '2026-03': 3670, '2026-04': 4940,
          '2026-05': 6160, '2026-06': 5797, '2026-07': 4959, '2026-08': 4933,
          '2026-09': 3871}
bym, nmo, imo = collections.Counter(), collections.Counter(), collections.Counter()
for r in payload:
    bym[r['date'][:7]] += r['generation']
    nmo[r['date'][:7]] += 1
    if 'insolation' in r:
        imo[r['date'][:7]] += 1

print(f'written: {OUT}')
print(f'  readings {len(payload):,}   plants {len({r["site"] for r in payload})}   '
      f'range {payload[0]["date"]} .. {payload[-1]["date"]}')
print('\n  month      sheets      legacy      diff   readings  w/inso')
tot = 0.0
for m in sorted(bym):
    tot += bym[m]
    lg = LEGACY.get(m, 0)
    d = (bym[m] / 1000 - lg) / lg * 100 if lg else 0
    print(f'  {m} {bym[m]/1000:10,.1f} {lg:10,} {d:+8.1f}% {nmo[m]:9,} {imo[m]:7,}')
print(f'  TOTAL     {tot/1000:10,.1f} {sum(LEGACY.values()):10,} '
      f'{(tot/1000 - sum(LEGACY.values()))/sum(LEGACY.values())*100:+8.1f}% {len(payload):9,}')
print('\n  source of each month\'s rows:')
for k in sorted(src):
    print(f'    {k}: {src[k]}')
if notes:
    print('\nNOTES:')
    for n in notes:
        print('  -', n)
