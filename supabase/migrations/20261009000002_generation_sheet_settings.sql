-- The sheet-sync function runs with the service key, which has no direct
-- access to app_settings. It reads the sheet's address and records the
-- last sync through these two functions, callable by the service key only.

create or replace function public.generation_sheet_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_settings where key = 'generation_sheet'), '{}'::jsonb);
$$;

create or replace function public.record_generation_sheet_sync(p_summary jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.app_settings (key, value, updated_at)
  values ('generation_sheet_last_sync', coalesce(p_summary, '{}'::jsonb), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

revoke execute on function public.generation_sheet_config(), public.record_generation_sheet_sync(jsonb) from public, anon, authenticated;
grant execute on function public.generation_sheet_config(), public.record_generation_sheet_sync(jsonb) to service_role;
