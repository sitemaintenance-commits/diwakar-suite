# My Vault — Private Digital Library

A private, single-owner file vault for images, screenshots, PDFs and documents.
React + Vite + TypeScript + Tailwind on the frontend; Supabase Auth, Postgres and
Storage on the backend. Built for libraries of thousands of files.

---

## 1. Architecture

```
Browser (React SPA)
 ├─ Supabase Auth (email + password, JWT in session)
 ├─ Postgres via PostgREST  ── public.files, public.profiles  (RLS: owner only)
 └─ Supabase Storage        ── private bucket "vault-files"  (policies: owner folder only)
```

There is no custom server. Every request carries the user's JWT, and Postgres
enforces access through RLS policies and storage policies keyed on `auth.uid()`.
The frontend holds only the public anon key. The service-role key is never used.

**Why Supabase (as you suggested):** it provides real password hashing and
sessions (GoTrue), Postgres with row-level security, and a private object store
with signed URLs, all in one project. The authorization model ("a row or object
belongs to `auth.uid()`") can be expressed directly as database policies, so a
bug in the UI can't leak another user's files.

### Data flow

| Action | What happens |
| --- | --- |
| Upload | Client validates type/size → XHR `POST /storage/v1/object/vault-files/<uid>/<folder>/<uuid>.<ext>` (real progress + cancel) → a 480px WebP thumbnail is generated in the browser (images: canvas; PDFs: page 1 via pdf.js) and uploaded to `<uid>/thumbs/<uuid>.webp` → a metadata row is inserted. If the insert fails, the uploaded objects are removed. |
| Browse | Paginated `select` (24/48/96 per page, infinite scroll), with filtering, sorting and search done **server-side**. One batch `createSignedUrls` call signs all thumbnails on the page (2h expiry). |
| Preview / download | A short-lived signed URL is created on demand (1h preview, 60s download). There are no public URLs. |
| Delete | Move to trash (`deleted_at`). Permanent delete removes the storage objects first, then the row. |
| Stats | One `vault_stats()` RPC aggregates counts and bytes. The client never downloads all rows. |

## 2. Database schema

`supabase/schema.sql` (idempotent, safe to re-run) creates:

**`public.files`**: `id uuid pk`, `user_id`, `original_name`, `display_name`,
`storage_path` (unique), `thumbnail_path`, `mime_type`, `extension`, `category`
(`image|screenshot|pdf|document|other`), `size_bytes`, `width`, `height`,
`page_count`, `is_favorite`, `tags text[]`, `description`, `search_text`,
`created_at`, `updated_at`, `last_accessed_at`, `deleted_at`.

**`public.profiles`**: `full_name`, `avatar_path`, `preferences jsonb` (view, page size, theme — synced across devices), `storage_quota_bytes`.

**Indexes**: partial B-tree indexes per access pattern (active by date, by
category, favorites, recently opened, trash, size, name), a **trigram GIN index on
`search_text`** for fast substring search ("voic" matches "Invoice.pdf"), and a
GIN index on `tags`.

**Triggers**:
- `files_before_write` normalises names and tags, rebuilds `search_text`, and
  blocks changes to immutable columns (owner, path, size, type). It only allows
  moving files between Images and Screenshots.
- `files_enforce_quota` rejects inserts over the per-user quota.
- `handle_new_user` creates a profile for each new auth user.

## 3. Storage layout

```
vault-files/                (private bucket, 50 MB per-file limit)
  <user-id>/
    images/<uuid>.<ext>
    screenshots/<uuid>.<ext>
    pdfs/<uuid>.<ext>
    documents/<uuid>.<ext>
    other/<uuid>.<ext>
    thumbs/<uuid>.webp
    avatar/<uuid>.webp
```

File names are UUIDs, so identical names never overwrite each other. The
original name is kept in the database.

## 4. Authentication flow

1. `/login`: `signInWithPassword`. Supabase hashes passwords with bcrypt, and
   nothing is stored in plain text.
2. "Keep me signed in" on: the session goes in `localStorage`. Off: it goes in
   `sessionStorage` and ends when the browser closes.
3. Every protected route is under `AppLayout`, which redirects to `/login` when
   there is no session and returns you to the original page after sign-in.
4. Forgot password: an email link goes to `/reset-password`. That page only sets a
   new password for a genuine recovery-link session. Signed-in users change their
   password in Settings, which re-verifies the current password first.
5. Settings also offers "sign out everywhere" (revokes all refresh tokens).

## 5. Security model (RLS)

| Resource | Rule |
| --- | --- |
| `files` select/update/delete | `user_id = auth.uid()` |
| `files` insert | `user_id = auth.uid()`, and `storage_path` and `thumbnail_path` start with `auth.uid()/` |
| `profiles` | Read and update own row only. The only updatable columns are `full_name`, `avatar_path` (must be in own folder) and `preferences`. **Users can't raise their own quota.** |
| `storage.objects` | Bucket `vault-files` only. The first folder must equal `auth.uid()`. Uploads are only allowed into known subfolders. Executable extensions are blocked. |
| `anon` role | No table or function access at all |
| `vault_stats()` | `security invoker`, runs under the caller's RLS |

The client never supplies the user ID used for authorization. It comes from the
verified JWT (`auth.uid()`).

`npm run test:db` runs **39 security tests** against the real schema using PGlite
(Postgres compiled to WASM) with stand-ins for Supabase's `auth`/`storage`
schemas. The tests cover cross-user reads, writes and deletes, path spoofing,
quota tampering, immutable columns, blocked file types and anonymous access.

---

## 6. Supabase setup (about 10 minutes)

1. **Create a project** at <https://supabase.com/dashboard>. Choose a region near
   you and a strong database password.
2. **Run the schema**: open *SQL Editor → New query*, paste all of
   `supabase/schema.sql`, and click **Run**. This creates the tables, indexes,
   policies, triggers and the private `vault-files` bucket.
3. **Lock down sign-ups** (this is a personal vault): go to *Authentication →
   Sign In / Providers*, keep **Email** enabled, and turn **off** "Allow new users
   to sign up".
4. **Create your account**: go to *Authentication → Users → Add user → Create new
   user*, enter your email and a strong password, and tick **Auto Confirm User**.
5. **URL configuration** (*Authentication → URL Configuration*):
   - Site URL: your production URL (or `http://localhost:5173` while developing)
   - Redirect URLs: add `http://localhost:5173/**` and `https://YOUR-DOMAIN/**`
     (needed for password-reset links)
6. **Get your keys**: go to *Project Settings → API* and copy the **Project URL**
   and the **anon / publishable** key. **Never copy the `service_role` / secret
   key into this app.**
7. **Storage quota**: the default per-user quota is 1 GB (the Free plan total). On
   a paid plan, raise it:
   ```sql
   update public.profiles set storage_quota_bytes = 100::bigint * 1024 * 1024 * 1024; -- 100 GB
   ```
8. **Per-file size limit**: the bucket allows 50 MB (the Free-plan maximum). To
   raise it on a paid plan, increase the global limit (*Project Settings →
   Storage*), then *Storage → vault-files → Edit bucket*, then set
   `VITE_MAX_UPLOAD_MB` to match.
9. Recommended hardening: set a minimum password length of at least 12
   (*Authentication → Policies*), and enable leaked-password protection
   (Pro plan).

## 7. Local development

```bash
npm install
cp .env.example .env.local      # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck   # TypeScript
npm run build       # typecheck + production build into dist/
npm run preview     # serve the production build locally
npm run test:db     # database / RLS security tests (no Supabase needed)
```

## 8. Deploying the frontend

The app is a static SPA, so any static host works. Set the two `VITE_` variables
in the host's environment settings. Never commit `.env.local`.

**Vercel (recommended):** import the repo, keep the Vite preset (build `npm run
build`, output `dist`), add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
optionally `VITE_MAX_UPLOAD_MB`, then deploy. `vercel.json` provides SPA
rewrites and security headers (CSP, frame denial, nosniff).

**Netlify:** build `npm run build`, publish directory `dist`.
`public/_redirects` and `public/_headers` are included.

After deploying, add the production URL to Supabase **Site URL** and **Redirect
URLs** (step 5).

The Content-Security-Policy allows `https://*.supabase.co`. If you use a Supabase
custom domain, add it to `connect-src`, `img-src` and `media-src` in
`vercel.json` / `public/_headers`.

---

## 9. Folder structure

```
supabase/
  schema.sql              all tables, indexes, triggers, RLS and storage policies
  tests/rls.test.mjs      security tests (npm run test:db)
src/
  main.tsx, App.tsx       bootstrap and routes
  layouts/                AppLayout (protected shell), AuthLayout (login split screen)
  pages/                  Login, Forgot/Reset password, Dashboard, Library (all file views),
                          Storage, Settings, NotFound
  components/
    layout/               Sidebar, Topbar, SearchBar, ErrorBoundary, FullPageLoader
    dashboard/            DashboardCard, StorageWidget, RecentFiles
    files/                FileCard, ImageCard, FileGrid, FileList, FileThumb, FilterPanel,
                          BulkActionBar, FileActionsMenu, EditFileDialog, LoadingSkeleton
    upload/               UploadModal, UploadProgress, DropOverlay
    preview/              PreviewModal, ImageViewer, PdfViewer, Docx/Text/Media viewers,
                          FileInfoPanel, fallbacks
    ui/                   Button, Input, Modal, Menu, ConfirmDialog, EmptyState, Skeleton…
  context/                Auth, Upload queue, File actions
  hooks/                  useFiles (infinite query), useFileFilters (URL state), useProfile
  services/               files, upload, profile (all Supabase calls)
  lib/                    supabase client, categories registry, views, pdf, thumbnails,
                          preview rules, errors, query cache
  types/, utils/
```

**Adding a file category:** add it to `src/lib/categories.ts`, extend the
`category` check and path regex in `schema.sql`, and add a view in
`src/lib/views.ts`.

## 10. Performance notes

- Nothing loads "all files". Lists are paged (24/48/96) with infinite scroll and
  a "Load more" fallback. Counts come from `vault_stats()`.
- Galleries show 480px WebP thumbnails, lazy-loaded, never the originals. Off-
  screen cards skip layout via `content-visibility`.
- Search, filters and sorting run in Postgres using the indexes above.
  Previous results stay visible while a new query loads.
- pdf.js, mammoth (DOCX) and the ZIP library load only when first needed.
- Uploads run three at a time in the background, and the UI stays usable.
  Closing the tab mid-upload triggers a browser warning.

## 11. Review results and known limitations

Verified: TypeScript strict build passes, the production build passes, and
39/39 database security tests pass. Login, dashboard, galleries, lightbox, PDF
viewer, search, list view, trash with undo, bulk selection, delete confirmation,
upload pipeline, settings, dark mode and mobile drawer were all exercised in a
browser against a mock API. The production CSP was checked with the PDF worker
and lazy chunks. **It has not yet been run against a live Supabase project.**
Do a first end-to-end check after setup.

Limitations to be aware of:
- **Not end-to-end encrypted.** Files are private to your account and encrypted
  at rest by Supabase, but anyone with admin access to the Supabase project can
  read them.
- **Previews:** HEIC displays only in Safari (other browsers show an icon plus
  download). DOCX previews are a simplified rendering. DOC, RTF, ODT and
  spreadsheets have no in-browser preview; the app says so and offers
  Download / Open instead.
- **Bulk download** builds the ZIP in browser memory and is capped at 1 GB per
  download.
- The **quota check** runs per insert, so a large parallel batch can overshoot by
  a few files.
- If the browser closes after a file is uploaded but before its row is saved, an
  orphan object can remain. To find orphans:
  ```sql
  select o.name, o.created_at from storage.objects o
  where o.bucket_id = 'vault-files'
    and split_part(o.name, '/', 2) in ('images','screenshots','pdfs','documents','other')
    and not exists (select 1 from public.files f where f.storage_path = o.name);
  ```
  Delete them from *Storage* in the dashboard, not with SQL.
- Trash is not emptied automatically. Use **Empty Trash**.
