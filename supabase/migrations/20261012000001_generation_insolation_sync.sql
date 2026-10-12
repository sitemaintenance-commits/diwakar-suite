-- =====================================================================
-- INSOLATION FROM THE OFFICE REPORT SHEET (so PR shows)
--
-- PR = generation / (insolation x DC kWp). The technicians' form has no
-- insolation, so since October the suite had generation but no insolation,
-- and PR stayed blank in Solar Monitor, the ranking and the reports. The
-- office's daily report spreadsheet keeps an "Insolation" tab (one row a
-- day, one column a site); the sheet-sync function now reads it as well
-- and fills each day's insolation here.
--
--   * Only insolation is written; generation is never touched.
--   * Insolation typed in the suite (a day entered or edited here, with a
--     value) is kept.
--   * A value under 1 or over app.max_insolation() (9), or one that would
--     give a PR above 100%, is not saved but listed as suspect (e.g. 0.09
--     for 5.09).
--   * A day the plant has not filed yet is skipped and picked up on a later
--     sync, once the generation is in.
-- The sheet's address lives in setting generation_insolation_sheet.
-- =====================================================================

insert into public.app_settings (key, value)
values ('generation_insolation_sheet', '{"sheet_id": null, "gid": null}'::jsonb)
on conflict (key) do nothing;

/** Row: {site, date, insolation}. Called with the service key only. */
create or replace function public.sync_generation_insolation(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from date := coalesce((select (value->>'from')::date from public.app_settings where key = 'generation_sheet'), date '2026-10-01');
  v_max numeric := app.max_insolation();
  r jsonb;
  v_site uuid;
  v_date date;
  v_ins numeric;
  g record;
  v_pr numeric;
  v_filled int := 0; v_same int := 0; v_kept int := 0; v_waiting int := 0;
  v_suspect jsonb := '[]'::jsonb;
  v_unmatched text[] := '{}';
begin
  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x loop
    v_date := nullif(r->>'date', '')::date;
    v_ins := nullif(r->>'insolation', '')::numeric;
    select s.id into v_site from public.sites s where lower(s.name) = lower(btrim(r->>'site')) limit 1;
    if v_site is null then
      if not (r->>'site' = any (v_unmatched)) then v_unmatched := array_append(v_unmatched, r->>'site'); end if;
      continue;
    end if;
    continue when v_date is null or v_ins is null or v_date < v_from;

    select gr.id, gr.source, gr.irradiation_kwh_m2, gr.generation_kwh, ss.capacity_dc_kwp as dc into g
    from public.generation_records gr
    join public.solar_sites ss on ss.site_id = gr.site_id
    where gr.site_id = v_site and gr.gen_date = v_date and gr.deleted_at is null;
    if g.id is null then
      v_waiting := v_waiting + 1;     -- no generation filed for that day yet
      continue;
    end if;

    v_pr := case when g.dc > 0 and v_ins > 0 then round(100 * g.generation_kwh / (v_ins * g.dc), 1) end;
    if v_ins < 1 or v_ins > v_max or v_pr > 100 then
      v_suspect := v_suspect || jsonb_build_object('site', r->>'site', 'date', v_date, 'insolation', v_ins, 'pr', v_pr);
      continue;
    end if;
    if g.irradiation_kwh_m2 is not null and coalesce(g.source, '') <> 'sheet' then
      v_kept := v_kept + 1;           -- typed in the suite: kept
      continue;
    end if;
    if g.irradiation_kwh_m2 = v_ins then
      v_same := v_same + 1;
      continue;
    end if;
    update public.generation_records set irradiation_kwh_m2 = v_ins where id = g.id;
    v_filled := v_filled + 1;
  end loop;

  return jsonb_build_object('filled', v_filled, 'unchanged', v_same, 'kept_suite_value', v_kept,
                            'waiting_for_generation', v_waiting, 'suspect', v_suspect,
                            'unknown_sites', to_jsonb(v_unmatched));
end;
$$;

/** The insolation sheet's address, for the sync (service key only). */
create or replace function public.generation_insolation_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'generation_insolation_sheet'), '{}'::jsonb);
$$;

revoke execute on function public.sync_generation_insolation(jsonb), public.generation_insolation_config() from public, anon, authenticated;
grant execute on function public.sync_generation_insolation(jsonb), public.generation_insolation_config() to service_role;
