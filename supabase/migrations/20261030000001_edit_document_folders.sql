-- =====================================================================
-- EDIT A DOCUMENT FOLDER
--
-- A folder opened on the Documents page can be renamed: its short name
-- (the code on the tile: LOA, INSURANCE DOC ...) and its full name (shown
-- under it and in the folder dropdowns). Documents stay in the folder.
--
--  * Documents gets an "edit" action, given to Super Admin and Admin, who
--    may edit every folder.
--  * Whoever made a folder of their own may edit that folder.
-- =====================================================================

update public.modules set supported_actions = '{view,edit,delete,export}', updated_at = now()
where key = 'documents';

insert into public.role_permissions (role_id, module_id, action, scope)
select r.id, m.id, 'edit', 'all'
from public.roles r, public.modules m
where m.key = 'documents' and r.key in ('super_admin', 'admin')
on conflict do nothing;

/** Renames a folder: short name (upper case) and full name, both unique. */
create or replace function public.update_document_folder(p_id uuid, p_code text, p_name text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', ' ', 'g'));
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  f public.document_folders;
begin
  select * into f from public.document_folders where id = p_id;
  if f.id is null then
    raise exception 'Folder not found.' using errcode = 'P0002';
  end if;
  if not (app.has_perm('documents', 'edit')
          or (app.is_active_user() and f.is_custom and f.created_by = auth.uid())) then
    raise exception 'You cannot edit this folder.' using errcode = '42501';
  end if;
  if length(v_code) < 2 or length(v_code) > 30 then
    raise exception 'Give the folder a short name of 2 to 30 characters.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Give the folder a full name of 2 to 80 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.document_folders where id <> p_id and code = v_code) then
    raise exception 'Another folder already has the short name %.', v_code using errcode = '23505';
  end if;
  if exists (select 1 from public.document_folders where id <> p_id and lower(name) = lower(v_name)) then
    raise exception 'Another folder is already called %.', v_name using errcode = '23505';
  end if;
  update public.document_folders set code = v_code, name = v_name where id = p_id
  returning * into f;
  return jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name);
end;
$$;
revoke all on function public.update_document_folder(uuid, text, text) from public, anon;
grant execute on function public.update_document_folder(uuid, text, text) to authenticated;
