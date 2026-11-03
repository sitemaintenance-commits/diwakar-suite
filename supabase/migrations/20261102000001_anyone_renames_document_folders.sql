-- =====================================================================
-- EVERYONE MAY RENAME A DOCUMENT FOLDER
--
-- Any active user can now rename any folder on the Documents page (its
-- short name and full name), not only Super Admin, Admin and the person
-- who made the folder. Inactive users still cannot.
-- =====================================================================

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
  if not app.is_active_user() then
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
