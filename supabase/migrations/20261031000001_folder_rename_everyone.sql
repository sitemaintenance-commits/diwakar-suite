-- Everyone signed in can rename a document folder, not only who may edit Documents.

create or replace function public.rename_document_folder(p_id uuid, p_name text, p_code text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  -- Letters, digits and single spaces: "INSURANCE DOC".
  v_code text := nullif(btrim(upper(regexp_replace(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9 ]+', '', 'g'), ' +', ' ', 'g'))), '');
  f public.document_folders;
begin
  select * into f from public.document_folders where id = p_id;
  if f.id is null then
    raise exception 'Folder not found.' using errcode = 'P0002';
  end if;
  if not app.is_active_user() then
    raise exception 'Access denied: you cannot rename this folder.' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Give the folder a name of 2 to 80 characters.' using errcode = '22023';
  end if;
  v_code := btrim(left(coalesce(v_code, f.code), 24));
  if exists (select 1 from public.document_folders where lower(name) = lower(v_name) and id <> p_id) then
    raise exception 'Another folder is already called %.', v_name using errcode = '23505';
  end if;
  if exists (select 1 from public.document_folders where code = v_code and id <> p_id) then
    raise exception 'Another folder already has the short name %.', v_code using errcode = '23505';
  end if;
  update public.document_folders set name = v_name, code = v_code where id = p_id returning * into f;
  return jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name);
end;
$$;
revoke all on function public.rename_document_folder(uuid, text, text) from public, anon;
grant execute on function public.rename_document_folder(uuid, text, text) to authenticated;
