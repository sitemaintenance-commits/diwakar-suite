-- Snapshot of supabase/schema.sql as first released (before Videos).
-- Used only by rls.test.mjs to prove the current schema upgrades it safely.
-- Do not edit.
-- =====================================================================
-- My Vault — complete Supabase schema
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query
-- It is idempotent: safe to re-run after edits.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
-- pg_trgm powers fast substring search ("inv" matches "invoice-2024.pdf")
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Profiles (one row per auth user)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null default '' check (char_length(full_name) <= 120),
  avatar_path         text,
  preferences         jsonb not null default '{}'::jsonb,
  -- Per-user storage quota. Default 1 GB (the Supabase Free plan total).
  -- Raise it with:  update public.profiles set storage_quota_bytes = 100 * 1024^3;
  storage_quota_bytes bigint not null default 1073741824 check (storage_quota_bytes >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may read and edit only their own profile...
drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (avatar_path is null or split_part(avatar_path, '/', 1) = (select auth.uid())::text)
  );

-- ...and only these columns. A user can never raise their own quota.
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, avatar_path, preferences) on public.profiles to authenticated;

-- Create a profile automatically whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users created before this script ran.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. Files (metadata for every stored object)
-- ---------------------------------------------------------------------
create table if not exists public.files (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  original_name    text not null check (char_length(original_name) between 1 and 255),
  display_name     text not null check (char_length(display_name) between 1 and 255),
  storage_path     text not null unique,
  thumbnail_path   text,
  mime_type        text not null default 'application/octet-stream',
  extension        text not null default '',
  -- To add a category later: extend this check + src/lib/categories.ts
  category         text not null check (category in ('image', 'screenshot', 'pdf', 'document', 'other')),
  size_bytes       bigint not null check (size_bytes >= 0),
  width            integer,
  height           integer,
  page_count       integer,
  is_favorite      boolean not null default false,
  tags             text[] not null default '{}',
  description      text not null default '' check (char_length(description) <= 2000),
  search_text      text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_accessed_at timestamptz,
  deleted_at       timestamptz,
  -- Object key layout: <user-id>/<category-folder>/<file-uuid>.<ext>
  constraint files_storage_path_format check (
    storage_path ~ '^[0-9a-f-]{36}/(images|screenshots|pdfs|documents|other)/[^/]+$'
  ),
  -- Executables are never accepted (mirrored in the storage policy below).
  constraint files_extension_not_blocked check (
    extension not in ('exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'jar', 'app', 'dll', 'sh')
  )
);

-- Indexes tuned for the app's queries (always scoped to user_id).
create index if not exists files_user_active_created_idx
  on public.files (user_id, created_at desc) where deleted_at is null;
create index if not exists files_user_category_created_idx
  on public.files (user_id, category, created_at desc) where deleted_at is null;
create index if not exists files_user_favorite_idx
  on public.files (user_id, created_at desc) where is_favorite and deleted_at is null;
create index if not exists files_user_accessed_idx
  on public.files (user_id, last_accessed_at desc) where last_accessed_at is not null and deleted_at is null;
create index if not exists files_user_trash_idx
  on public.files (user_id, deleted_at desc) where deleted_at is not null;
create index if not exists files_user_size_idx
  on public.files (user_id, size_bytes desc);
create index if not exists files_user_name_idx
  on public.files (user_id, lower(display_name));
create index if not exists files_search_trgm_idx
  on public.files using gin (search_text extensions.gin_trgm_ops);
create index if not exists files_tags_idx
  on public.files using gin (tags);

alter table public.files enable row level security;

drop policy if exists "files: select own" on public.files;
create policy "files: select own" on public.files
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "files: insert own" on public.files;
create policy "files: insert own" on public.files
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and (thumbnail_path is null or split_part(thumbnail_path, '/', 1) = (select auth.uid())::text)
  );

drop policy if exists "files: update own" on public.files;
create policy "files: update own" on public.files
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (thumbnail_path is null or split_part(thumbnail_path, '/', 1) = (select auth.uid())::text)
  );

drop policy if exists "files: delete own" on public.files;
create policy "files: delete own" on public.files
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.files from anon;
grant select, insert, update, delete on public.files to authenticated;

-- Normalise input, protect immutable columns, maintain search_text.
create or replace function public.files_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id      is distinct from old.user_id
    or new.storage_path is distinct from old.storage_path
    or new.original_name is distinct from old.original_name
    or new.size_bytes   is distinct from old.size_bytes
    or new.mime_type    is distinct from old.mime_type
    or new.extension    is distinct from old.extension
    or new.created_at   is distinct from old.created_at then
      raise exception 'IMMUTABLE_COLUMN' using hint = 'Storage path, size, type and owner cannot be changed.';
    end if;
    -- Only images and screenshots may be moved between each other.
    if new.category is distinct from old.category
       and not (old.category in ('image', 'screenshot') and new.category in ('image', 'screenshot')) then
      raise exception 'INVALID_CATEGORY_CHANGE';
    end if;
    new.updated_at := now();
  end if;

  new.display_name := btrim(new.display_name);
  if new.display_name = '' then
    raise exception 'EMPTY_NAME' using hint = 'File name cannot be empty.';
  end if;
  new.extension := lower(new.extension);
  new.description := btrim(coalesce(new.description, ''));

  -- Tags: lower-case, trimmed, unique, max 30 tags of max 40 chars.
  select coalesce(array_agg(t order by t), '{}')
    into new.tags
    from (
      select distinct left(lower(btrim(x)), 40) as t
      from unnest(coalesce(new.tags, '{}')) as x
      where btrim(x) <> ''
    ) s;
  if cardinality(new.tags) > 30 then
    raise exception 'TOO_MANY_TAGS' using hint = 'A file can have at most 30 tags.';
  end if;

  new.search_text := lower(concat_ws(' ',
    new.display_name, new.original_name, new.extension, new.category,
    array_to_string(new.tags, ' '), new.description));
  return new;
end;
$$;

drop trigger if exists files_before_write on public.files;
create trigger files_before_write
  before insert or update on public.files
  for each row execute function public.files_before_write();

-- Enforce the per-user storage quota on insert.
create or replace function public.files_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used  bigint;
  quota bigint;
begin
  select coalesce(sum(size_bytes), 0) into used from public.files where user_id = new.user_id;
  select storage_quota_bytes into quota from public.profiles where id = new.user_id;
  if quota is not null and used + new.size_bytes > quota then
    raise exception 'STORAGE_LIMIT_EXCEEDED'
      using hint = 'Your vault storage quota is full. Empty the trash or raise the quota.';
  end if;
  return new;
end;
$$;

drop trigger if exists files_enforce_quota on public.files;
create trigger files_enforce_quota
  before insert on public.files
  for each row execute function public.files_enforce_quota();

-- Aggregate stats in one round-trip (never fetch all rows to count them).
create or replace function public.vault_stats()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'total_files', count(*) filter (where f.deleted_at is null),
    'images',      count(*) filter (where f.deleted_at is null and f.category = 'image'),
    'screenshots', count(*) filter (where f.deleted_at is null and f.category = 'screenshot'),
    'pdfs',        count(*) filter (where f.deleted_at is null and f.category = 'pdf'),
    'documents',   count(*) filter (where f.deleted_at is null and f.category = 'document'),
    'other',       count(*) filter (where f.deleted_at is null and f.category = 'other'),
    'favorites',   count(*) filter (where f.deleted_at is null and f.is_favorite),
    'trash',       count(*) filter (where f.deleted_at is not null),
    'recent_7d',   count(*) filter (where f.deleted_at is null and f.created_at > now() - interval '7 days'),
    'total_bytes', coalesce(sum(f.size_bytes), 0),
    'trash_bytes', coalesce(sum(f.size_bytes) filter (where f.deleted_at is not null), 0),
    'bytes_by_category', coalesce((
      select json_object_agg(s.category, s.bytes)
      from (
        select category, sum(size_bytes) as bytes
        from public.files
        where user_id = (select auth.uid())
        group by category
      ) s
    ), '{}'::json),
    'quota_bytes', (select p.storage_quota_bytes from public.profiles p where p.id = (select auth.uid()))
  )
  from public.files f
  where f.user_id = (select auth.uid());
$$;

revoke all on function public.vault_stats() from public, anon;
grant execute on function public.vault_stats() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Storage: private bucket + per-user folder policies
-- ---------------------------------------------------------------------
-- file_size_limit: 50 MB (Free plan maximum). Raise on paid plans and set
-- VITE_MAX_UPLOAD_MB to match.
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault-files', 'vault-files', false, 52428800)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- Objects live at <auth.uid()>/<folder>/<uuid>.<ext>. The first folder
-- segment must equal the caller's verified JWT user id; the client never
-- decides who owns a file.
drop policy if exists "vault: select own objects" on storage.objects;
create policy "vault: select own objects" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vault: insert own objects" on storage.objects;
create policy "vault: insert own objects" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] in ('images', 'screenshots', 'pdfs', 'documents', 'other', 'thumbs', 'avatar')
    and lower(storage.extension(name)) not in ('exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'jar', 'app', 'dll', 'sh')
  );

drop policy if exists "vault: update own objects" on storage.objects;
create policy "vault: update own objects" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "vault: delete own objects" on storage.objects;
create policy "vault: delete own objects" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
