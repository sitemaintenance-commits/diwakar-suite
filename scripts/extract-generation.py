"""Build the O&M generation import file from the nine monthly workbooks.

Output is the array form import_om_generation accepts:
    [{ "date": "2026-01-01", "site": "Sadas", "generation": 10123.0,
       "insolation": 5.96 }, ...]

Generation comes from the per-plant tabs, summed across the inverter rows.
Insolation comes from the Insolation tab, which exists from March onward;
January and February have none, so those rows carry no insolation and PR
will read blank for them rather than wrong.

There is no per-day outage history in these files -- the per-day Remarks
columns hold inverter health ("OK" / "Need to Check"), not downtime -- so
outage is left out entirely.
"""
import sys, os, json, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx import Xlsx, col_index

BASE = os.environ.get('SHEETS_DIR') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'sheets')
OUT = os.environ.get('OUT_FILE') or os.path.join(os.getcwd(), 'om-generation-import.json')

FILES = [
    ('Sites DC Load Jan 2026.xlsx',  2026, 1),
    ('Sites DC Load Feb 2026.xlsx',  2026, 2),
    ('Sites DC Load Mar 2026.xlsx',  2026, 3),
    ('Sites DC Load Apr 2026.xlsx',  2026, 4),
    ('Sites DC Load May 2026.xlsx',  2026, 5),
    ('Sites DC Load June 2026.xlsx', 2026, 6),
    ('Sites DC Load July 2026.xlsx', 2026, 7),
    ('Sites DC Load Aug 2026.xlsx',  2026, 8),
    ('Sites DC Load Sept 2026.xlsx', 2026, 9),
]

SKIP = {'master', 'daily report', 'insolation', 'monthly', 'monthly report',
        'sheet1', 'overall', 'shutdown'}

# The twelve plants as the site register spells them.
PLANTS = ['Bassi', 'Bhojusar', 'Budhwara', 'Budsu', 'Ganeshgarh', 'Indo Ka Bas',
          'Jerthi', 'Kadel', 'Niwai', 'Sadas', 'Suaap', 'Thikariya']
ALIAS = {'swap': 'Suaap'}          # Jan and Feb spell Suaap as Swap
EPOCH = datetime.date(2026, 1, 1)  # Excel serial 46023
SERIAL0 = 46023


def canon(label):
    """Map a tab or column label onto a register plant name, or None."""
    s = str(label or '').strip()
    if not s:
        return None
    if s.lower() in ALIAS:
        return ALIAS[s.lower()]
    low = s.lower()
    for p in PLANTS:
        if low.startswith(p.lower()):
            return p
    return None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


notes = []
gen = {}          # (site, iso) -> kwh
ins = {}          # (site, iso) -> insolation
unknown = collections.Counter()
problems = []

for fname, year, month in FILES:
    path = os.path.join(BASE, fname)
    if not os.path.exists(path):
        problems.append(f'MISSING FILE: {fname}')
        continue
    x = Xlsx(path)
    sheets = dict(x.sheets)
    dim = (datetime.date(year + (month == 12), (month % 12) + 1, 1)
           - datetime.timedelta(days=1)).day

    # ---- generation, from the per-plant tabs
    for tab, target in x.sheets:
        raw = tab.strip()
        if raw.lower() in SKIP:
            continue
        site = canon(raw)
        if site is None:
            unknown[raw] += 1
            continue
        g = x.grid(target)

        per_row = collections.Counter()
        for r, cells in g.items():
            for c, (v, f) in cells.items():
                if str(v or '').strip().lower().startswith('inverter generat'):
                    per_row[r] += 1
        if not per_row:
            problems.append(f'{fname} / {raw}: no day headers')
            continue
        hdr_row = per_row.most_common(1)[0][0]
        day_cols = [c for c, (v, f) in sorted(g[hdr_row].items(), key=lambda kv: col_index(kv[0]))
                    if str(v or '').strip().lower().startswith('inverter generat')]
        total_row = next((r for r in sorted(g) if r > hdr_row
                          and str((g[r].get('A') or (None,))[0] or '').strip().lower() == 'total'), None)
        if total_row is None:
            problems.append(f'{fname} / {raw}: no Total row')
            continue
        inv_rows = [r for r in range(hdr_row + 1, total_row)
                    if str((g.get(r, {}).get('A') or ('',))[0] or '').lower().startswith('inverter')]
        if not inv_rows:
            problems.append(f'{fname} / {raw}: no inverter rows')
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

    # ---- insolation, from the Insolation tab where it exists
    itab = next((t for t in sheets if t.strip().lower() == 'insolation'), None)
    if itab:
        g = x.grid(sheets[itab])
        hdr_row = next((r for r in sorted(g)
                        if any(canon(v[0]) for v in g[r].values())), None)
        if hdr_row is None:
            problems.append(f'{fname} / Insolation: no recognisable site header row')
        else:
            colmap = {c: canon(v[0]) for c, v in g[hdr_row].items() if canon(v[0])}
            dated = [r for r in sorted(g) if r > hdr_row
                     and num((g[r].get('A') or (None,))[0]) is not None]
            # March and April carry a monthly-average reference table here, not a
            # daily grid: a dozen rows, each dated the same day of a different
            # month. A real daily grid has one row per day.
            if len(dated) < 20:
                notes.append(f'{fname} / Insolation: {len(dated)} dated rows - '
                             f'monthly averages, not daily readings; skipped')
            else:
                # The dates, not the file name, say which month this covers:
                # each workbook's Insolation tab holds the previous month.
                for r in dated:
                    serial = num(g[r]['A'][0])
                    day = EPOCH + datetime.timedelta(days=int(serial) - SERIAL0)
                    for c, site in colmap.items():
                        v = num((g[r].get(c) or (None,))[0])
                        if v is not None and v > 0:
                            ins[(site, day.isoformat())] = round(v, 3)

payload = []
for (site, iso), kwh in sorted(gen.items(), key=lambda kv: (kv[0][1], kv[0][0])):
    row = {'date': iso, 'site': site, 'generation': kwh}
    if (site, iso) in ins:
        row['insolation'] = ins[(site, iso)]
    payload.append(row)

json.dump(payload, open(OUT, 'w'), indent=0)

with_ins = sum(1 for r in payload if 'insolation' in r)
print(f'written: {OUT}')
print(f'  readings        {len(payload):,}')
print(f'  with insolation {with_ins:,}  ({with_ins/len(payload)*100:.0f}%)')
print(f'  plants          {len({r["site"] for r in payload})}')
print(f'  range           {payload[0]["date"]} .. {payload[-1]["date"]}')
print(f'  file size       {os.path.getsize(OUT)/1024:.0f} KB')

LEGACY = {'2026-01': 2408, '2026-02': 2938, '2026-03': 3670, '2026-04': 4940,
          '2026-05': 6160, '2026-06': 5797, '2026-07': 4959, '2026-08': 4933,
          '2026-09': 3871}
bym = collections.Counter()
nmo = collections.Counter()
imo = collections.Counter()
for r in payload:
    bym[r['date'][:7]] += r['generation']
    nmo[r['date'][:7]] += 1
    if 'insolation' in r:
        imo[r['date'][:7]] += 1

print('\n  month      sheets      legacy      diff   readings  w/inso')
tot = 0.0
for m in sorted(bym):
    tot += bym[m]
    lg = LEGACY.get(m, 0)
    d = (bym[m] / 1000 - lg) / lg * 100 if lg else 0
    print(f'  {m} {bym[m]/1000:10,.1f} {lg:10,} {d:+8.1f}% {nmo[m]:9,} {imo[m]:7,}')
print(f'  TOTAL     {tot/1000:10,.1f} {sum(LEGACY.values()):10,} '
      f'{(tot/1000 - sum(LEGACY.values()))/sum(LEGACY.values())*100:+8.1f}% {len(payload):9,} {with_ins:7,}')

if unknown:
    print('\nUNRECOGNISED TABS (not imported):')
    for t, n in unknown.most_common():
        print(f'  {t}  (in {n} file(s))')
if problems:
    print('\nPROBLEMS:')
    for p in problems:
        print('  -', p)
