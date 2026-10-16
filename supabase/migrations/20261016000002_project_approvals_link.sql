-- =====================================================================
-- PROJECT APPROVALS GO THROUGH THE APPROVALS SECTION
--
-- A project's statutory approval (DISCOM, CEIG, net metering...) or a
-- vendor bill can now be sent for internal approval. The request is an
-- ordinary approval request -- the same form, the same multi-level chain,
-- the same notifications -- that remembers where it came from:
--
--   * approval_requests.source_type / source_id point at the project
--     approval or vendor bill; project_id is filled from it.
--   * approval_link_source() links a request its requester just created.
--     The requester must be able to see the item (row level security of the
--     projects tables decides that, as everywhere else).
--   * When a request linked to a vendor bill is approved, the bill moves to
--     Accounts approved; when it is rejected, the bill is Rejected. The
--     bill's own two-step guard is bypassed for that one move only, since
--     the approval chain is the check.
--   * project_approval_requests() lists the requests for a project (or for
--     every project the caller can see), for the projects pages.
-- =====================================================================

alter table public.approval_requests
  add column if not exists source_type text check (source_type in ('project_approval', 'vendor_bill')),
  add column if not exists source_id   uuid;
create index if not exists approval_requests_source_idx on public.approval_requests(source_type, source_id) where source_id is not null;
create index if not exists approval_requests_project_idx on public.approval_requests(project_id) where project_id is not null;

/** Whether the caller can see a project approval or vendor bill (runs as the caller, so RLS applies). */
create or replace function app.project_source_project(p_type text, p_id uuid)
returns uuid
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_type = 'project_approval' then
    select project_id into v from public.project_approvals where id = p_id and deleted_at is null;
  elsif p_type = 'vendor_bill' then
    select project_id into v from public.vendor_bills where id = p_id and deleted_at is null;
  end if;
  return v;
end;
$$;
grant execute on function app.project_source_project(text, uuid) to authenticated;

/** Links a request the caller raised to the project item it is about. */
create or replace function public.approval_link_source(p_request uuid, p_type text, p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  v_project uuid;
begin
  perform app.approval_assert_user();
  select * into a from public.approval_requests where id = p_request;
  if a.id is null or a.requested_by is distinct from auth.uid() then
    raise exception 'Only the requester can link this request.' using errcode = '42501';
  end if;
  if a.status in ('cancelled', 'completed', 'rejected') then
    raise exception 'This request is closed.' using errcode = '22023';
  end if;
  if p_type not in ('project_approval', 'vendor_bill') then
    raise exception 'Unknown item type.' using errcode = '22023';
  end if;
  v_project := app.project_source_project(p_type, p_id);
  if v_project is null then
    raise exception 'That project item was not found, or you cannot see it.' using errcode = '42501';
  end if;
  update public.approval_requests
     set source_type = p_type, source_id = p_id, project_id = v_project, updated_by = auth.uid()
   where id = p_request;
  perform app.approval_log(p_request, 'edited', null, null, null, null, 'Requester',
    jsonb_build_object('changes', jsonb_build_object('linked to', jsonb_build_object('from', null,
      'to', case p_type when 'vendor_bill' then 'vendor bill' else 'project approval' end))));
end;
$$;
revoke all on function public.approval_link_source(uuid, text, uuid) from public, anon;
grant execute on function public.approval_link_source(uuid, text, uuid) to authenticated;

/**
 * Approval requests for one project (or all projects when p_project is
 * null) that the caller may see, newest first, with what they are linked to.
 */
create or replace function public.project_approval_requests(p_project uuid default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'request_no', a.request_no, 'title', a.title, 'category', a.category,
           'status', a.status, 'amount', a.amount, 'project_id', a.project_id,
           'source_type', a.source_type, 'source_id', a.source_id,
           'requester', app.user_name(a.requested_by), 'created_at', a.created_at,
           'current_approver', (select app.step_approver_label(s.id) from public.approval_steps s
                                where s.request_id = a.id and s.round = a.round and s.status = 'pending'
                                order by s.level_no limit 1))
         order by a.created_at desc), '[]'::jsonb)
  from public.approval_requests a
  where a.project_id is not null
    and (p_project is null or a.project_id = p_project)
    and (a.status <> 'draft' or a.requested_by = auth.uid())
    and app.can_see_approval(a.id)
$$;
revoke all on function public.project_approval_requests(uuid) from public, anon;
grant execute on function public.project_approval_requests(uuid) to authenticated;

-- The vendor bill guard: unchanged, except the approval chain may move a bill.
create or replace function app.guard_vendor_bill()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.status is not distinct from old.status
     or coalesce(current_setting('app.approval_sync', true), '') = 'on' then
    return new;
  end if;

  if new.status = 'pm_approved' then
    if old.status <> 'submitted' then
      raise exception 'Only a submitted bill can be approved by the project manager.' using errcode = '22023';
    end if;
    if not app.has_perm('projects.bills', 'approve') then
      raise exception 'Approving a vendor bill requires the APPROVE permission.' using errcode = '42501';
    end if;
    new.pm_approved_by := auth.uid();
    new.pm_approved_at := now();

  elsif new.status = 'accounts_approved' then
    if old.status <> 'pm_approved' then
      raise exception 'The project manager must approve the bill before accounts can.' using errcode = '22023';
    end if;
    if not app.has_perm('projects.payments', 'approve') then
      raise exception 'The accounts approval requires the APPROVE permission on payments.' using errcode = '42501';
    end if;
    -- Two pairs of eyes on the money: whoever approved as project
    -- manager cannot also give the accounts approval.
    if auth.uid() = old.pm_approved_by and not app.is_super_admin() then
      raise exception 'The same person cannot give both approvals.' using errcode = '42501';
    end if;
    new.accounts_approved_by := auth.uid();
    new.accounts_approved_at := now();

  elsif new.status = 'paid' then
    if old.status <> 'accounts_approved' then
      raise exception 'A bill can only be paid after the accounts approval.' using errcode = '22023';
    end if;
    if not app.has_perm('projects.payments', 'approve') then
      raise exception 'Marking a bill paid requires the APPROVE permission on payments.' using errcode = '42501';
    end if;
    new.paid_on := coalesce(new.paid_on, (now() at time zone 'Asia/Kolkata')::date);

  elsif new.status = 'rejected' then
    if not app.has_perm('projects.bills', 'approve') then
      raise exception 'Rejecting a vendor bill requires the APPROVE permission.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

/** A decision on a request linked to a vendor bill moves the bill. */
create or replace function app.sync_approval_source()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.source_type is distinct from 'vendor_bill' or new.source_id is null
     or new.status is not distinct from old.status then
    return new;
  end if;
  perform set_config('app.approval_sync', 'on', true);
  if new.status = 'approved' then
    update public.vendor_bills
       set status = 'accounts_approved',
           pm_approved_by = coalesce(pm_approved_by, auth.uid()),
           pm_approved_at = coalesce(pm_approved_at, now()),
           accounts_approved_by = auth.uid(),
           accounts_approved_at = now()
     where id = new.source_id and status in ('submitted', 'pm_approved');
  elsif new.status = 'rejected' then
    update public.vendor_bills set status = 'rejected'
     where id = new.source_id and status in ('submitted', 'pm_approved');
  end if;
  perform set_config('app.approval_sync', 'off', true);
  return new;
end;
$$;

drop trigger if exists sync_source on public.approval_requests;
create trigger sync_source after update of status on public.approval_requests
  for each row execute function app.sync_approval_source();
