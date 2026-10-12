-- =====================================================================
-- DOCUMENT FOLDERS, FILLED BY THE FILE NAME
--
-- The company keeps its project and corporate papers in named folders:
-- PPA, PVSYST, LOI, LOA, Escrow, EPC, DPR, DDDP, CEIG, COI, SPV. The
-- Documents page now has these folders, and a document lands in its folder
-- by itself when its name says what it is -- "LOA - Niwai.pdf" goes to
-- Letter of Award, "CEIG APPROVAL - Sadas.pdf" to CEIG -- wherever in the
-- suite it is uploaded. It can be moved by hand afterwards.
--
--   document_folders  code, name, the words that identify it (keywords).
--                     A one-word keyword matches a whole word of the file
--                     name ("loa" matches "LOA - Niwai", not "Load"); a
--                     longer one matches the phrase ("letter of award").
--   documents.folder_id  set on upload when empty; existing documents are
--                     filed once now.
-- =====================================================================

create table if not exists public.document_folders (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  keywords   text[] not null default '{}',
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.document_folders enable row level security;
grant select on public.document_folders to authenticated;
drop policy if exists document_folders_read on public.document_folders;
create policy document_folders_read on public.document_folders for select to authenticated using (true);

insert into public.document_folders (code, name, keywords, sort_order) values
  ('PPA',    'Power Purchase Agreement - PPA',                    array['ppa', 'power purchase'], 10),
  ('PVSYST', 'Photovoltaic System Simulation Report - PVSYST',    array['pvsyst', 'pv syst', 'simulation report'], 20),
  ('LOI',    'Letter of Intent - LOI',                            array['loi', 'letter of intent'], 30),
  ('LOA',    'Letter of Award - LOA',                             array['loa', 'letter of award'], 40),
  ('ESCROW', 'Escrow Agreement',                                  array['escrow'], 50),
  ('EPC',    'Engineering, Procurement, and Construction - EPC',  array['epc', 'engineering procurement'], 60),
  ('DPR',    'Detailed Project Report - DPR',                     array['dpr', 'detailed project report'], 70),
  ('DDDP',   'Detailed Design & Drawing Package - DDDP',          array['dddp', 'drawing package', 'design drawing'], 80),
  ('CEIG',   'Chief Inspector of Electrical (to Government) - CIEG', array['ceig', 'cieg', 'chief inspector', 'electrical inspector'], 90),
  ('COI',    'Certificate of Incorporation - COI',                array['coi', 'certificate of incorporation'], 100),
  ('SPV',    'Special Purpose Vehicle - SPV',                     array['spv', 'special purpose vehicle'], 110)
on conflict (code) do nothing;

alter table public.documents
  add column if not exists folder_id uuid references public.document_folders(id) on delete set null;
create index if not exists documents_folder_idx on public.documents(folder_id) where deleted_at is null;

/** The folder a file name belongs to, or null: whole words for short keywords, phrases for long ones. */
create or replace function app.match_document_folder(p_name text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  with n as (
    -- "CEIG APPROVAL - Sadas.pdf" -> " ceig approval sadas pdf "
    select ' ' || btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')) || ' ' as t
  )
  select f.id
  from public.document_folders f, n
  where exists (select 1 from unnest(f.keywords) k
                where n.t like '% ' || btrim(regexp_replace(lower(k), '[^a-z0-9]+', ' ', 'g')) || ' %')
  order by f.sort_order
  limit 1;
$$;

create or replace function app.file_document_in_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.folder_id is null then
    new.folder_id := app.match_document_folder(new.file_name);
  end if;
  return new;
end;
$$;

drop trigger if exists file_in_folder on public.documents;
create trigger file_in_folder before insert on public.documents
  for each row execute function app.file_document_in_folder();

-- File what is already there.
update public.documents set folder_id = app.match_document_folder(file_name)
where folder_id is null and app.match_document_folder(file_name) is not null;

-- ------------------------------------------------------- the library
drop function if exists public.list_documents(text, text, text, text, boolean, boolean, int, int, text);

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
           or coalesce(d.notes, '') ilike '%' || v_search || '%')
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
      from (select * from shown order by created_at desc
            limit greatest(coalesce(p_limit, 50), 0) offset greatest(coalesce(p_offset, 0), 0)) x
      left join public.profiles p on p.id = x.created_by
      left join public.sites s on s.id = x.site_id
      left join public.document_folders fo on fo.id = x.folder_id), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

grant execute on function public.list_documents(text, text, text, text, boolean, boolean, int, int, text, uuid) to authenticated;
revoke execute on function public.list_documents(text, text, text, text, boolean, boolean, int, int, text, uuid) from anon, public;
grant execute on function app.match_document_folder(text) to authenticated;
