-- =====================================================================
-- RENAME A DOCUMENT FOLDER; DASHBOARD WITHOUT THE INSURANCE CARD
--
--  * rename_document_folder(id, name, code): right-click a folder in
--    Documents. Anyone who can edit Documents, or who made the folder.
--  * The dashboard no longer shows the Insurance card (the renewal alerts
--    still go out), and the "Daily Work (HR)" card is called "HR".
-- =====================================================================

create or replace function public.rename_document_folder(p_id uuid, p_name text, p_code text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_code text := nullif(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]+', '', 'g')), '');
  f public.document_folders;
begin
  select * into f from public.document_folders where id = p_id;
  if f.id is null then
    raise exception 'Folder not found.' using errcode = 'P0002';
  end if;
  if not app.is_active_user() or not (app.has_perm('documents', 'edit') or f.created_by = auth.uid()) then
    raise exception 'Access denied: you cannot rename this folder.' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Give the folder a name of 2 to 80 characters.' using errcode = '22023';
  end if;
  v_code := left(coalesce(v_code, f.code), 16);
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

create or replace function public.get_company_today()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := app.company_today_core();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  a int; b int; c int; d int;
  v_light text;
begin
  -- ---------------------------------------------------------- Procurement
  if app.sees_all('proc.dashboard') then
    select count(*) into a from public.proc_requisitions where deleted_at is null and status = 'submitted';
    select count(*) into b from public.proc_purchase_orders
      where deleted_at is null and status in ('approved', 'issued', 'partially_received') and delivery_date < v_today;
    select count(*) into c from public.proc_items i
      left join (select item_id, sum(qty) q from public.proc_stock_moves group by item_id) s on s.item_id = i.id
      where i.deleted_at is null and i.is_active and i.min_stock > 0 and coalesce(s.q, 0) < i.min_stock;
    select count(*) into d from public.proc_purchase_orders
      where deleted_at is null and status in ('approved', 'issued', 'partially_received');
    begin
      v_light := case when b > 0 then 'bad' when a > 0 or c > 0 then 'ok' else 'good' end;
      v := jsonb_set(v, '{sections}', coalesce(v->'sections', '[]'::jsonb) || jsonb_build_object(
        'key', 'procurement', 'title', 'Procurement', 'route', '/procurement', 'status', v_light,
        'headline', format('%s late deliveries', b),
        'facts', jsonb_build_array(
          format('%s open purchase order(s)', d),
          format('%s requisition(s) awaiting approval', a),
          format('%s item(s) below minimum stock', c))));
    end;
  end if;
  -- The O&M card opens the Solar Monitor; the HR card is called just "HR".
  v := jsonb_set(v, '{sections}', coalesce((
    select jsonb_agg(case when s->>'key' = 'om' then jsonb_set(s, '{route}', '"/operations/monitor"')
                          when s->>'key' = 'hr' then jsonb_set(s, '{title}', '"HR"') else s end)
    from jsonb_array_elements(v->'sections') s), '[]'::jsonb));
  return v;
end;
$$;
