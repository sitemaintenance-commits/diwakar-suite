-- =====================================================================
-- FOUNDER REMARKS ACROSS DEPARTMENTS
--
-- The legacy app has a panel where the founder picks a date, picks one
-- department or "All Departments", types an instruction and applies it
-- in one go. This is that, with two differences that matter:
--
--  * A remark can only attach to a report that exists. If a department
--    did not report that day there is nothing to attach it to, and the
--    call says so rather than inventing a blank report to hang it on.
--
--  * Sending the same text twice to the same report does nothing the
--    second time, so a double-click cannot double-post.
--
-- SECURITY INVOKER on purpose: the insert policy on review_actions and
-- the select policy on daily_reports both apply as they normally would,
-- so this cannot reach further than the caller could by hand.
-- =====================================================================

create or replace function public.save_review_remark(
  p_date date,
  p_comment text,
  p_department_ids uuid[] default null,
  p_action text default 'founder_remark'
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date);
  v_applied int := 0;
  v_already int := 0;
  v_targets uuid[];
  v_missing text[] := '{}';
  r record;
begin
  if p_action not in ('ccm_remark', 'founder_remark', 'returned') then
    raise exception 'Unknown remark type %.', p_action using errcode = '22023';
  end if;
  if v_comment is null then
    raise exception 'A remark needs some text.' using errcode = '22023';
  end if;
  if not (app.has_perm('daily.review', 'create') or app.has_perm('daily.review', 'approve')) then
    raise exception 'Access denied: daily.review CREATE or APPROVE permission required.'
      using errcode = '42501';
  end if;

  -- No departments named means every active one, which is what the
  -- legacy "All Departments" button does.
  if p_department_ids is null or cardinality(p_department_ids) = 0 then
    select array_agg(id) into v_targets from public.departments where status = 'active';
  else
    v_targets := p_department_ids;
  end if;

  for r in
    select d.id, d.name,
           (select dr.id from public.daily_reports dr
             where dr.department_id = d.id and dr.report_date = v_date
               and dr.deleted_at is null limit 1) as report_id
    from public.departments d
    where d.id = any (v_targets)
    order by d.name
  loop
    if r.report_id is null then
      v_missing := v_missing || r.name;
      continue;
    end if;
    if exists (select 1 from public.review_actions a
                where a.report_id = r.report_id and a.action = p_action
                  and a.comment is not distinct from v_comment) then
      v_already := v_already + 1;
      continue;
    end if;
    insert into public.review_actions (report_id, action, comment, reviewer_id)
    values (r.report_id, p_action, v_comment, auth.uid());
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object(
    'date', v_date,
    'action', p_action,
    'applied', v_applied,
    'already_had_it', v_already,
    'no_report_that_day', to_jsonb(v_missing));
end;
$$;

grant execute on function public.save_review_remark(date, text, uuid[], text) to authenticated;
revoke execute on function public.save_review_remark(date, text, uuid[], text) from anon, public;
