-- =====================================================================
-- DAILY ENTRY FROM THE TECHNICIANS' GOOGLE SHEET
--
-- The technicians fill a Google Form whose answers land in a Google Sheet,
-- one tab a month ("Form responses- Oct 2026"): date, site, the reading of
-- each inverter, the total, any failure, from which side, its timing, the
-- reason and the weather. The sheet-sync function reads it every 30
-- minutes (and on "Sync now") and saves each plant's day here, so it shows
-- on the Daily Entry page and everywhere generation is used.
--
--   * A day saved from the sheet is marked source 'sheet'. When the sheet
--     row changes (a later answer for the same day), the day is updated.
--   * A day entered or edited in the suite (source 'field') -- or imported
--     from the workbooks ('legacy') -- is never overwritten by the sheet.
--   * Only days from setting generation_sheet.from (1 Oct 2026) are synced:
--     the months before came from the office workbooks.
--
-- The sheet's address lives in setting generation_sheet (set outside the
-- migrations, which are public).
-- =====================================================================

alter table public.generation_records
  add column if not exists sheet_submitted_at timestamptz;

insert into public.app_settings (key, value)
values ('generation_sheet', '{"sheet_id": null, "from": "2026-10-01"}'::jsonb)
on conflict (key) do nothing;

/**
 * Save the sheet's rows (one per site and day, already parsed by the
 * sheet-sync function). Called with the service key only.
 * Row: {site, date, submitted_at, readings: [{label, kwh}], total,
 *       had_failure, side: 'gss'|'plant'|null, windows: [{kind, from, to}],
 *       timing, reason, weather}
 */
create or replace function public.sync_generation_sheet(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from date := coalesce((select (value->>'from')::date from public.app_settings where key = 'generation_sheet'), date '2026-10-01');
  r jsonb;
  v_site uuid;
  v_date date;
  v_at timestamptz;
  v_old record;
  v_windows jsonb;
  v_readings jsonb;
  v_total numeric;
  v_failed boolean;
  v_remarks text;
  v_added int := 0; v_updated int := 0; v_kept int := 0; v_same int := 0; v_old_days int := 0;
  v_unmatched text[] := '{}';
begin
  for r in select x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
           order by (x->>'submitted_at')::timestamptz nulls first loop
    v_date := nullif(r->>'date', '')::date;
    v_at := nullif(r->>'submitted_at', '')::timestamptz;
    select s.id into v_site from public.sites s where lower(s.name) = lower(btrim(r->>'site')) limit 1;
    if v_site is null then
      if not (r->>'site' = any (v_unmatched)) then v_unmatched := array_append(v_unmatched, r->>'site'); end if;
      continue;
    end if;
    if v_date is null or v_date < v_from or v_date > (now() at time zone 'Asia/Kolkata')::date then
      v_old_days := v_old_days + 1;
      continue;
    end if;

    select g.id, g.source, g.sheet_submitted_at into v_old
    from public.generation_records g where g.site_id = v_site and g.gen_date = v_date and g.deleted_at is null;
    if v_old.id is not null and coalesce(v_old.source, '') <> 'sheet' then
      v_kept := v_kept + 1;           -- entered or edited in the suite: the suite's version stays
      continue;
    end if;
    if v_old.id is not null and v_old.sheet_submitted_at is not null and v_at is not null and v_old.sheet_submitted_at >= v_at then
      v_same := v_same + 1;
      continue;
    end if;

    v_readings := coalesce((select jsonb_agg(jsonb_build_object('label', x->>'label', 'kwh', (x->>'kwh')::numeric))
                            from jsonb_array_elements(coalesce(r->'readings', '[]'::jsonb)) x
                            where (x->>'kwh') ~ '^-?[0-9]+(\.[0-9]+)?$'), '[]'::jsonb);
    v_total := coalesce(nullif(r->>'total', '')::numeric,
                        (select sum(greatest((x->>'kwh')::numeric, 0)) from jsonb_array_elements(v_readings) x), 0);
    v_failed := coalesce((r->>'had_failure')::boolean, false);
    v_windows := case when v_failed then coalesce(r->'windows', '[]'::jsonb) else '[]'::jsonb end;
    -- Timing the form gave but that could not be read as times stays visible.
    v_remarks := case when v_failed and jsonb_array_length(v_windows) = 0 and nullif(btrim(coalesce(r->>'timing', '')), '') is not null
                      then 'Failure timing: ' || btrim(r->>'timing') end;

    insert into public.generation_records
      (site_id, gen_date, generation_kwh, expected_kwh, grid_outage_hrs, plant_outage_hrs, outage_windows,
       remarks, inverter_readings, source, weather, had_failure, failure_side, failure_reason, sheet_submitted_at)
    values (v_site, v_date, v_total,
            (select round(ss.capacity_dc_kwp * ss.expected_yield, 3) from public.solar_sites ss where ss.site_id = v_site),
            app.outage_hours(v_windows, 'grid'), app.outage_hours(v_windows, 'plant'), v_windows,
            v_remarks, v_readings, 'sheet', nullif(btrim(coalesce(r->>'weather', '')), ''), v_failed,
            case when v_failed and r->>'side' in ('gss', 'plant') then r->>'side' end,
            case when v_failed then nullif(btrim(coalesce(r->>'reason', '')), '') end,
            v_at)
    on conflict (site_id, gen_date) do update
      set generation_kwh = excluded.generation_kwh, expected_kwh = excluded.expected_kwh,
          grid_outage_hrs = excluded.grid_outage_hrs, plant_outage_hrs = excluded.plant_outage_hrs,
          outage_windows = excluded.outage_windows, remarks = excluded.remarks,
          inverter_readings = excluded.inverter_readings, weather = excluded.weather,
          had_failure = excluded.had_failure, failure_side = excluded.failure_side,
          failure_reason = excluded.failure_reason, sheet_submitted_at = excluded.sheet_submitted_at
      where public.generation_records.source = 'sheet';
    if v_old.id is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'kept_suite_version', v_kept,
                            'unchanged', v_same, 'outside_dates', v_old_days, 'unknown_sites', to_jsonb(v_unmatched));
end;
$$;

revoke execute on function public.sync_generation_sheet(jsonb) from public, anon, authenticated;
grant execute on function public.sync_generation_sheet(jsonb) to service_role;

-- The scheduler and HTTP calls for the 30-minute sync (the job itself is
-- created outside the migrations: it carries the sync secret).
-- (Skipped where the extensions are not available, e.g. the local test database.)
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron not available'; end $$;
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net not available'; end $$;
