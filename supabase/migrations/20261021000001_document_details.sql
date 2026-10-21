-- =====================================================================
-- DOCUMENT DETAILS (INSURANCE POLICIES FIRST)
--
-- A document can carry structured details beside its file. An insurance
-- policy keeps what the Operation - Ground Mounted sheet tracks: company,
-- project, capacity, policy number, start and end dates, the insurer and
-- who looks after the renewal. The end date is also the document's
-- valid_until, so the renewal shows as expiring / expired like any other
-- document. Details are searchable and returned with the library rows.
-- =====================================================================

alter table public.documents add column if not exists details jsonb not null default '{}'::jsonb;

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
      and app.has_perm(d.module_key, 'view')
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
