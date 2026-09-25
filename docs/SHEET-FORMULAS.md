# The O&M spreadsheets, read formula by formula

Source: `Sites DC Load {Jan…Sept} 2026.xlsx` and `Master All Commissioned
Sites.xlsx` — the workbooks the O&M team keeps. Parsed with values *and*
formulas, so a typed number is never mistaken for a calculated one.

This file records what each column means, which of them the suite stores
and which it derives, and where the company's own files disagree.

---

## 1. Daily Report tab — the operational source of truth

| Col | Header | Kind | Formula in the sheet | In the suite |
|---|---|---|---|---|
| A | S.NO | derived | row number | not stored |
| B | SITE NAME | fixed | — | `sites.name` |
| C | DC (kWh) | fixed | — | `solar_sites.capacity_dc_kwp` |
| D | AC (kW) | fixed | — | `solar_sites.capacity_ac_kw` |
| E | **ACTUAL GEN. (kWh)** | **fixed, typed** | — | `generation_records.generation_kwh` |
| F | Tilt Angle | fixed | — | `solar_sites.tilt_degrees` |
| G | S.Y (Units/kWh) | derived | `=IFERROR(E/C,0)` | computed on read |
| H | PR (%) | derived | `=IFERROR(G/I*100,0)` | computed on read |
| I | **INSO.** | **fixed, typed** | — | `irradiation_kwh_m2` |
| J | DC CUF (%) | derived | `=IFERROR(E/(C*24)*100,0)` | computed on read |
| K | AC CUF (%) | derived | `=IFERROR(E/(D*24)*100,0)` | computed on read |
| L | **Grid Outage (Time)** | **fixed, free text** | — | parsed to `grid_outage_hrs` |
| M | **REMARKS** | **fixed** | — | `remarks` |

All four derived formulas match what the suite already computed. Nothing
had to change.

**Rule applied:** a column that is a formula in the sheet never becomes a
stored column here. It is computed at read time, so it cannot drift the
way a spreadsheet does when somebody types over a formula cell.

---

## 2. Monthly Report tab

| Col | Formula | Note |
|---|---|---|
| E | `=IFERROR(D/C,0)` | S.Y for the month |
| G | `=IFERROR((D/(F*C))*100,0)` | PR — same shape as daily |
| H | `=((D/(C*24*30))*100)` | **CUF with 30 hard-coded** |

⚠️ **The 30 is a bug.** Monthly CUF is overstated by ~3.3% for 31-day
months and understated by ~7% for February. The suite divides by the
actual number of days in the period and does not reproduce this.

Also: `IFERROR(…,0)` makes PR read **0%** when insolation is blank, which
looks like terrible performance rather than "not measured". The suite
shows *not available* instead.

---

## 3. Per-site tabs — per-inverter analysis

Each site tab holds one block of four columns per day, over a row per
inverter:

| Col | Header | Formula | Meaning |
|---|---|---|---|
| B | Total String | typed | strings on that inverter |
| C | Module In String | typed | modules per string |
| D | Module Capacity | typed | watts per module |
| E | Total DC Load (kWh) | `=C*D/1000*B` | that inverter's own kWp |
| F | Inverter Generation | typed | the reading |
| G | Generation per KW | `=F/E` | specific yield for that inverter |
| H | Generation in % | `=G/MAX(G)` | against the best inverter that day |
| I | Remarks | typed | `OK` / `Need to Check` |

**This is peer comparison, and it is the sharpest idea in the whole
workbook.** Comparing an inverter to its siblings under the same sky
cancels out the weather, so one weak string shows up even on a day when
the site total looks normal.

Now implemented as `get_inverter_analysis(site, date)` and shown on the
Daily Entry page, so the technician sees it while still on site. The
threshold lives in `app_settings` under `om.inverter_alert_threshold`
(0.85, which reproduces every flag in the September sheet).

### Configuration recovered

`site_inverters` now holds one row per inverter — 113 across 12 sites —
with its strings, modules, wattage and DC capacity.

| Site | Inverters | Σ DC (kWp) | Daily Report | Δ |
|---|---|---|---|---|
| Sadas | 7 | 2,907.3 | 2,903 | +4.3 |
| Suaap | 9 | 3,254.8 | 3,305 | **−50.2** |
| Bassi | 12 | 4,417.9 | 4,418 | −0.1 |
| Budsu | 7 | 2,439.1 | 2,438 | +1.1 |
| Niwai | 8 | 2,640.0 | 2,640 | 0.0 |
| Jerthi | 10 | 3,528.7 | 3,361 | **+167.7** |
| Indo Ka Bas | 9 | 3,274.2 | 3,274 | +0.2 |
| Ganeshgarh | 9 | 3,281.0 | 3,272 | +9.0 |
| Budhwara | 12 | 4,340.0 | 4,340 | 0.0 |
| Kadel | 9 | 3,124.8 | 3,124 | +0.8 |
| Thikariya | 12 | 4,473.0 | 4,473 | 0.0 |
| Bhojusar | 9 | 3,263.7 | 3,280 | −16.3 |

The seed previously assumed **12 inverters everywhere** and was wrong for
nine of the twelve sites — Sadas has 7, not 12.

---

## 4. Bugs found in the sheets

### Ganeshgarh's DC Load formula is missing a term

Its column E reads `=C6*B6` — modules per string × strings — and omits
`* D / 1000`, the module wattage. So it reports **588 kWp per inverter**
instead of 364.56, about 1.6× too high.

That inflates its "Generation per KW", which in turn distorts the
"Generation in %" comparison for the whole site. The suite recomputes
Ganeshgarh from the strings/modules/wattage underneath, giving 3,281 kWp
against the 3,272 the Daily Report declares.

### Values that fail their own sanity check

* An insolation of `44.77` for Niwai on 19 Sep — almost certainly `4.477`.
* An outage window of `10:18 - 02:46` — ends before it starts. Counted as
  zero rather than negative.
* Outage is free text throughout: `No`, labelled `Grid Failure :-` blocks,
  and en dashes mixed with hyphens. All handled by
  `app.parse_outage_hours`.

---

## 5. ⚠️ Capacities the company's own files disagree on

**Resolved 25 Sep 2026.** Diwakar's decision: the **Daily Report tab is
authoritative**, because it is the sheet the O&M team fills in every day
and the one the live dashboard mirrors. Applied in
`20260925000002_capacities_from_daily_report.sql` — it moved Jerthi DC
from 3,496 to **3,361** and Bhojusar AC from 2,520 to **2,475**. Every
other site already matched.

| Site | Daily Report | Monthly Report | Master file | Σ inverters | Seeded |
|---|---|---|---|---|---|
| **Jerthi DC** | **3,361** ✅ | 3,254 | 3,496 | 3,528.7 | now 3,361 |
| **Thikariya DC** | 4,473 | 4,473 | 4,327 | **4,473.0** | 4,473 |
| **Kadel AC** | 2,475 | — | 2,450 | — | 2,475 |
| **Bhojusar AC** | **2,475** ✅ | — | — | — | now 2,475 |
| **Suaap DC** | 3,305 | 3,305 | 3,305 | **3,254.8** | 3,305 |

* **Thikariya** — the inverter sum agrees exactly with 4,473, so the
  Master file's 4,327 looks like the stale one. Left as 4,473.
* **Jerthi** — four different numbers. The inverter sum (3,528.7) sits
  nearest 3,496, but the Daily Report's **3,361** is what the team works
  to, so that is what the suite now holds. Worth a physical check: if the
  ten inverters really carry 3,528.7 kWp, either a string count in the
  site tab is stale or the declared capacity is.
* **Suaap** — inverters sum 50 kWp short of the declared capacity, about
  one seventh of an inverter. Possibly one stale string count.

Jerthi's CUF, PR and specific yield moved by about 5% when this was
applied. Capacity is not stored on a reading, so the whole history
recalculated with it.

**On `expected_yield`:** there is no kWh/kWp/day figure anywhere in these
workbooks. What the company forecasts is **monthly generation in kWh per
site** (Master file, column S — Sadas Jan 339,800, Feb 370,300, and so
on). `expected_yield` is therefore not a company figure and is left
unset; none of S.Y, PR, DC CUF or AC CUF depend on it. If a "vs
forecast" view is ever wanted, the monthly forecast is the right thing to
model, being seasonal and theirs.

There is also a fourth set of numbers in the tab *titles* — "Sadas
(1.89 MW)", "Bassi (3.41 MW)" — matching neither DC nor AC. Probably
contracted or PPA capacity. Not used anywhere in the suite.

---

## 6. Commissioning dates recovered

| Site | Commissioned |
|---|---|
| Sadas | 2024-08-03 |
| Niwai | 2025-06-05 |
| Jerthi | 2025-08-28 |
| Suaap | 2025-09-30 |
| Budsu | 2025-11-17 |
| Bassi | 2025-11-29 |
| Indo Ka Bas | 2026-01-14 |
| Ganeshgarh | 2026-02-27 |

Still blank: **Budhwara, Kadel, Thikariya, Bhojusar**.

---

## 7. Monthly totals — the import target

From the Master workbook's `Monthly` tab, matching the legacy app's
Overall tab. Use these to check the history import:

| Month | Sadas | Suaap | Bassi | Budsu | Jerthi |
|---|---|---|---|---|---|
| Jan | 340,799 | 403,748 | 522,330 | 294,258 | 414,464 |
| Feb | 372,062 | 428,872 | 566,474 | 324,050 | 458,734 |
| Mar | 442,867 | 504,211 | 671,063 | 381,375 | 501,159 |
| Apr | 443,594 | 504,413 | 660,115 | 380,930 | 522,228 |
| May | 436,470 | 507,385 | 671,910 | 417,648 | 537,138 |
| Jun | 391,805 | 477,495 | 655,836 | 390,566 | 506,307 |
| Jul | 295,642 | 429,460 | 575,990 | 342,074 | 456,035 |
| Aug | 237,859 | 414,582 | 522,608 | 291,327 | 418,411 |

Portfolio total for 2026 to September: **39,673.6 MWh**.
