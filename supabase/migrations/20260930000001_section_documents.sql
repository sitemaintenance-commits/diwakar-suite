-- =====================================================================
-- DOCUMENTS IN EVERY SECTION
--
-- Every section (module) gets its own document library: the Documents
-- button in each page header, and one Documents page listing everything a
-- person may see. It reuses public.documents and the private "documents"
-- bucket the tender attachments already use.
--
--   * A section document is a row with entity_type = 'section' and no
--     entity_id (a record attachment, e.g. a tender's NIT, keeps both).
--   * Anyone who can open a section may add work documents to it: the
--     people doing the work are often the ones with only VIEW.
--   * The uploader may correct or delete their own document; anyone else's
--     needs that section's EDIT / DELETE. Record attachments keep their
--     rules (CREATE or EDIT to attach).
--   * Plant-scoped documents follow the plant: only people assigned to it
--     see them.
--   * valid_until marks certificates, insurance and licences that expire.
--   * Programs and scripts are refused (exe, bat, js, html ...).
-- =====================================================================

alter table public.documents
  alter column entity_id drop not null,
  add column if not exists valid_until date;
comment on column public.documents.valid_until is 'Expiry of a certificate, licence or insurance document; shown as expiring/expired.';

alter table public.documents
  add constraint documents_entity_check
  check ((entity_type = 'section' and entity_id is null) or (entity_type <> 'section' and entity_id is not null));

create index if not exists documents_section_idx on public.documents(module_key, created_at desc)
  where entity_type = 'section' and deleted_at is null;

/** A file type the suite will not store: programs and anything a browser would run. */
create or replace function app.is_blocked_file(p_name text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select lower(coalesce(p_name, '')) ~ '\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|mjs|jar|sh|apk|dll|html?|xhtml|svg|php|asp|aspx|jsp|hta|lnk|reg)$';
$$;

-- ----------------------------------------------------------- table rules
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (created_by = (select auth.uid())
     and (select app.is_active_user())
     and not app.is_blocked_file(file_name)
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and (app.has_perm(module_key, 'create') or app.has_perm(module_key, 'edit')
          or (entity_type = 'section' and app.has_perm(module_key, 'view'))));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (deleted_at is null
     and (app.has_perm(module_key, 'edit')
          or (created_by = (select auth.uid()) and app.has_perm(module_key, 'view'))))
  with check (not app.is_blocked_file(file_name)
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (app.has_perm(module_key, 'delete')
     or app.has_perm('documents', 'delete')
     or (created_by = (select auth.uid())
         and (app.has_perm(module_key, 'edit')
              or (entity_type = 'section' and app.has_perm(module_key, 'view')))));

-- --------------------------------------------------------- storage rules
-- Path: <module key>/section/<uuid>-<file name> for a section library.
drop policy if exists documents_upload on storage.objects;
create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
     and not app.is_blocked_file(name)
     and (app.has_perm((storage.foldername(name))[1], 'create')
          or app.has_perm((storage.foldername(name))[1], 'edit')
          or ((storage.foldername(name))[2] = 'section'
              and app.has_perm((storage.foldername(name))[1], 'view'))));

drop policy if exists documents_remove on storage.objects;
create policy documents_remove on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
     and (app.has_perm((storage.foldername(name))[1], 'delete')
          or app.has_perm((storage.foldername(name))[1], 'edit')
          or app.has_perm('documents', 'delete')
          or owner_id = (select auth.uid())::text));

-- ------------------------------------------------- the Documents page
insert into public.modules
  (group_id, key, label, description, route, icon, sort_order, supported_actions, supports_scope, is_site_scoped, show_in_nav, is_enabled, phase)
select g.id, 'documents', 'Documents',
       'Work documents from every section you can open, in one place',
       '/documents', 'FolderOpen', 5, '{view,delete,export}', false, false, true, true, 1
from public.module_groups g where g.key = 'dashboard'
on conflict (key) do nothing;

-- Everyone may open it (it only lists what each section already lets them
-- see) and export their list; deleting anyone's document is for admins.
insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, a.action::public.perm_action, 'all'
from public.roles r
cross join public.modules m
cross join (values ('view'), ('export')) as a(action)
where m.key = 'documents'
on conflict do nothing;
insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, 'delete', 'all'
from public.roles r, public.modules m
where m.key = 'documents' and r.key in ('super_admin', 'admin')
on conflict do nothing;

-- ------------------------------------------------------------ listing
/**
 * Documents the caller may see, newest first, with who uploaded them and
 * what they may do with each. p_module limits to one section; p_scope is
 * 'section' (the section libraries), 'records' (attachments) or 'all'.
 */
create or replace function public.list_documents(
  p_module text default null,
  p_scope text default 'all',
  p_search text default null,
  p_category text default null,
  p_mine boolean default false,
  p_expiring boolean default false,
  p_limit int default 50,
  p_offset int default 0)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_sites uuid[] := app.my_site_ids();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v jsonb;
begin
  if not app.is_active_user() then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  with visible as (
    select d.*, m.label as module_label, m.route as module_route
    from public.documents d
    join public.modules m on m.key = d.module_key
    where d.deleted_at is null
      and app.has_perm(d.module_key, 'view')
      and (d.site_id is null or d.site_id = any (v_sites))
      and (p_module is null or d.module_key = p_module)
      and (coalesce(p_scope, 'all') = 'all'
           or (p_scope = 'section' and d.entity_type = 'section')
           or (p_scope = 'records' and d.entity_type <> 'section'))
      and (p_category is null or d.category = p_category)
      and (not coalesce(p_mine, false) or d.created_by = v_me)
      and (not coalesce(p_expiring, false) or d.valid_until <= v_today + 30)
      and (v_search is null
           or d.file_name ilike '%' || v_search || '%'
           or coalesce(d.category, '') ilike '%' || v_search || '%'
           or coalesce(d.notes, '') ilike '%' || v_search || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from visible),
    'categories', coalesce((select jsonb_agg(distinct category order by category) from visible where category is not null), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'module_key', x.module_key, 'module_label', x.module_label, 'module_route', x.module_route,
               'entity_type', x.entity_type, 'entity_id', x.entity_id,
               'category', x.category, 'file_name', x.file_name, 'storage_path', x.storage_path,
               'mime_type', x.mime_type, 'size_bytes', x.size_bytes, 'notes', x.notes,
               'valid_until', x.valid_until,
               'expiry', case when x.valid_until is null then null
                              when x.valid_until < v_today then 'expired'
                              when x.valid_until <= v_today + 30 then 'expiring' else 'valid' end,
               'site_id', x.site_id, 'site', s.name,
               'created_at', x.created_at, 'created_by', x.created_by,
               'uploaded_by', coalesce(p.full_name, p.email),
               'mine', x.created_by = v_me,
               'can_edit', app.has_perm(x.module_key, 'edit') or x.created_by = v_me,
               'can_delete', app.has_perm(x.module_key, 'delete') or app.has_perm('documents', 'delete')
                             or (x.created_by = v_me and (app.has_perm(x.module_key, 'edit') or x.entity_type = 'section')))
             order by x.created_at desc)
      from (select * from visible order by created_at desc
            limit greatest(coalesce(p_limit, 50), 0) offset greatest(coalesce(p_offset, 0), 0)) x
      left join public.profiles p on p.id = x.created_by
      left join public.sites s on s.id = x.site_id), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

grant execute on function public.list_documents(text, text, text, text, boolean, boolean, int, int) to authenticated;
revoke execute on function public.list_documents(text, text, text, text, boolean, boolean, int, int) from anon, public;
