-- =====================================================================
-- MENU ORDER AND WHERE THE O&M CARD GOES
--
--  * O&M menu: Solar Monitor first, then Generation Sites, then Daily Entry.
--  * Department Review menu: Review Summary first, Department Reports
--    second, Management Review third.
--  * The dashboard's O&M card opens the Solar Monitor.
-- =====================================================================

update public.modules set sort_order = v.ord, updated_at = now()
  from (values ('om.monitor', 1), ('om.sites', 20), ('om.daily_entry', 25),
               ('daily.summary', 5), ('daily.reports', 10), ('daily.review', 30)) v(key, ord)
 where modules.key = v.key;

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
  -- ------------------------------------------------------------ Insurance
  if app.sees_all('documents') and app.has_perm('documents', 'edit') then
    with pol as (
      select coalesce(nullif(doc.details->>'end_date', '')::date, doc.valid_until) as end_date
      from public.documents doc
      left join public.document_folders f on f.id = doc.folder_id
      where doc.deleted_at is null
        and (lower(coalesce(doc.category, '')) = 'insurance' or f.name ilike '%insur%' or doc.details ? 'policy_no'))
    select count(*), count(*) filter (where end_date < v_today),
           count(*) filter (where end_date between v_today and v_today + 15),
           count(*) filter (where end_date between v_today + 16 and v_today + 30)
      into a, b, c, d
      from pol where end_date is not null;
    begin
      v_light := case when b > 0 then 'bad' when c > 0 then 'ok' else 'good' end;
      v := jsonb_set(v, '{sections}', coalesce(v->'sections', '[]'::jsonb) || jsonb_build_object(
        'key', 'insurance', 'title', 'Insurance', 'route', '/documents', 'status', v_light,
        'headline', format('%s policies need renewal within 15 days (of %s)', b + c, a),
        'facts', jsonb_build_array(
          case when a = 0 then 'No policy dates yet: add them on insurance documents in Documents'
               when b > 0 then format('%s expired', b) else 'None expired' end,
          format('%s more due in 16-30 days', d))));
    end;
  end if;

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
  -- The O&M card opens the Solar Monitor (yesterday's readings), not the entry form.
  v := jsonb_set(v, '{sections}', coalesce((
    select jsonb_agg(case when s->>'key' = 'om' then jsonb_set(s, '{route}', '"/operations/monitor"') else s end)
    from jsonb_array_elements(v->'sections') s), '[]'::jsonb));
  return v;
end;
$$;
