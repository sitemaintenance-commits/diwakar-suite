# My Vault: security audit (15 Oct 2026)

What this audit covered: the code in `my-vault/` on branch `claude/new-session-g7voiw`, its git history,
its dependencies and its hosting configuration. The audit was not run against your live Supabase project, your
deployed site or your real photos, and those were never touched or transferred.

## Stack (from the code, not assumed)

| Part | What it is |
|---|---|
| Frontend | React 19 + Vite + TypeScript static SPA (Vercel `vercel.json` or Netlify `public/_headers`) |
| Backend | No custom server. Supabase Auth, Postgres via PostgREST (RLS) and Supabase Storage |
| Files | Private bucket `vault-files`, objects at `<user-id>/<folder>/<uuid>.<ext>`, signed URLs only |
| Sign-in | Email + password (`signInWithPassword`), password reset by email link |

> **Important:** the brief describes an existing SMS / OTP / MFA login. **There is none in this code.**
> Sign-in is email + password only. Nothing about sign-in was changed. Adding MFA is proposal P1 below and
> needs your approval.

## Verified results

| Check | Result |
|---|---|
| Production build (`npm run build`) | Pass |
| Database / storage security tests (`npm run test:db`, 68 tests) | 68 passed, 0 failed. They cover cross-user reads, writes, overwrites and deletes, path spoofing, anonymous access, quota tampering, immutable columns and blocked file types |
| Secrets in the vault's git history | None found (only the public anon-key placeholder in `.env.example`) |
| `.env` files committed | None |
| Source maps in the production build | None emitted |
| Dependency audit (`npm audit --omit=dev`) | 3 moderate findings, all `sprintf-js` via `argparse` via `mammoth`. `argparse` is only used by mammoth's command-line tool and is not in the browser bundle, so they cannot be reached from the site |
| New headers served with the production build | Checked in Chromium: login page renders, no CSP violations |

### What is already done well (confirmed in the code)

- **Every photo is protected on the server.** RLS on `files` and Storage policies key everything on
  `auth.uid()` from the verified JWT. Changing an ID, path or URL can't reach another account's files (tested).
- **No public URLs.** The bucket is forced private on every schema run. Links are signed: 60 s for downloads,
  5 min for "open in tab", 1 h for previews and video, 2 h for thumbnails.
- **Uploads can't be redirected.** The client can't choose the owner. Object names are server-side UUIDs.
  Uploads and renames only land in known folders, executables are blocked by both the table and storage, and
  `x-upsert: false` stops overwrites.
- **The anonymous role has no access** to any table or function.
- **XSS:** DOCX previews are sanitised with DOMPurify, text files are rendered as text, and no inline scripts
  are allowed by the CSP.
- **Search is not injectable.** Values go through supabase-js filters with `%`/`_` escaped.
- **Password change re-checks the current password.** Password reset only works from a genuine recovery link.
  "Sign out everywhere" revokes all refresh tokens. Sign-out clears the in-memory cache.

## Changes made (headers only, no UI, auth, schema or data change)

`public/_headers` (Netlify) and `vercel.json` (Vercel), kept identical:

| Header | Before | After | Why |
|---|---|---|---|
| `Strict-Transport-Security` | none | `max-age=31536000` | Browsers refuse plain HTTP to the vault for a year. `includeSubDomains`/`preload` were deliberately left out so other subdomains are unaffected |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer` | The vault's URLs (search terms, open file) are never sent to another site. Nothing in the app relies on a Referer |
| `Cross-Origin-Opener-Policy` | none | `same-origin` | A page opened from the vault, or one that opens it, can't script the vault window |
| `X-Robots-Tag` | none | `noindex, nofollow, noarchive` | Search engines and archives never index the site, not even the login page (backs up the existing meta tag) |

**Rollback:** revert the commit, or delete those four lines from both files and redeploy. No data is involved.

## Findings that need your decision (not changed)

| # | Severity | Finding | Proposed fix | Impact |
|---|---|---|---|---|
| P1 | **High** | **No MFA.** A leaked or guessed password gives full access to every photo | Supabase TOTP MFA (authenticator app, free), plus restrictive RLS so files and storage need `aal2` | Adds an enrolment screen and a code step at sign-in. **Changes the login flow, so it needs your approval** |
| P2 | Medium | **Email change doesn't ask for the password.** Someone using an unlocked, signed-in device could start an email change (Settings) and then reset the password | Keep **Authentication → Providers → Email → Secure email change** ON (confirm on both addresses, the default). Optionally ask for the current password on email change, as password change already does | Dashboard check: none. Code option: one extra field in Settings |
| P3 | Medium | **Sessions never time out.** With "Keep me signed in", a session lasts until sign-out | Supabase **Auth → Sessions**: set *Inactivity timeout* (for example 7 days) and/or *Time-box* (Pro plan), no code change. Or an in-app idle sign-out | None for the dashboard setting |
| P4 | Medium | **Password rules are dashboard settings** | Minimum length ≥ 12, leaked-password protection (Pro), and confirm **sign-ups are OFF** (README step 3) | None |
| P5 | Low | **Quota trusts the client's `size_bytes`.** Only the owner can abuse it (uploads with a false size), and the bucket's per-file limit still applies | A trigger that reads the real object size from `storage.objects` | Schema change, so it needs approval |
| P6 | Low | **Uploaded objects get `Cache-Control: max-age=3600`.** Viewed photos stay in the browser's disk cache for up to an hour after sign-out on a shared computer | Upload with `private, max-age=3600` (or `no-store`). Must be tested against your project first, because Storage's handling of the header and its CDN behaviour are unverified here. Applies to new uploads only | Possibly slower re-loads with `no-store` |
| P7 | Low | **The CSP allows any `*.supabase.co`**, not just your project | Pin `img-src`, `media-src` and `connect-src` to `https://<your-ref>.supabase.co` | Must match your project URL, or the site breaks |
| P8 | Low | **Google Fonts are loaded from Google** on every visit (your IP and visit time go to Google) | Self-host Inter (same font, no visual change), then drop Google from the CSP | One small font package |
| P9 | Low | **"Open in new tab" shows the file on the Supabase domain.** An uploaded HTML/SVG file renders there. It can't read your session, which lives on the vault's domain | Restrict the bucket's `allowed_mime_types`, or offer Download only for HTML/SVG | Could block a file type you use today, so a list is needed first |
| P10 | Info | **Unfinished resumable uploads keep file names in `localStorage`** for up to 23 h | Clear them on sign-out | Loses "resume after re-sign-in" |
| P11 | Info | **Content isn't end-to-end encrypted.** Anyone with admin access to the Supabase project can read files | Protect the Supabase account itself: MFA on the Supabase login, few org members, never share the service-role key | None |

## Manual checks on your live setup (couldn't be done from here)

1. Supabase → Storage → `vault-files` shows **Private**.
2. Authentication → *Allow new users to sign up* is **off**.
3. Your Supabase **dashboard account** has MFA enabled.
4. Open a signed download link after 60 seconds: it must fail.
5. Sign in on a second test account (if any) and confirm none of your files appear.
6. Check the response headers on the deployed site (browser dev tools → Network → the page → Headers) include
   the four new ones above.
7. Backups (Database → Backups, paid plans) and who can see them.
