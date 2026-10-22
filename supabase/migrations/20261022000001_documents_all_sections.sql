-- =====================================================================
-- THE DOCUMENTS PAGE COVERS EVERY SECTION
--
-- Section libraries (files filed under a section on the Documents page)
-- are now open to everyone with Documents access, whichever sections they
-- can open themselves: the category and section dropdowns list every
-- section, and what is filed there can be seen and downloaded. Files
-- attached to a record (a tender, an approval, a DPR...) keep the record's
-- own rules, and the plant (site) restriction still applies.
-- =====================================================================

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (deleted_at is null
     and (select app.is_active_user())
     and (app.has_perm(module_key, 'view') or (entity_type = 'section' and app.has_perm('documents', 'view')))
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and (entity_type <> 'approval' or app.can_see_approval(entity_id)));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (created_by = (select auth.uid())
     and (select app.is_active_user())
     and not app.is_blocked_file(file_name)
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[]))
     and (app.has_perm(module_key, 'create') or app.has_perm(module_key, 'edit')
          or (entity_type = 'section' and (app.has_perm(module_key, 'view') or app.has_perm('documents', 'view'))))
     and (entity_type <> 'approval' or app.can_see_approval(entity_id)));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (app.has_perm(module_key, 'delete')
     or app.has_perm('documents', 'delete')
     or (created_by = (select auth.uid())
         and (app.has_perm(module_key, 'edit') or entity_type = 'section')));

drop policy if exists documents_upload on storage.objects;
create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
     and not app.is_blocked_file(name)
     and (app.has_perm((storage.foldername(name))[1], 'create')
          or app.has_perm((storage.foldername(name))[1], 'edit')
          or ((storage.foldername(name))[2] = 'section'
              and (app.has_perm((storage.foldername(name))[1], 'view') or app.has_perm('documents', 'view')))));

create or replace function public.list_documents(
  p_module text default null,
  p_scope text default 'all',
  p_search text default null,
  p_category text default null,
  p_mine boolean default false,
  p_expiring boolean default false,
  p_limit int default 50,
  p_offset int default 0,
  p_group text default null,
  p_folder uuid default null)
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
    select d.*, m.label as module_label, m.route as module_route, g.key as group_key, g.label as group_label
    from public.documents d
    join public.modules m on m.key = d.module_key
    join public.module_groups g on g.id = m.group_id
    where d.deleted_at is null
      and (app.has_perm(d.module_key, 'view') or (d.entity_type = 'section' and app.has_perm('documents', 'view')))
      and (d.site_id is null or d.site_id = any (v_sites))
      and (p_module is null or d.module_key = p_module)
      and (p_group is null or g.key = p_group)
      and (coalesce(p_scope, 'all') = 'all'
           or (p_scope = 'section' and d.entity_type = 'section')
           or (p_scope = 'records' and d.entity_type <> 'section'))
      and (p_category is null or d.category = p_category)
      and (not coalesce(p_mine, false) or d.created_by = v_me)
      and (not coalesce(p_expiring, false) or d.valid_until <= v_today + 30)
      and (v_search is null
           or d.file_name ilike '%' || v_search || '%'
           or coalesce(d.category, '') ilike '%' || v_search || '%'
           or coalesce(d.notes, '') ilike '%' || v_search || '%'
           or coalesce(d.details::text, '') ilike '%' || v_search || '%')
  ),
  shown as (select * from visible where p_folder is null or folder_id = p_folder)
  select jsonb_build_object(
    'total', (select count(*) from shown),
    'categories', coalesce((select jsonb_agg(distinct category order by category) from shown where category is not null), '[]'::jsonb),
    -- every folder with how many of the documents above it holds (whatever folder is open)
    'folders', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name,
                                          'count', (select count(*) from visible v where v.folder_id = f.id))
                       order by f.sort_order, f.name)
      from public.document_folders f), '[]'::jsonb),
    'unfiled', (select count(*) from visible where folder_id is null),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'module_key', x.module_key, 'module_label', x.module_label, 'module_route', x.module_route,
               'group_key', x.group_key, 'group_label', x.group_label,
               'entity_type', x.entity_type, 'entity_id', x.entity_id,
               'category', x.category, 'file_name', x.file_name, 'storage_path', x.storage_path,
               'mime_type', x.mime_type, 'size_bytes', x.size_bytes, 'notes', x.notes,
               'folder_id', x.folder_id, 'folder', fo.code,
               'valid_until', x.valid_until, 'details', x.details,
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
      from (select * from shown order by created_at desc
            limit greatest(coalesce(p_limit, 50), 0) offset greatest(coalesce(p_offset, 0), 0)) x
      left join public.profiles p on p.id = x.created_by
      left join public.sites s on s.id = x.site_id
      left join public.document_folders fo on fo.id = x.folder_id), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- Whoever filed a file in a section library can still correct its details.
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (deleted_at is null
     and (app.has_perm(module_key, 'edit')
          or (created_by = (select auth.uid()) and (app.has_perm(module_key, 'view') or entity_type = 'section'))))
  with check (not app.is_blocked_file(file_name)
     and (site_id is null or site_id = any ((select app.my_site_ids())::uuid[])));
