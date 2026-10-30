-- Daily Work: employees may fill today and the 3 days before it.
-- HR (team or all scope) still fills or corrects any past day.
insert into public.app_settings (key, value)
values ('worklog_backfill_days', to_jsonb(3))
on conflict (key) do update set value = excluded.value;
