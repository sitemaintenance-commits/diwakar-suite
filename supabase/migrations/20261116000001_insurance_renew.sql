-- =====================================================================
-- INSURANCE: RENEW A POLICY
--
-- "Renew" on a policy uploads the new document with the same details
-- (company, project, capacity, insurer, responsible), and marks the old one
-- replaced: details.renewed_by and details.renewed_on, no valid_until. It
-- stays in the library as history, and the renewal alerts are now for the
-- new policy only.
-- =====================================================================

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
      -- A policy replaced by its renewal no longer alerts; the renewal does.
      and not (doc.details ? 'renewed_by')
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
