-- =====================================================================
-- DEPARTMENT REVIEW: EACH DEPARTMENT KEEPS ITS OWN ROWS
--
-- A new daily report started from rows fixed in the code, so a row deleted
-- from a new report came back on a refresh. Each department's rows are now
-- kept in setting daily_report_rows ({department id: [labels]}): deleting a
-- row on a new report removes it there and then, and saving a report keeps
-- its rows (added or renamed ones too) for the next day. A department not
-- in the setting yet starts from the usual rows.
-- =====================================================================

insert into public.app_settings (key, value)
values ('daily_report_rows', '{}'::jsonb)
on conflict (key) do nothing;

/** Replace one department's rows. Whoever files or edits department reports may. */
create or replace function public.set_department_report_rows(p_department uuid, p_labels text[])
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_labels jsonb;
begin
  if not app.is_active_user()
     or not (app.has_perm('daily.reports', 'create') or app.has_perm('daily.reports', 'edit')) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.departments where id = p_department) then
    raise exception 'Department not found.' using errcode = 'P0002';
  end if;
  -- In order, trimmed, each label once.
  select coalesce(jsonb_agg(l order by ord), '[]'::jsonb) into v_labels
  from (select btrim(l) l, min(ord) ord
        from unnest(coalesce(p_labels, '{}')) with ordinality as t(l, ord)
        where nullif(btrim(coalesce(l, '')), '') is not null
        group by btrim(l)) q;
  if jsonb_array_length(v_labels) > 30 then
    raise exception 'Keep it to 30 rows or fewer.' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by)
  values ('daily_report_rows', jsonb_build_object(p_department::text, v_labels), now(), auth.uid())
  on conflict (key) do update
    set value = coalesce(public.app_settings.value, '{}'::jsonb) || jsonb_build_object(p_department::text, v_labels),
        updated_at = now(), updated_by = auth.uid();
  return v_labels;
end;
$$;

grant execute on function public.set_department_report_rows(uuid, text[]) to authenticated;
revoke execute on function public.set_department_report_rows(uuid, text[]) from anon, public;
