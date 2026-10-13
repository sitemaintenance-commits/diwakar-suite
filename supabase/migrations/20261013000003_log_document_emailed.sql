-- The send-document function records each email ("document.emailed": who
-- sent which files to whom) through log_event, which only accepted a fixed
-- list of events -- so the record was refused and nothing was logged. It is
-- now accepted from anyone who can open the documents.
create or replace function public.log_event(p_action text, p_module text default null,
                                            p_summary text default null, p_details jsonb default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if p_action not in ('logout', 'export', 'password.change', 'user.invite', 'user.password_reset', 'user.resend_invite',
                      'document.emailed') then
    raise exception 'Event type not allowed.' using errcode = '22023';
  end if;
  if p_action = 'export' and (p_module is null or not app.has_perm(p_module, 'export')) then
    raise exception 'Export not permitted.' using errcode = '42501';
  end if;
  if p_action in ('user.invite', 'user.password_reset', 'user.resend_invite')
     and not app.has_perm('admin.users', 'edit') and not app.has_perm('admin.users', 'create') then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  perform app.write_audit(p_action, p_module, null, null, left(p_summary, 500), p_details);
end;
$$;
