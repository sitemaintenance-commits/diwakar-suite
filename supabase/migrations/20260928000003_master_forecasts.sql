-- =====================================================================
-- MONTHLY FORECASTS FROM THE MASTER WORKBOOK
--
-- "Master All Commissioned Sites.xlsx" carries a forecast table on every
-- plant tab: one FORECASTED GENERATION figure per month, January to
-- December. Eight plants have it filled in -- Bassi, Suaap, Jerthi,
-- Indo Ka Bas, Sadas, Budsu, Ganeshgarh and Niwai. Budhwara, Kadel and
-- Thikariya have the table but it is empty, and Bhojusar has no tab; their
-- targets still have to come from the O&M team.
--
-- Until now only June and July were loaded, from the two review packs.
-- The July pack turned out to repeat June's targets: Bassi 611,600 in
-- both months, where the Master file forecasts 545,900 for July. Sadas
-- and Suaap carried June's figures too. So Month Review was holding July
-- against June's forecast.
--
--   * every month the Master file forecasts is added where the suite has
--     no target yet (June keeps the review pack's figure);
--   * July is corrected only where it still holds the copied value, so a
--     target somebody has since typed in is left alone.
-- =====================================================================

insert into public.site_monthly_targets (site_id, year, month, forecast_kwh, notes)
select s.id, 2026, v.m, v.kwh, 'Master All Commissioned Sites.xlsx'
from (values
  (1, 'Bassi', 465000),
  (2, 'Bassi', 543100),
  (3, 'Bassi', 670500),
  (4, 'Bassi', 701200),
  (5, 'Bassi', 688800),
  (6, 'Bassi', 611600),
  (7, 'Bassi', 545900),
  (8, 'Bassi', 542100),
  (9, 'Bassi', 581100),
  (10, 'Bassi', 543100),
  (11, 'Bassi', 466400),
  (12, 'Bassi', 447900),
  (1, 'Suaap', 368408.2),
  (2, 'Suaap', 400829.8),
  (3, 'Suaap', 494702.5),
  (4, 'Suaap', 518644.6),
  (5, 'Suaap', 527622.8),
  (6, 'Suaap', 432652.7),
  (7, 'Suaap', 426567.5),
  (8, 'Suaap', 413000.3),
  (9, 'Suaap', 408511.2),
  (10, 'Suaap', 438837.8),
  (11, 'Suaap', 362422.7),
  (12, 'Suaap', 321122.7),
  (1, 'Jerthi', 361900),
  (2, 'Jerthi', 424600),
  (3, 'Jerthi', 526700),
  (4, 'Jerthi', 554400),
  (5, 'Jerthi', 545000),
  (6, 'Jerthi', 486400),
  (7, 'Jerthi', 441500),
  (8, 'Jerthi', 447500),
  (9, 'Jerthi', 471200),
  (10, 'Jerthi', 427500),
  (11, 'Jerthi', 367700),
  (12, 'Jerthi', 349700),
  (1, 'Indo Ka Bas', 359400),
  (2, 'Indo Ka Bas', 390300),
  (3, 'Indo Ka Bas', 484000),
  (4, 'Indo Ka Bas', 506900),
  (5, 'Indo Ka Bas', 516600),
  (6, 'Indo Ka Bas', 457000),
  (7, 'Indo Ka Bas', 417900),
  (8, 'Indo Ka Bas', 405900),
  (9, 'Indo Ka Bas', 449400),
  (10, 'Indo Ka Bas', 430400),
  (11, 'Indo Ka Bas', 355500),
  (12, 'Indo Ka Bas', 344000),
  (1, 'Sadas', 339800),
  (2, 'Sadas', 370300),
  (3, 'Sadas', 449100),
  (4, 'Sadas', 454900),
  (5, 'Sadas', 443500),
  (6, 'Sadas', 373900),
  (7, 'Sadas', 308900),
  (8, 'Sadas', 296900),
  (9, 'Sadas', 360900),
  (10, 'Sadas', 380800),
  (11, 'Sadas', 325500),
  (12, 'Sadas', 311800),
  (1, 'Budsu', 267600),
  (2, 'Budsu', 303400),
  (3, 'Budsu', 373100),
  (4, 'Budsu', 393400),
  (5, 'Budsu', 386300),
  (6, 'Budsu', 343100),
  (7, 'Budsu', 305700),
  (8, 'Budsu', 301600),
  (9, 'Budsu', 331400),
  (10, 'Budsu', 311000),
  (11, 'Budsu', 270400),
  (12, 'Budsu', 258100),
  (1, 'Ganeshgarh', 261800),
  (2, 'Ganeshgarh', 358100),
  (3, 'Ganeshgarh', 451800),
  (4, 'Ganeshgarh', 463700),
  (5, 'Ganeshgarh', 505500),
  (6, 'Ganeshgarh', 454300),
  (7, 'Ganeshgarh', 458400),
  (8, 'Ganeshgarh', 464100),
  (9, 'Ganeshgarh', 456800),
  (10, 'Ganeshgarh', 370300),
  (11, 'Ganeshgarh', 285200),
  (12, 'Ganeshgarh', 260000),
  (1, 'Niwai', 291100),
  (2, 'Niwai', 334400),
  (3, 'Niwai', 401200),
  (4, 'Niwai', 416500),
  (5, 'Niwai', 405300),
  (6, 'Niwai', 348000),
  (7, 'Niwai', 309400),
  (8, 'Niwai', 294600),
  (9, 'Niwai', 335700),
  (10, 'Niwai', 337100),
  (11, 'Niwai', 236400),
  (12, 'Niwai', 254000)
) as v(m, name, kwh)
join public.sites s on s.name = v.name
on conflict (site_id, year, month) do nothing;

update public.site_monthly_targets t
set forecast_kwh = v.master_kwh,
    notes = 'Master All Commissioned Sites.xlsx (the July review pack repeated June)'
from (values
  ('Sadas',       361436.67, 308900),
  ('Suaap',       432652.7,  426567.5),
  ('Bassi',       611600,    545900),
  ('Budsu',       343100,    305700),
  ('Jerthi',      486400,    441500),
  ('Niwai',       348000,    309400),
  ('Indo Ka Bas', 457000,    417900),
  ('Ganeshgarh',  454300,    458400)
) as v(name, copied_kwh, master_kwh)
join public.sites s on s.name = v.name
where t.site_id = s.id and t.year = 2026 and t.month = 7
  and t.forecast_kwh = v.copied_kwh;