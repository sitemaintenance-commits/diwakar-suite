-- Clearing every entered value means the department has not filed a report.
-- Keep the old row as an audited soft-delete, while allowing a fresh report
-- for the same department and date later.

create or replace function app.guard_managed_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  cfg app.managed_tables;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  c text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select * into cfg from app.managed_tables where table_name = tg_table_name;

  if tg_op = 'UPDATE' and n ? 'deleted_at'
     and (n->>'deleted_at') is distinct from (o->>'deleted_at')
     and coalesce(current_setting('app.unfile_empty_daily_report', true), '') <> 'on'
     and not app.has_perm(cfg.module_key, 'delete') then
    raise exception 'You do not have permission to delete this record.' using errcode = '42501';
  end if;

  foreach c in array cfg.assign_columns loop
    if (n->>c) is distinct from (o->>c)
       and not (tg_op = 'INSERT' and (n->>c) = auth.uid()::text)
       and (n->>c) is not null
       and not app.has_perm(cfg.module_key, 'assign') then
      raise exception 'You do not have permission to assign this record.' using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.clear_daily_report(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.daily_reports%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to clear a report.' using errcode = '42501';
  end if;

  select * into r from public.daily_reports where id = p_id and deleted_at is null;
  if not found then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;

  if not app.has_perm('daily.reports', 'edit')
     or not app.in_scope(app.perm_scope('daily.reports', 'edit'),
                         array[r.created_by, r.reporter_id]::uuid[],
                         auth.uid(), app.my_team_ids())
     or (r.site_id is not null and not app.can_access_site(r.site_id)) then
    raise exception 'You do not have permission to edit this report.' using errcode = '42501';
  end if;

  perform set_config('app.unfile_empty_daily_report', 'on', true);
  update public.daily_reports set deleted_at = now() where id = p_id;
end;
$$;

grant execute on function public.clear_daily_report(uuid) to authenticated;
revoke execute on function public.clear_daily_report(uuid) from anon, public;

-- Repair rows previously left as Submitted/Draft with only empty template
-- labels. Preserve any row that has a management review attached.
update public.daily_reports r
set deleted_at = now()
where r.deleted_at is null
  and coalesce(trim(r.work_completed), '') = ''
  and coalesce(trim(r.issues), '') = ''
  and coalesce(trim(r.next_day_plan), '') = ''
  and coalesce(trim(r.remarks), '') = ''
  and not exists (
    select 1 from public.daily_report_items i
    where i.report_id = r.id and coalesce(trim(i.value), '') <> ''
  )
  and not exists (select 1 from public.review_actions a where a.report_id = r.id);
