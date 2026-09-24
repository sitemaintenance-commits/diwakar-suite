# Diwakar Solar Management Suite

One website, one login, one database, one permission system for Diwakar Renewable & Infra Pvt. Ltd. It replaces the HR/PMS, Daily Review CRM, Project CRM and O&M CRM applications with native modules.

- **Architecture and roadmap:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Stack:** React 19 · Vite · TypeScript · Tailwind CSS v4 · shadcn/ui · React Router · TanStack Query · Supabase (Auth, Postgres + RLS, Storage, Edge Functions) · Netlify

## What is built

| Area | Status |
|---|---|
| Supabase Auth, invite-only, password reset, invitation acceptance | ✅ |
| Dynamic RBAC: modules × actions (view/create/edit/delete/export/approve/assign) × data scope (own/team/all), union of multiple roles | ✅ |
| Site-level access (per-user sites, or "all sites") enforced in Postgres | ✅ |
| RLS on every table + guard triggers (Super Admin protection, last-admin lock, self-escalation blocks) | ✅ |
| Standard policy generator for future modules (`app.apply_standard_policies`) incl. soft delete + ASSIGN guard | ✅ |
| Audit log (server-side login audit, record changes, role/permission/site changes, exports) | ✅ |
| Layout, permission-generated sidebar, 403 / 404 / "coming in phase N" pages, responsive UI | ✅ |
| Dashboard (permission- and site-aware KPIs, never null/NaN) | ✅ |
| Admin: Users, Roles (permission matrix), Modules, Sites, Audit Log, Settings; HR: Departments & Designations | ✅ |
| **Phase 2 — CRM & Tenders:** Leads, Tenders (government bidding), Quotations with GST, Follow-ups, document attachments | ✅ |
| **Phase 4 — O&M / Solar:** Solar Sites + equipment, Solar Monitor (CUF, PR, availability), daily Generation entry & history, Tickets with workflow, preventive Maintenance | ✅ |
| **Phase 5 — HR / PMS:** Employees, Attendance, Leave (self-service + approval), Performance reviews & goals, central Task Log | ✅ |
| **Phase 6 — Daily Review:** Daily Reports per department with metrics, Review Summary (day comparison + month), Management Review with CCM/Founder remarks and day headline | ✅ |
| **Phase 5b — PMS:** Daily Work sheet and the Performance Score engine (KPI / competency / discipline / attendance) | ✅ |
| **Phase 7 — Reports:** Tenders, Generation, O&M, HR and Daily Review reports with CSV export | ✅ |
| **Phase 4b — O&M parity:** Site Operations register (administration · patrol · security), Team Performance (80/20 technician scoring), Site Teams contact register, Solar Analytics (site trend · shutdown · portfolio year), Solar Monitor day view | ✅ |
| **Field entry:** the technician's daily form (date · site · insolation · grid outage · INV-01…12 · remarks) that replaces the O&M Google Form, with the real 13-site portfolio and its DC/AC capacities | ✅ |
| **Phase 3 — Projects:** project master, execution plan from reusable templates, approvals, materials, vendors, vendor bills with a two-step approval, client payment milestones, day-wise site updates | ✅ |

**Tenders instead of Customers.** The company sells by bidding for government tenders, so the planned Customers module was replaced by Tenders: the full bid lifecycle (identified → go/no-go → preparing → submitted → qualified → won/lost), EMD and tender-fee money tracking, portal/NIT references, deadlines, bid result with L1 comparison, and the award (LOA, work order, contract value). Quotations attach to a tender or a lead.

Two tables from the architecture were moved to the phase that first needs them: `solar_sites` (Phase 4), which depends on `projects`, and `documents` (Phase 2). Phase 1 uses the core `sites` table and a private `avatars` bucket.

## Security model in one paragraph

The browser only holds the public anon key and the user's JWT. Every table has Row Level Security. Policies call `app.has_perm(module, action)`, `app.perm_scope(...)` and `app.my_site_ids()`, which compute the union of the user's active roles. Inactive users get nothing. Writes to roles, permissions and site assignments go only through audited `SECURITY DEFINER` RPCs that check permissions first. User creation, invitations, password resets and bans run in the `admin-users` Edge Function, the only place that holds the service-role key, and even there every decision is re-checked by the database as the caller. Hiding a button in the UI is a convenience only; `npm run test:db` proves the database refuses the same actions.

## One-time setup

### 1. Supabase project
1. Create a project at supabase.com. Recommended: region **Mumbai (ap-south-1)**, **Pro** plan for production (daily backups; PITR add-on recommended).
2. Link it and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Authentication → Providers → Email:** turn **off** "Allow new users to sign up".
4. **Authentication → URL Configuration:** set Site URL to your Netlify URL. Add `https://<your-site>/reset-password` to the Redirect URLs.
5. **Authentication → SMTP:** configure a company SMTP sender. The built-in sender is heavily rate-limited and not meant for production invitations.
6. Deploy the Edge Function and restrict CORS/redirects to your domain:
   ```bash
   npx supabase functions deploy admin-users
   npx supabase secrets set ALLOWED_ORIGINS=https://<your-site>
   ```

### 2. First Super Admin
1. **Authentication → Users → Add user** (email + password) for the owner account.
2. In the **SQL Editor** run this once. It refuses to run again after a Super Admin exists:
   ```sql
   select app.bootstrap_super_admin('owner@yourcompany.com');
   ```
3. Sign in. From then on, all users are managed in **Administration → User Management**.

### 3. Netlify
1. New site from this repository. Build settings come from `netlify.toml` (`npm run build` → `dist`).
2. Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase → Settings → API). **Never** add the service-role key to Netlify.

### 4. After go-live
- The 13 real sites are seeded with their DC/AC capacity and tilt from the existing dashboards. Confirm Jerthi (the O&M CRM shows 3,496 kWp DC, the Project CRM shows 3,361) and fill in commissioning dates, DISCOM, consumer numbers and tariffs in **Solar Sites**.
- Review the default role matrix in **Role Management** and adjust it to how each team works.

## Replacing the four legacy apps

| Legacy app | Status |
|---|---|
| **O&M CRM** (diwakar-solar-crm) | All seven tabs rebuilt natively: **Dashboard** → Solar Monitor "Day view" (tiles, site ranking, the full All Sites Performance table, CSV export); **Form** → Daily Entry; **Charts** → Analytics "Site trend"; **Site Operations** → the Site Operations register (8 administration activities, 8 patrol rounds, 12 security points, shift and urgency, readiness %); **Performance** → Team Performance, where the 80 automatic marks are derived from the register, the task log and the daily form instead of being typed, and the 20 month-end marks need APPROVE; **Shutdown** → Analytics "Shutdown" (hours ÷ 11 peak sun hours); **Overall** → Analytics "Portfolio". The 21 site technicians and their numbers are seeded as the Site Teams contact register. History comes across through **Administration → Data Import**. |
| **Daily Review CRM** (daily-review-crm) | Feature parity: department reports with metrics, issues and plan, CCM/Founder remarks, day-vs-day comparison, month view, day headline. History comes across through **Administration → Data Import**. |
| **HR / PMS** (diwakar-pms) | Replaced: employees, attendance, leave, reviews with goals, task log, the **Daily Work** sheet that replaces the "Daily Employee Working Sheet" Google Form, and the **Performance Score** sheet — team score, leaderboard, task mix, monthly / last month / yearly views and the 60/20/10/10 scoring. The 80 automatic marks are derived from the sheets, the task log and attendance instead of being typed. History comes across through **Administration → Data Import**. |
| **Project CRM** (diwakar-solar-project-crm) | Replaced: the dashboard (portfolio, execution progress, capacity comparison, tasks needing attention), project sites, the day-wise site update form (TL work · GSS bay · piling · panel · module · inverter · material), the three plan templates, tasks, approvals, materials, vendors, vendor bills with the project-manager → accounts approval chain, and client payment milestones. |

## Bringing your history across

**Administration → Data Import** takes the exports of the three legacy apps that hold history:

| Source | What to give it |
|---|---|
| O&M generation | The O&M CRM's **Export JSON** (the same thing its `solar-crm-v2` browser key holds) |
| Daily Review | The Daily Review CRM's `diwakar.dailyreview.sheets.cache.v1` browser key |
| PMS working sheets | The "Daily Employee Working Sheet" responses, downloaded from Google Sheets as **CSV** |

Every importer checks your permission, refuses sites you are not assigned to, records what it did in the
audit log, and **skips anything already present** rather than overwriting it — so running an import twice is
safe and a correction made in the suite survives a re-import. Use **Check first** for a dry run.

The O&M sheet's free-text outage column ("No", `08:33 - 10:00`, labelled `Grid Failure :-` blocks, en dashes)
is parsed into hours; a window that ends before it starts is treated as a typo and contributes nothing. An
insolation of `0.00` is stored as *not recorded*, so it never produces a false performance ratio.

## Local demo (no Supabase project needed)

```bash
npm run demo:api     # terminal 1 — in-memory demo backend on :54399 (real migrations + RLS)
npm run dev:demo     # terminal 2 — app on http://localhost:5173
```

Sign in with password `demo1234` as `owner@` (Super Admin), `admin@`, `rahul@` (O&M Manager, 3 sites), `tech@` (Technician, Sadas), `sales@` or `hr@diwakarsolar.com`. The demo sends no emails and does not support photo uploads. Data resets when the backend restarts.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the project URL + anon key
npm run dev                  # http://localhost:5173
npm run test:db              # 340 database security tests (no Docker needed)
npm run build                # type-check + production build
```

`npm run test:db` runs every migration on an embedded Postgres (PGlite) with a small emulation of Supabase's `auth`/`storage` schemas (`scripts/supabase-emulation.sql`). It then signs in as personas (Super Admin, Admin, O&M Manager with 3 sites, Technician with 1 site, Sales Executive) and asserts what each can and cannot read or change — including the tender go/no-go approval, ticket closure, leave approval, review completion and daily-report review rules.

> **Note:** `package.json` contains an `overrides` entry that uses Rollup's WebAssembly build. This machine's Windows Application Control policy blocks Rollup's native binary. It is harmless elsewhere; remove it if you prefer the native build.

## Adding a module (Phases 2+)

1. **Migration:** create the tables (with `created_by`, `deleted_at`, `site_id` where relevant), then
   ```sql
   select app.apply_standard_policies('projects', 'projects.projects', 'site_id', array['created_by','project_manager_id'], array['project_manager_id']);
   update public.modules set is_enabled = true where key = 'projects.projects';
   ```
   Add any extra rules (for example APPROVE on status changes) as a trigger, and add the module's KPIs to `get_dashboard_summary()`.
2. **Frontend:** add pages under `src/features/<module>/`, a route in `src/app/router.tsx` wrapped in `guard('<module key>', …)`, and the key to `BUILT_MODULES` in `src/app/registry.ts`. Gate buttons with `useCan('<module key>')`. Phase 2 (`src/features/crm/`) is the reference implementation.
3. **Tests:** extend `scripts/test-db.mjs` with the new personas and cases.

## Project layout

```
supabase/
  migrations/            ordered SQL: enums → tables → authz functions → audit/guards → RLS → RPCs → seed → storage
  functions/admin-users  privileged account operations (service role lives only here)
scripts/test-db.mjs      database security test suite
src/
  app/                   router + module registry (built pages, icons)
  auth/                  AuthProvider, AccessProvider (useCan, <Can>), route guards
  components/            ui/ (shadcn), layout/ (shell, sidebar), common/ (page blocks)
  features/              dashboard, crm/{leads,tenders,quotations,followups}, om/{sites,monitor,generation,tickets,maintenance},
                         hr/{employees,attendance,leave,performance,tasks,org}, daily/, reports/, admin/*
  lib/                   supabase client, types, formatting, CSV export, errors
  pages/                 auth pages, profile, status pages (403/404/coming soon)
```
