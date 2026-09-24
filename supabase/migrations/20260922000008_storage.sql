-- =====================================================================
-- Storage: private "avatars" bucket for profile photos.
-- Files live at avatars/<user_id>/<file>. Users manage their own folder;
-- user administrators may manage anyone's. Reading requires an active
-- account (the app uses short-lived signed URLs).
-- Module document buckets are added by their phases.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (select app.is_active_user()));

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select app.has_perm('admin.users', 'edit'))));

create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select app.has_perm('admin.users', 'edit'))));

create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select app.has_perm('admin.users', 'edit'))));
