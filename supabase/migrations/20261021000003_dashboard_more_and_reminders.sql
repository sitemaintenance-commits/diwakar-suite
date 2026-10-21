-- =====================================================================
-- DASHBOARD: INSURANCE AND PROCUREMENT · DAILY REMINDERS
--
-- "Today in the company" gains two sections for whoever can see them:
--   * Insurance  -- policies expired or due for renewal (from Documents);
--   * Procurement -- requisitions waiting, late deliveries, low stock.
-- The existing sections are untouched: the old function becomes
-- app.company_today_core() and the new get_company_today() adds to it.
--
-- A daily 9 am job also nudges:
--   * the approver of a request that has waited 3 or 7 days;
--   * the procurement team (else the Super Admins) on Mondays, about
--     items below their minimum stock.
-- =====================================================================

alter function public.get_company_today() set schema app;
alter function app.get_company_today() rename to company_today_core;
revoke all on function app.company_today_core() from public, anon, authenticated;

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
  if app.has_perm('documents', 'view') then
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
    if a > 0 then
      v_light := case when b > 0 then 'bad' when c > 0 then 'ok' else 'good' end;
      v := jsonb_set(v, '{sections}', coalesce(v->'sections', '[]'::jsonb) || jsonb_build_object(
        'key', 'insurance', 'title', 'Insurance', 'route', '/documents', 'status', v_light,
        'headline', format('%s policies need renewal within 15 days (of %s)', b + c, a),
        'facts', jsonb_build_array(
          case when b > 0 then format('%s expired', b) else 'None expired' end,
          format('%s more due in 16-30 days', d))));
    end if;
  end if;

  -- ---------------------------------------------------------- Procurement
  if app.has_perm('proc.dashboard', 'view') then
    select count(*) into a from public.proc_requisitions where deleted_at is null and status = 'submitted';
    select count(*) into b from public.proc_purchase_orders
      where deleted_at is null and status in ('approved', 'issued', 'partially_received') and delivery_date < v_today;
    select count(*) into c from public.proc_items i
      left join (select item_id, sum(qty) q from public.proc_stock_moves group by item_id) s on s.item_id = i.id
      where i.deleted_at is null and i.is_active and i.min_stock > 0 and coalesce(s.q, 0) < i.min_stock;
    select count(*) into d from public.proc_purchase_orders
      where deleted_at is null and status in ('approved', 'issued', 'partially_received');
    if a + b + c + d > 0 or exists (select 1 from public.proc_items where deleted_at is null) then
      v_light := case when b > 0 then 'bad' when a > 0 or c > 0 then 'ok' else 'good' end;
      v := jsonb_set(v, '{sections}', coalesce(v->'sections', '[]'::jsonb) || jsonb_build_object(
        'key', 'procurement', 'title', 'Procurement', 'route', '/procurement', 'status', v_light,
        'headline', format('%s late deliveries', b),
        'facts', jsonb_build_array(
          format('%s open purchase order(s)', d),
          format('%s requisition(s) awaiting approval', a),
          format('%s item(s) below minimum stock', c))));
    end if;
  end if;
  return v;
end;
$$;
grant execute on function public.get_company_today() to authenticated;
revoke execute on function public.get_company_today() from anon, public;

-- --------------------------------------------------------------- reminders
create table if not exists public.reminder_log (
  key     text not null,
  sent_on date not null,
  primary key (key, sent_on)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

create or replace function app.send_daily_reminders()
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  s record;
  u uuid;
  n int := 0;
  v_low int;
begin
  -- Requests that have waited 3 or 7 days at the same level.
  for s in
    select st.id, st.request_id, a.request_no, a.title,
           v_today - (st.activated_at at time zone 'Asia/Kolkata')::date as waited
    from public.approval_steps st
    join public.approval_requests a on a.id = st.request_id and a.round = st.round
    where st.status = 'pending' and a.status in ('submitted', 'pending', 'in_review') and st.activated_at is not null
  loop
    continue when s.waited not in (3, 7);
    continue when exists (select 1 from public.reminder_log where key = 'step:' || s.id || ':' || s.waited);
    insert into public.reminder_log values ('step:' || s.id || ':' || s.waited, v_today) on conflict do nothing;
    for u in select app.step_approver_users(s.id) loop
      perform app.notify(u, 'approval.reminder', s.request_no || ' has waited ' || s.waited || ' days for your approval', s.title, s.request_id);
      n := n + 1;
    end loop;
  end loop;

  -- Low stock, on Mondays.
  if extract(isodow from v_today) = 1
     and not exists (select 1 from public.reminder_log where key = 'low-stock' and sent_on = v_today) then
    select count(*) into v_low from public.proc_items i
      left join (select item_id, sum(qty) q from public.proc_stock_moves group by item_id) st on st.item_id = i.id
      where i.deleted_at is null and i.is_active and i.min_stock > 0 and coalesce(st.q, 0) < i.min_stock;
    if v_low > 0 then
      insert into public.reminder_log values ('low-stock', v_today) on conflict do nothing;
      for u in
        select distinct ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id
        join public.profiles p on p.id = ur.user_id and p.status = 'active'
        where r.key = case when exists (select 1 from public.user_roles ur2 join public.roles r2 on r2.id = ur2.role_id where r2.key = 'procurement')
                           then 'procurement' else 'super_admin' end
      loop
        insert into public.notifications (user_id, kind, title, body, link, entity_type)
        values (u, 'proc.low_stock', v_low || ' item(s) below minimum stock', 'Open Stores & Inventory to reorder.', '/procurement/inventory', 'procurement');
        n := n + 1;
      end loop;
    end if;
  end if;
  return n;
end;
$$;
revoke all on function app.send_daily_reminders() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('daily-reminders') where exists (select 1 from cron.job where jobname = 'daily-reminders');
  perform cron.schedule('daily-reminders', '35 3 * * *', 'select app.send_daily_reminders()');
exception when others then
  raise notice 'pg_cron not available; reminders not scheduled';
end $$;
