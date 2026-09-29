-- =====================================================================
-- THE DAILY ENTRY ASKS WHAT THE TECHNICIANS' FORM ASKS
--
-- The O&M team's Google Form ("SOLAR PLANT DAILY GENERATION REPORT")
-- asks four things the suite's Daily Entry did not:
--
--   Any grid / plant failure today?     Yes / No            (required)
--   Failure / shutdown from which side? GSS side / Plant side
--   Failure reason                      free text, e.g. "33 kV Line Maintenance"
--   Weather condition                   Clear Weather, Lightly Cloudy, Fully
--                                       Cloudy, Light Rain, Heavy Rain,
--                                       Sandstorm, Dusty / Hazy   (required)
--
-- The reason becomes a list rather than free text. It was built from what
-- the team actually wrote: 1,666 remarks describing an interruption in the
-- O&M CRM and the Daily Report tabs, classified into these causes --
--
--   33 kV grid outage from the GSS side      1,128   GSS
--   GSS breaker / VCB tripping                   78   GSS
--   Fuse burnt (DO / HT fuse)                    77   plant
--   33 kV line maintenance work                  76   GSS
--   132 / 220 kV upstream outage or fault        69   GSS
--   Plant-side line / earthing / insulation      58   plant
--   33 kV line fault                             42   GSS
--   Storm / bad weather outage                   34   GSS
--   Transformer fault / abnormality              27   plant
--   Cable theft at site                          16   plant
--   Tree trimming on the transmission line       11   GSS
--   Under / over-voltage trip, inverter fault, ACB trip, planned plant
--   shutdown                                  a few each  plant
--
-- The list is rows, not code: the O&M head can add, rename or retire a
-- reason. match_pattern is how a legacy remark is recognised, and priority
-- decides which pattern wins -- specific causes before the generic outage.
--
-- Every reading already in the suite came from the legacy remarks, so the
-- same patterns fill its weather and reason now, and a trigger does the
-- same for any legacy row imported later.
-- =====================================================================

create table public.om_failure_reasons (
  id             uuid primary key default gen_random_uuid(),
  side           text not null check (side in ('gss', 'plant')),
  label          text not null unique,
  sort_order     int not null default 100,
  priority       int not null default 100,
  match_pattern  text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_by     uuid
);
comment on table public.om_failure_reasons is
  'Causes offered on the Daily Entry form. match_pattern (a case-insensitive regex) recognises the cause in legacy remarks; the lowest priority that matches wins.';

alter table public.om_failure_reasons enable row level security;
grant select, insert, update, delete on public.om_failure_reasons to authenticated;
create policy fr_select on public.om_failure_reasons for select to authenticated
  using ((select app.is_active_user()));
create policy fr_insert on public.om_failure_reasons for insert to authenticated
  with check ((select app.has_perm('om.sites', 'edit')));
create policy fr_update on public.om_failure_reasons for update to authenticated
  using ((select app.has_perm('om.sites', 'edit'))) with check (true);
create policy fr_delete on public.om_failure_reasons for delete to authenticated
  using ((select app.has_perm('om.sites', 'delete')));
create trigger touch_row before update on public.om_failure_reasons
  for each row execute function app.touch_row();
create trigger audit_row after insert or update or delete on public.om_failure_reasons
  for each row execute function app.audit_row_change('om.sites');

insert into public.om_failure_reasons (side, label, sort_order, priority, match_pattern) values
  ('gss',   '33 kV grid outage from the GSS side',            10, 130, '33 ?kv|gss|grid (outage|off|power cut|failure|failed|interruption)|power ?house|grid issue'),
  ('gss',   '33 kV line maintenance work',                    20,  90, 'maintenance|shutdown taken|planned'),
  ('gss',   'GSS breaker / VCB tripping',                     30, 110, 'vcb|breaker|feeder trip'),
  ('gss',   '132 / 220 kV upstream outage or fault',          40, 100, '132 ?kv|220 ?kv'),
  ('gss',   '33 kV line fault',                               50, 120, 'line fault|feeder fault|transmission line'),
  ('gss',   'Storm / bad weather outage',                     60,  80, 'storm|windstorm|bad weather|adverse weather|lightning|heavy wind'),
  ('gss',   'Tree trimming on the transmission line',         70,  70, 'tree'),
  ('plant', 'Fuse burnt (DO / HT fuse)',                     110,  20, 'fuse'),
  ('plant', 'Plant-side line / earthing / insulation fault', 120,  50, 'plant[- ]side .*(line|fault)|insulation fault|earthing fault|jumper|insulator|tl line fault|cable fault|ht cable'),
  ('plant', 'Transformer fault / abnormality',               130,  30, 'transformer|oltc|buchholz|oil temp'),
  ('plant', 'Inverter fault / trip',                         140,  40, 'inverter (trip|fault)|osr alarm|ground fault|inv(erter)?[- ]?(no\.? ?)?[0-9]+ (trip|fault|off)'),
  ('plant', 'Under / over-voltage trip',                     150,  45, 'under[- ]?(/ ?)?over[- ]?voltage|under[- ]voltage|over[- ]voltage'),
  ('plant', 'ACB / breaker trip in the plant',               160,  46, 'acb'),
  ('plant', 'Cable theft at site',                           170,  10, 'theft'),
  ('plant', 'Planned plant shutdown (maintenance)',          180,  60, 'plant shutdown|mccb|auxiliary|safety precaution|plant-side maintenance');

-- ---------------------------------------------------------------------
-- The reading records what the form asks.
-- ---------------------------------------------------------------------
alter table public.generation_records
  add column if not exists weather text,
  add column if not exists had_failure boolean,
  add column if not exists failure_side text,
  add column if not exists failure_reason text;

alter table public.generation_records
  add constraint generation_weather_check check (weather is null or weather in
    ('Clear Weather', 'Lightly Cloudy', 'Fully Cloudy', 'Light Rain', 'Heavy Rain', 'Sandstorm', 'Dusty / Hazy')),
  add constraint generation_failure_side_check check (failure_side is null or failure_side in ('gss', 'plant'));

comment on column public.generation_records.failure_reason is
  'The reason as chosen (an om_failure_reasons label, or "Other"), kept as text so history reads the same if the list changes.';

-- ---------------------------------------------------------------------
-- Recognising weather and cause in a legacy remark.
-- ---------------------------------------------------------------------
create or replace function app.weather_from_text(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_text is null then null
    when p_text ~* 'heavy rain' then 'Heavy Rain'
    when p_text ~* 'rain|drizzle|shower' then 'Light Rain'
    when p_text ~* 'sand ?storm|dust ?storm' then 'Sandstorm'
    when p_text ~* 'dust|haz[ey]|smog|fog' then 'Dusty / Hazy'
    when p_text ~* 'full(y)? cloud|overcast' then 'Fully Cloudy'
    when p_text ~* 'light(l)?y cloud|partly cloud|partial(ly)? cloud|cloud' then 'Lightly Cloudy'
    when p_text ~* 'clear|sunny' then 'Clear Weather'
  end;
$$;

create or replace function app.failure_from_text(p_text text, out side text, out reason text)
language plpgsql stable
set search_path = ''
as $$
declare
  v_focus text;
begin
  if p_text is null then
    return;
  end if;
  -- The cause is written in brackets or after "due to"; weather words
  -- elsewhere in the remark ("stormy weather") must not decide it.
  select concat_ws(' ',
           (select string_agg(m[1], ' ') from regexp_matches(p_text, '\(([^()]*)\)', 'g') m),
           (select string_agg(m[1], ' ') from regexp_matches(p_text, '(due to[^,.]*)', 'gi') m))
    into v_focus;
  if btrim(coalesce(v_focus, '')) <> '' then
    select r.side, r.label into side, reason
    from public.om_failure_reasons r
    where r.is_active and r.match_pattern is not null and v_focus ~* r.match_pattern
    order by r.priority limit 1;
  end if;
  if reason is null then
    select r.side, r.label into side, reason
    from public.om_failure_reasons r
    where r.is_active and r.match_pattern is not null and p_text ~* r.match_pattern
    order by r.priority limit 1;
  end if;
end;
$$;

-- A remark describes an interruption when it says so.
create or replace function app.text_reports_failure(p_text text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_text ~* '(fail|outage|trip|shutdown|fault|theft|fuse|off from|off due|power cut|grid off|burn)', false);
$$;

create or replace function app.classify_legacy_reading()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  f record;
begin
  if new.source <> 'legacy' then
    return new;
  end if;
  if new.weather is null then
    new.weather := app.weather_from_text(new.remarks);
  end if;
  if new.had_failure is null then
    new.had_failure := coalesce(new.grid_outage_hrs, 0) + coalesce(new.plant_outage_hrs, 0) > 0
                       or app.text_reports_failure(new.remarks);
  end if;
  if new.had_failure and new.failure_reason is null then
    select * into f from app.failure_from_text(new.remarks);
    new.failure_reason := f.reason;
    new.failure_side := coalesce(new.failure_side, f.side,
      case when new.plant_outage_hrs > 0 and coalesce(new.grid_outage_hrs, 0) = 0 then 'plant'
           when new.grid_outage_hrs > 0 or new.remarks ~* 'grid' then 'gss' end);
  end if;
  return new;
end;
$$;

create trigger classify_legacy_reading
  before insert or update of remarks, grid_outage_hrs, plant_outage_hrs on public.generation_records
  for each row execute function app.classify_legacy_reading();

-- Fill what the history already says. Only the new columns change; a row
-- that stays unclassified keeps them null. updated_by stays as it was, so
-- an untouched legacy row still counts as untouched for a later import.
with c as (
  select g.id,
         app.weather_from_text(g.remarks) as weather,
         coalesce(g.grid_outage_hrs, 0) + coalesce(g.plant_outage_hrs, 0) > 0
           or app.text_reports_failure(g.remarks) as failed,
         (app.failure_from_text(g.remarks)).side as f_side,
         (app.failure_from_text(g.remarks)).reason as f_reason,
         g.grid_outage_hrs, g.plant_outage_hrs, g.remarks
  from public.generation_records g
  where g.source = 'legacy' and g.had_failure is null
)
update public.generation_records g
set weather = coalesce(g.weather, c.weather),
    had_failure = c.failed,
    failure_reason = case when c.failed then c.f_reason end,
    failure_side = case when c.failed then coalesce(c.f_side,
      case when c.plant_outage_hrs > 0 and coalesce(c.grid_outage_hrs, 0) = 0 then 'plant'
           when c.grid_outage_hrs > 0 or c.remarks ~* 'grid' then 'gss' end) end
from c
where c.id = g.id;

-- ---------------------------------------------------------------------
-- The form saves the new answers. Same checks as before, plus:
--   * weather must be one of the form's choices;
--   * "Yes, a failure" needs a side and a reason (and "Other" needs the
--     details written in the remarks);
--   * "No failure" cannot come with outage windows.
-- Older callers that do not send the new fields keep working: the failure
-- flag is then read off the outage entered.
-- ---------------------------------------------------------------------
drop function if exists public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text, jsonb);

create or replace function public.save_field_entry(
  p_site_id uuid,
  p_date date,
  p_readings jsonb,
  p_insolation numeric default null,
  p_grid_outage numeric default 0,
  p_plant_outage numeric default 0,
  p_remarks text default null,
  p_outage_windows jsonb default null,
  p_weather text default null,
  p_had_failure boolean default null,
  p_failure_side text default null,
  p_failure_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total numeric(14,3);
  v_expected numeric(14,3);
  v_id uuid;
  v_exists boolean;
  v_windows jsonb := coalesce(p_outage_windows, '[]'::jsonb);
  v_grid numeric;
  v_plant numeric;
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
  v_reason text := nullif(trim(coalesce(p_failure_reason, '')), '');
  v_failed boolean;
begin
  if p_site_id is null or p_date is null then
    raise exception 'Site and date are required.' using errcode = '22023';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'You cannot record a reading for a future date.' using errcode = '22023';
  end if;
  if not app.can_access_site(p_site_id) then
    raise exception 'You are not assigned to this site.' using errcode = '42501';
  end if;

  select exists (select 1 from public.generation_records
                 where site_id = p_site_id and gen_date = p_date and deleted_at is null)
    into v_exists;

  if v_exists then
    if not (app.has_perm('om.daily_entry', 'edit') or app.has_perm('om.generation', 'edit')) then
      raise exception 'You do not have permission to change a saved entry.' using errcode = '42501';
    end if;
  else
    if not (app.has_perm('om.daily_entry', 'create') or app.has_perm('om.generation', 'create')) then
      raise exception 'You do not have permission to record readings.' using errcode = '42501';
    end if;
  end if;

  if jsonb_array_length(v_windows) > 0 then
    v_grid := app.outage_hours(v_windows, 'grid');
    v_plant := app.outage_hours(v_windows, 'plant');
  else
    v_grid := coalesce(p_grid_outage, 0);
    v_plant := coalesce(p_plant_outage, 0);
  end if;

  v_failed := coalesce(p_had_failure, v_grid + v_plant > 0);
  if v_failed then
    if p_had_failure is not null then
      if p_failure_side is null or p_failure_side not in ('gss', 'plant') then
        raise exception 'Say which side the failure came from: GSS side or plant side.' using errcode = '22023';
      end if;
      if v_reason is null then
        raise exception 'Choose the failure reason.' using errcode = '22023';
      end if;
      if v_reason = 'Other' and v_remarks is null then
        raise exception 'Describe the failure in the details when the reason is "Other".' using errcode = '22023';
      end if;
    end if;
  elsif v_grid + v_plant > 0 then
    raise exception 'The entry says there was no failure but has outage times. Remove them or answer Yes.' using errcode = '22023';
  end if;

  select coalesce(sum(greatest(r.kwh, 0)), 0) into v_total
  from jsonb_to_recordset(coalesce(p_readings, '[]'::jsonb)) r(label text, kwh numeric);

  select round(ss.capacity_dc_kwp * ss.expected_yield, 3) into v_expected
  from public.solar_sites ss where ss.site_id = p_site_id;

  insert into public.generation_records
    (site_id, gen_date, generation_kwh, expected_kwh, irradiation_kwh_m2,
     grid_outage_hrs, plant_outage_hrs, outage_windows, remarks, inverter_readings, source, created_by,
     weather, had_failure, failure_side, failure_reason)
  values (p_site_id, p_date, v_total, v_expected, p_insolation,
          v_grid, v_plant, v_windows, v_remarks,
          coalesce(p_readings, '[]'::jsonb), 'field', auth.uid(),
          nullif(trim(coalesce(p_weather, '')), ''), v_failed,
          case when v_failed then p_failure_side end, case when v_failed then v_reason end)
  on conflict (site_id, gen_date) do update
    set generation_kwh = excluded.generation_kwh,
        expected_kwh = coalesce(public.generation_records.expected_kwh, excluded.expected_kwh),
        irradiation_kwh_m2 = excluded.irradiation_kwh_m2,
        grid_outage_hrs = excluded.grid_outage_hrs,
        plant_outage_hrs = excluded.plant_outage_hrs,
        outage_windows = excluded.outage_windows,
        remarks = excluded.remarks,
        inverter_readings = excluded.inverter_readings,
        source = 'field',
        weather = excluded.weather,
        had_failure = excluded.had_failure,
        failure_side = excluded.failure_side,
        failure_reason = excluded.failure_reason
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'generation_kwh', v_total, 'date', p_date,
                            'grid_outage_hrs', v_grid, 'plant_outage_hrs', v_plant,
                            'had_failure', v_failed);
end;
$$;

grant execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text, jsonb, text, boolean, text, text) to authenticated;
revoke execute on function public.save_field_entry(uuid, date, jsonb, numeric, numeric, numeric, text, jsonb, text, boolean, text, text)
  from anon, public;

-- =====================================================================
-- The form loads the reasons with the day, and returns the new fields.
-- (latest definition, two additions)
-- =====================================================================
create or replace function public.get_field_entry(p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_sites uuid[] := app.my_om_site_ids();
begin
  if not (app.has_perm('om.daily_entry', 'view') or app.has_perm('om.generation', 'view')) then
    raise exception 'Access denied: om.daily_entry VIEW permission required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'date', v_date,
    'failure_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('side', r.side, 'label', r.label) order by r.sort_order, r.label)
      from public.om_failure_reasons r where r.is_active), '[]'::jsonb),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'site_id', s.id,
        'name', s.name,
        'location', coalesce(s.district, s.location),
        'capacity_dc_kwp', coalesce(ss.capacity_dc_kwp, s.capacity_kwp),
        'inverter_count', coalesce(ss.inverter_count, 12),
        'stage', coalesce(ss.stage, 'commissioned'),
        'entry', (select jsonb_build_object(
                    'id', g.id, 'generation_kwh', g.generation_kwh, 'irradiation', g.irradiation_kwh_m2,
                    'grid_outage_hrs', g.grid_outage_hrs, 'plant_outage_hrs', g.plant_outage_hrs,
                    'outage_windows', g.outage_windows,
                    'remarks', g.remarks, 'readings', g.inverter_readings, 'source', g.source,
                    'weather', g.weather, 'had_failure', g.had_failure,
                    'failure_side', g.failure_side, 'failure_reason', g.failure_reason)
                  from public.generation_records g
                  where g.site_id = s.id and g.gen_date = v_date and g.deleted_at is null))
        order by s.name)
      from public.sites s
      left join public.solar_sites ss on ss.site_id = s.id
      where s.status = 'active' and s.id = any (v_sites)), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', g.gen_date, 'site', s.name, 'generation_kwh', g.generation_kwh, 'source', g.source)
        order by g.gen_date desc, s.name)
      from public.generation_records g join public.sites s on s.id = g.site_id
      where g.gen_date >= v_date - 7 and g.deleted_at is null and g.site_id = any (v_sites)), '[]'::jsonb));
end;
$$;

-- =====================================================================
-- The Solar Monitor day view shows the weather and the reason.
-- (latest definition, three additions)
-- =====================================================================
create or replace function public.get_daily_performance(p_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_sites uuid[] := app.my_om_site_ids();
  v jsonb;
begin
  if not app.has_perm('om.monitor', 'view') then
    raise exception 'Access denied: om.monitor VIEW permission required.' using errcode = '42501';
  end if;

  with site as (
    select s.id, s.name, coalesce(s.district, s.location) as location,
           coalesce(ss.capacity_dc_kwp, s.capacity_kwp) as dc,
           coalesce(ss.capacity_ac_kw, 0) as ac,
           ss.tilt_degrees as tilt
    from public.sites s
    left join public.solar_sites ss on ss.site_id = s.id
    where s.status = 'active' and s.id = any (v_sites)
  ),
  day as (
    select g.site_id, g.generation_kwh, g.irradiation_kwh_m2, g.grid_outage_hrs,
           g.plant_outage_hrs, g.remarks, g.source,
           g.weather, g.had_failure, g.failure_side, g.failure_reason
    from public.generation_records g
    where g.gen_date = v_date and g.deleted_at is null and g.site_id = any (v_sites)
  ),
  perf as (
    select s.id, s.name, s.location, s.dc, s.ac, s.tilt,
           coalesce(d.generation_kwh, 0) as kwh,
           d.irradiation_kwh_m2 as insolation,
           coalesce(d.grid_outage_hrs, 0) as grid_outage,
           coalesce(d.plant_outage_hrs, 0) as plant_outage,
           d.remarks, d.source, d.weather, d.had_failure, d.failure_side, d.failure_reason,
           (d.site_id is not null) as reported,
           case when s.dc > 0 and d.generation_kwh > 0
                then round(d.generation_kwh / s.dc, 2) end as sy,
           case when s.dc > 0 and d.irradiation_kwh_m2 > 0 and d.generation_kwh > 0
                then round(100 * d.generation_kwh / (d.irradiation_kwh_m2 * s.dc), 2) end as pr,
           case when s.dc > 0 and d.generation_kwh > 0
                then round(100 * d.generation_kwh / (s.dc * 24), 2) end as dc_cuf,
           case when s.ac > 0 and d.generation_kwh > 0
                then round(100 * d.generation_kwh / (s.ac * 24), 2) end as ac_cuf
    from site s left join day d on d.site_id = s.id
  )
  select jsonb_build_object(
    'date', v_date,
    'site_count', (select count(*) from site),
    'reported_count', (select count(*) from perf where reported),
    'capacity_dc_kwp', coalesce((select sum(dc) from site), 0),
    'capacity_ac_kw', coalesce((select sum(ac) from site), 0),
    'total_generation', coalesce((select sum(kwh) from perf), 0),
    'total_grid_outage', coalesce((select sum(grid_outage) from perf), 0),
    'avg_pr', (select round(avg(pr), 2) from perf where pr is not null),
    'avg_insolation', (select round(avg(insolation), 2) from perf where insolation is not null),
    'dc_cuf', (select case when sum(dc) > 0 and sum(kwh) > 0
                            then round(100 * sum(kwh) / (sum(dc) * 24), 2) end from perf),
    'ac_cuf', (select case when sum(ac) > 0 and sum(kwh) > 0
                            then round(100 * sum(kwh) / (sum(ac) * 24), 2) end from perf),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'site_id', id, 'name', name, 'location', location,
               'capacity_dc_kwp', dc, 'capacity_ac_kw', ac, 'tilt', tilt,
               'generation_kwh', kwh, 'insolation', insolation,
               'specific_yield', sy, 'pr', pr, 'dc_cuf', dc_cuf, 'ac_cuf', ac_cuf,
               'grid_outage', grid_outage, 'plant_outage', plant_outage,
               'remarks', remarks, 'source', source, 'reported', reported,
               'weather', weather, 'had_failure', had_failure,
               'failure_side', failure_side, 'failure_reason', failure_reason)
             order by name)
      from perf), '[]'::jsonb),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'generation_kwh', kwh,
                                          'specific_yield', sy, 'pr', pr)
                       order by kwh desc, name)
      from perf where kwh > 0), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;
