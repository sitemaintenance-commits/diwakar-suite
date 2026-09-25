-- =====================================================================
-- SITE MASTER CORRECTIONS, FROM THE COMPANY'S OWN SPREADSHEETS
--
-- Read out of "Sites DC Load Sept 2026.xlsx" and "Master All
-- Commissioned Sites.xlsx" — the workbooks the O&M team actually keeps.
--
-- Three things come across:
--   1. the real inverter count per site (the seed guessed 12 everywhere,
--      and was wrong for nine of the twelve sites)
--   2. commissioning dates
--   3. each inverter's own DC capacity, which makes it possible to spot
--      a single underperforming inverter the way the sheet does
--
-- NOT changed here, because the company's own files disagree and the
-- figures are still being confirmed:
--   * Jerthi DC        3,361 (Daily Report) / 3,254 (Monthly Report)
--                      / 3,496 (Master file). Sum of its inverters is
--                      3,528.7, which is nearest the Master file.
--   * Suaap            inverter DC sums to 3,254.8 against 3,305 declared
--   * Kadel AC         2,475 (Daily Report) / 2,450 (Master file)
--   * Bhojusar AC      2,475 (Daily Report) / 2,520 (currently seeded)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Commissioning dates
-- ---------------------------------------------------------------------
update public.solar_sites ss set commissioning_date = v.d::date
from (values
  ('Sadas', '2024-08-03'), ('Niwai', '2025-06-05'), ('Jerthi', '2025-08-28'),
  ('Suaap', '2025-09-30'), ('Budsu', '2025-11-17'), ('Bassi', '2025-11-29'),
  ('Indo Ka Bas', '2026-01-14'), ('Ganeshgarh', '2026-02-27')
) as v(name, d)
join public.sites s on s.name = v.name
where ss.site_id = s.id and ss.commissioning_date is null;

-- ---------------------------------------------------------------------
-- 2. One row per inverter, with the DC capacity it actually carries.
--
-- dc_kwp is the figure the site's own tab computes. Ganeshgarh is the
-- exception: its sheet formula is "=C*B" and omits the module wattage,
-- so its DC load column reads 588 kWp per inverter instead of 364.56.
-- The strings/modules/watt underneath are correct, so the value here is
-- recomputed from those and reconciles to 3,281 kWp against the 3,272
-- the Daily Report declares.
-- ---------------------------------------------------------------------
create table public.site_inverters (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  seq            int not null,
  label          text not null,
  strings        int,
  modules_per_string int,
  module_watt    int,
  dc_kwp         numeric(10,2) not null default 0,
  make           text,
  model          text,
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid,
  unique (site_id, seq)
);
create index site_inverters_site_idx on public.site_inverters(site_id, seq);

alter table public.site_inverters enable row level security;
grant select, insert, update, delete on public.site_inverters to authenticated;
create policy inv_select on public.site_inverters for select to authenticated
  using ((select app.has_any_perm(array['om.sites','om.daily_entry','om.generation','om.monitor'], 'view'))
         and site_id = any ((select app.my_site_ids())::uuid[]));
create policy inv_insert on public.site_inverters for insert to authenticated
  with check ((select app.has_perm('om.sites', 'create'))
              and site_id = any ((select app.my_site_ids())::uuid[]));
create policy inv_update on public.site_inverters for update to authenticated
  using ((select app.has_perm('om.sites', 'edit'))
         and site_id = any ((select app.my_site_ids())::uuid[])) with check (true);
create policy inv_delete on public.site_inverters for delete to authenticated
  using ((select app.has_perm('om.sites', 'delete')));
create trigger touch_row before update on public.site_inverters for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.site_inverters
  for each row execute function app.audit_row_change('om.sites');

insert into public.site_inverters (site_id, seq, label, strings, modules_per_string, module_watt, dc_kwp)
select s.id, v.seq, v.label, v.strings, v.mps, v.watt, v.dc
from (values
  ('Sadas', 1, 'INV-01', 27, 28, 550, 415.8),
  ('Sadas', 2, 'INV-02', 27, 28, 550, 415.8),
  ('Sadas', 3, 'INV-03', 27, 28, 550, 415.8),
  ('Sadas', 4, 'INV-04', 27, 28, 550, 415.8),
  ('Sadas', 5, 'INV-05', 27, 28, 550, 415.8),
  ('Sadas', 6, 'INV-06', 27, 28, 550, 414.15),
  ('Sadas', 7, 'INV-07', 27, 28, 550, 414.15),
  ('Suaap', 1, 'INV-01', 24, 26, 590, 368.16),
  ('Suaap', 2, 'INV-02', 24, 28, 550, 369.6),
  ('Suaap', 3, 'INV-03', 21, 28, 550, 323.4),
  ('Suaap', 4, 'INV-04', 24, 26, 590, 368.16),
  ('Suaap', 5, 'INV-05', 24, 26, 590, 368.16),
  ('Suaap', 6, 'INV-06', 24, 26, 590, 368.16),
  ('Suaap', 7, 'INV-07', 24, 26, 590, 368.16),
  ('Suaap', 8, 'INV-08', 24, 26, 590, 368.16),
  ('Suaap', 9, 'INV-09', 23, 26, 590, 352.82),
  ('Bassi', 1, 'INV-01', 24, 26, 590, 368.16),
  ('Bassi', 2, 'INV-02', 24, 26, 590, 368.16),
  ('Bassi', 3, 'INV-03', 23, 26, 590, 352.82),
  ('Bassi', 4, 'INV-04', 24, 26, 590, 368.16),
  ('Bassi', 5, 'INV-05', 23, 26, 590, 352.82),
  ('Bassi', 6, 'INV-06', 25, 26, 590, 383.5),
  ('Bassi', 7, 'INV-07', 25, 26, 590, 383.5),
  ('Bassi', 8, 'INV-08', 25, 26, 590, 383.5),
  ('Bassi', 9, 'INV-09', 24, 26, 590, 368.16),
  ('Bassi', 10, 'INV-10', 23, 26, 590, 352.82),
  ('Bassi', 11, 'INV-11', 24, 26, 590, 368.16),
  ('Bassi', 12, 'INV-12', 24, 26, 590, 368.16),
  ('Budsu', 1, 'INV-01', 22, 26, 590, 337.48),
  ('Budsu', 2, 'INV-02', 23, 26, 590, 352.82),
  ('Budsu', 3, 'INV-03', 23, 26, 590, 352.82),
  ('Budsu', 4, 'INV-04', 24, 26, 590, 368.16),
  ('Budsu', 5, 'INV-05', 22, 26, 590, 337.48),
  ('Budsu', 6, 'INV-06', 22, 26, 590, 337.48),
  ('Budsu', 7, 'INV-07', 23, 26, 590, 352.82),
  ('Niwai', 1, 'INV-01', 24, 28, 545, 366.24),
  ('Niwai', 2, 'INV-02', 11, 28, 545, 167.86),
  ('Niwai', 3, 'INV-03', 14, 28, 545, 213.64),
  ('Niwai', 4, 'INV-04', 24, 28, 545, 366.24),
  ('Niwai', 5, 'INV-05', 25, 28, 545, 381.5),
  ('Niwai', 6, 'INV-06', 25, 28, 545, 381.5),
  ('Niwai', 7, 'INV-07', 25, 28, 545, 381.5),
  ('Niwai', 8, 'INV-08', 25, 28, 545, 381.5),
  ('Jerthi', 1, 'INV-01', 24, 26, 585, 365.04),
  ('Jerthi', 2, 'INV-02', 23, 26, 585, 349.83),
  ('Jerthi', 3, 'INV-03', 23, 26, 585, 349.83),
  ('Jerthi', 4, 'INV-04', 23, 26, 585, 349.83),
  ('Jerthi', 5, 'INV-05', 23, 26, 585, 349.83),
  ('Jerthi', 6, 'INV-06', 23, 26, 585, 349.83),
  ('Jerthi', 7, 'INV-07', 23, 26, 585, 349.83),
  ('Jerthi', 8, 'INV-08', 23, 26, 585, 349.83),
  ('Jerthi', 9, 'INV-09', 23, 26, 585, 349.83),
  ('Jerthi', 10, 'INV-10', 24, 26, 585, 365.04),
  ('Indo Ka Bas', 1, 'INV-01', null, null, null, 366.26),
  ('Indo Ka Bas', 2, 'INV-02', null, null, null, 366.33),
  ('Indo Ka Bas', 3, 'INV-03', null, null, null, 352.04),
  ('Indo Ka Bas', 4, 'INV-04', null, null, null, 367.64),
  ('Indo Ka Bas', 5, 'INV-05', null, 623, 590, 367.57),
  ('Indo Ka Bas', 6, 'INV-06', 24, 624, 590, 368.16),
  ('Indo Ka Bas', 7, 'INV-07', 24, 624, 590, 368.16),
  ('Indo Ka Bas', 8, 'INV-08', 23, 595, 590, 351.05),
  ('Indo Ka Bas', 9, 'INV-09', 24, 622, 590, 366.98),
  ('Ganeshgarh', 1, 'INV-01', 21, 28, 620, 364.56),
  ('Ganeshgarh', 2, 'INV-02', 21, 28, 620, 364.56),
  ('Ganeshgarh', 3, 'INV-03', 21, 28, 620, 364.56),
  ('Ganeshgarh', 4, 'INV-04', 21, 28, 620, 364.56),
  ('Ganeshgarh', 5, 'INV-05', 21, 28, 620, 364.56),
  ('Ganeshgarh', 6, 'INV-06', 21, 28, 620, 364.56),
  ('Ganeshgarh', 7, 'INV-07', 21, 28, 620, 364.56),
  ('Ganeshgarh', 8, 'INV-08', 21, 28, 620, 364.56),
  ('Ganeshgarh', 9, 'INV-09', 21, 28, 620, 364.56),
  ('Budhwara', 1, 'INV-01', 21, 28, 620, 364.56),
  ('Budhwara', 2, 'INV-02', 21, 28, 620, 364.56),
  ('Budhwara', 3, 'INV-03', 21, 28, 620, 364.56),
  ('Budhwara', 4, 'INV-04', 20, 28, 620, 347.2),
  ('Budhwara', 5, 'INV-05', 21, 28, 620, 364.56),
  ('Budhwara', 6, 'INV-06', 21, 28, 620, 364.56),
  ('Budhwara', 7, 'INV-07', 21, 28, 620, 364.56),
  ('Budhwara', 8, 'INV-08', 21, 28, 620, 364.56),
  ('Budhwara', 9, 'INV-09', 20, 28, 620, 347.2),
  ('Budhwara', 10, 'INV-10', 21, 28, 620, 364.56),
  ('Budhwara', 11, 'INV-11', 21, 28, 620, 364.56),
  ('Budhwara', 12, 'INV-12', 21, 28, 620, 364.56),
  ('Kadel', 1, 'INV-01', 19, 28, 620, 329.84),
  ('Kadel', 2, 'INV-02', 20, 28, 620, 347.2),
  ('Kadel', 3, 'INV-03', 20, 28, 620, 347.2),
  ('Kadel', 4, 'INV-04', 20, 28, 620, 347.2),
  ('Kadel', 5, 'INV-05', 20, 28, 620, 347.2),
  ('Kadel', 6, 'INV-06', 20, 28, 620, 347.2),
  ('Kadel', 7, 'INV-07', 20, 28, 620, 347.2),
  ('Kadel', 8, 'INV-08', 20, 28, 620, 347.2),
  ('Kadel', 9, 'INV-09', 21, 28, 620, 364.56),
  ('Thikariya', 1, 'INV-01', 22, 28, 625, 384.38),
  ('Thikariya', 2, 'INV-02', 22, 28, 625, 385.0),
  ('Thikariya', 3, 'INV-03', 22, 28, 625, 385.0),
  ('Thikariya', 4, 'INV-04', 22, 28, 620, 381.92),
  ('Thikariya', 5, 'INV-05', 22, 28, 620, 381.92),
  ('Thikariya', 6, 'INV-06', 22, 28, 620, 381.92),
  ('Thikariya', 7, 'INV-07', 22, 28, 620, 381.92),
  ('Thikariya', 8, 'INV-08', 22, 28, 545, 335.72),
  ('Thikariya', 9, 'INV-09', 22, 28, 620, 381.92),
  ('Thikariya', 10, 'INV-10', 22, 28, 620, 381.92),
  ('Thikariya', 11, 'INV-11', 22, 28, null, 336.06),
  ('Thikariya', 12, 'INV-12', 23, 28, null, 355.35),
  ('Bhojusar', 1, 'INV-01', 22, 28, 620, 381.92),
  ('Bhojusar', 2, 'INV-02', 21, 28, 620, 364.56),
  ('Bhojusar', 3, 'INV-03', 22, 28, 620, 381.92),
  ('Bhojusar', 4, 'INV-04', 20, 28, 620, 347.2),
  ('Bhojusar', 5, 'INV-05', 20, 28, 620, 347.2),
  ('Bhojusar', 6, 'INV-06', 21, 28, 620, 364.56),
  ('Bhojusar', 7, 'INV-07', 21, 28, 620, 364.56),
  ('Bhojusar', 8, 'INV-08', 20, 28, 620, 347.2),
  ('Bhojusar', 9, 'INV-09', 21, 28, 620, 364.56)
) as v(site, seq, label, strings, mps, watt, dc)
join public.sites s on s.name = v.site
on conflict (site_id, seq) do update
  set label = excluded.label, strings = excluded.strings,
      modules_per_string = excluded.modules_per_string,
      module_watt = excluded.module_watt, dc_kwp = excluded.dc_kwp;

-- ---------------------------------------------------------------------
-- 3. The inverter count now follows the register instead of a guess.
-- ---------------------------------------------------------------------
update public.solar_sites ss
set inverter_count = c.n
from (select site_id, count(*) as n from public.site_inverters where is_active group by site_id) c
where c.site_id = ss.site_id;

-- How many modules each plant carries, where the configuration is regular.
update public.solar_sites ss
set module_count = c.n
from (select site_id, sum(strings * modules_per_string) as n
      from public.site_inverters
      where strings is not null and modules_per_string is not null
      group by site_id) c
where c.site_id = ss.site_id and ss.module_count is null;

-- ---------------------------------------------------------------------
-- 4. The threshold the sheet uses to write "Need to Check".
--    Its own numbers put the line between 0.84 and 0.89; 0.85 sits in
--    the middle and reproduces every flag in the September sheet.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('om.inverter_alert_threshold', '0.85'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- 5. PER-INVERTER ANALYSIS
--
-- What the site tabs do by hand, every day:
--
--   Gen per kW   = inverter generation / that inverter's own DC load
--   Gen in %     = Gen per kW / the best inverter's Gen per kW that day
--   Remarks      = "OK", or "Need to Check" below the threshold
--
-- Comparing an inverter against its own siblings on the same day cancels
-- out weather, so a single weak string shows up immediately instead of
-- hiding inside a site total that looks fine.
-- =====================================================================
create or replace function public.get_inverter_analysis(p_site_id uuid, p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_threshold numeric := coalesce(
    (select (value #>> '{}')::numeric from public.app_settings where key = 'om.inverter_alert_threshold'), 0.85);
  v jsonb;
begin
  if not (app.has_perm('om.daily_entry', 'view') or app.has_perm('om.generation', 'view')
          or app.has_perm('om.monitor', 'view')) then
    raise exception 'Access denied: you may not read generation for this site.' using errcode = '42501';
  end if;
  if p_site_id is null or not app.can_access_site(p_site_id) then
    raise exception 'You are not assigned to this site.' using errcode = '42501';
  end if;

  with reading as (
    select r.label, greatest(r.kwh, 0) as kwh
    from public.generation_records g,
         jsonb_to_recordset(coalesce(g.inverter_readings, '[]'::jsonb)) r(label text, kwh numeric)
    where g.site_id = p_site_id and g.gen_date = v_date and g.deleted_at is null
  ),
  joined as (
    select i.seq, i.label, i.dc_kwp, coalesce(x.kwh, 0) as kwh,
           case when i.dc_kwp > 0 and x.kwh > 0
                then round(x.kwh / i.dc_kwp, 3) end as gen_per_kw
    from public.site_inverters i
    left join reading x on upper(trim(x.label)) = upper(trim(i.label))
    where i.site_id = p_site_id and i.is_active
  ),
  best as (select max(gen_per_kw) as top from joined)
  select jsonb_build_object(
    'site_id', p_site_id,
    'date', v_date,
    'threshold', v_threshold,
    'inverter_count', (select count(*) from joined),
    'reported_count', (select count(*) from joined where kwh > 0),
    'best_gen_per_kw', (select top from best),
    'total_kwh', coalesce((select sum(kwh) from joined), 0),
    'total_dc_kwp', coalesce((select sum(dc_kwp) from joined), 0),
    'flagged', coalesce((select count(*) from joined, best
                         where gen_per_kw is not null and top > 0
                           and gen_per_kw / top < v_threshold), 0),
    'inverters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', j.seq, 'label', j.label, 'dc_kwp', j.dc_kwp, 'kwh', j.kwh,
               'gen_per_kw', j.gen_per_kw,
               'pct_of_best', case when b.top > 0 and j.gen_per_kw is not null
                                   then round(j.gen_per_kw / b.top, 4) end,
               'status', case
                 when j.kwh <= 0 then 'No reading'
                 when b.top is null or b.top = 0 then 'OK'
                 when j.gen_per_kw / b.top < v_threshold then 'Need to Check'
                 else 'OK' end)
             order by j.seq)
      from joined j, best b), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

grant execute on function public.get_inverter_analysis(uuid, date) to authenticated;
revoke execute on function public.get_inverter_analysis(uuid, date) from anon, public;
