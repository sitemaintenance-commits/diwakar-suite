-- =====================================================================
-- INSURANCE RENEWAL ALERTS
--
-- Every morning (9 am IST) the suite looks for insurance policies that end
-- in 15, 10 or 2 days and puts an alert in the bell of:
--   * whoever uploaded the policy,
--   * the person named as responsible on it (matched by name),
--   * every Super Admin.
-- Each policy alerts once per threshold (document_expiry_alerts remembers);
-- a policy whose end date changes is alerted again for the new date.
-- =====================================================================

create table if not exists public.document_expiry_alerts (
  document_id uuid not null references public.documents(id) on delete cascade,
  end_date    date not null,
  days_before int  not null,
  sent_at     timestamptz not null default now(),
  primary key (document_id, end_date, days_before)
);
alter table public.document_expiry_alerts enable row level security;
revoke all on public.document_expiry_alerts from anon, authenticated;

create or replace function app.send_document_expiry_alerts()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  d record;
  u uuid;
  v_sent int := 0;
  v_resp text;
begin
  for d in
    select doc.id, doc.file_name, doc.created_by, doc.details,
           coalesce(nullif(doc.details->>'end_date', '')::date, doc.valid_until) as end_date
    from public.documents doc
    left join public.document_folders f on f.id = doc.folder_id
    where doc.deleted_at is null
      and (lower(coalesce(doc.category, '')) = 'insurance' or f.name ilike '%insur%' or doc.details ? 'policy_no')
  loop
    continue when d.end_date is null or (d.end_date - v_today) not in (15, 10, 2);
    continue when exists (select 1 from public.document_expiry_alerts a
                          where a.document_id = d.id and a.end_date = d.end_date and a.days_before = d.end_date - v_today);
    insert into public.document_expiry_alerts (document_id, end_date, days_before) values (d.id, d.end_date, d.end_date - v_today);

    v_resp := lower(btrim(regexp_replace(coalesce(d.details->>'responsible', ''), '\s+(sir|ji|madam|mam)$', '', 'i')));
    for u in
      select distinct x.uid from (
        select d.created_by as uid
        union all
        select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id where r.key = 'super_admin'
        union all
        select p.id from public.profiles p
        where v_resp <> '' and p.status = 'active'
          and (lower(p.full_name) = v_resp or lower(split_part(p.full_name, ' ', 1)) = v_resp)
      ) x
      join public.profiles p on p.id = x.uid and p.status = 'active'
      where x.uid is not null
    loop
      insert into public.notifications (user_id, kind, title, body, link, entity_type, entity_id)
      values (u, 'document.expiring',
              'Insurance renewal due in ' || (d.end_date - v_today) || ' days',
              coalesce(nullif(concat_ws(' · ', d.details->>'project_name', d.details->>'insurer', 'Policy ' || nullif(d.details->>'policy_no', '')), ''), d.file_name)
                || ' — ends ' || to_char(d.end_date, 'DD Mon YYYY'),
              '/documents', 'document', d.id);
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end;
$$;
revoke all on function app.send_document_expiry_alerts() from public, anon, authenticated;

-- Every day at 03:30 UTC = 9:00 am IST.
do $$
begin
  perform cron.unschedule('insurance-expiry-alerts') where exists (select 1 from cron.job where jobname = 'insurance-expiry-alerts');
  perform cron.schedule('insurance-expiry-alerts', '30 3 * * *', 'select app.send_document_expiry_alerts()');
exception when others then
  raise notice 'pg_cron not available; insurance alerts not scheduled';
end $$;
