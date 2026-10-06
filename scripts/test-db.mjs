// Database security test suite.
//
// Runs every migration in supabase/migrations against an embedded Postgres
// (PGlite) with a minimal emulation of Supabase's auth/storage schemas and
// roles, then exercises RBAC, site access, scope and audit rules as real
// personas (SET ROLE authenticated + JWT claims), exactly as PostgREST does.
//
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');

const db = await PGlite.create({ extensions: { citext, pg_trgm } });

// ---------------------------------------------------------------- Supabase emulation
const emulation = readFileSync(join(root, 'scripts', 'supabase-emulation.sql'), 'utf8');
await db.exec(emulation);

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    console.log(`  migrated  ${file}`);
  } catch (e) {
    console.error(`\nMIGRATION FAILED: ${file}\n${e.message}`);
    // Locate the failing statement: replay the file chunk by chunk on a fresh db.
    const probe = await PGlite.create({ extensions: { citext, pg_trgm } });
    await probe.exec(emulation);
    for (const prev of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f < file).sort()) {
      await probe.exec(readFileSync(join(migrationsDir, prev), 'utf8'));
    }
    for (const chunk of readFileSync(join(migrationsDir, file), 'utf8').split(/;\s*\n\s*\n/)) {
      try { await probe.exec(chunk + ';'); } catch (err) {
        console.error(`--- failing chunk ---\n${chunk.trim().slice(0, 1500)}\n${err.message}`);
        break;
      }
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------- helpers
let passed = 0;
let failed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };
const bad = (name, detail) => { failed++; console.log(`  ✗ ${name}\n      ${detail}`); };

/** Run SQL as a signed-in user (like PostgREST with a JWT). */
async function as(uid, sql, params = []) {
  return db.transaction(async (tx) => {
    if (uid) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await tx.exec('set local role authenticated');
    } else {
      await tx.query(`select set_config('request.jwt.claims', '', true)`);
      await tx.exec('set local role anon');
    }
    return tx.query(sql, params);
  });
}
const asSystem = (sql, params = []) => db.query(sql, params);

async function expectRows(name, uid, sql, n, params) {
  try {
    const r = await as(uid, sql, params);
    r.rows.length === n ? ok(name) : bad(name, `expected ${n} rows, got ${r.rows.length}`);
    return r.rows;
  } catch (e) { bad(name, `unexpected error: ${e.message}`); return []; }
}
async function expectValue(name, uid, sql, expected, params) {
  try {
    const r = await as(uid, sql, params);
    const v = Object.values(r.rows[0] ?? {})[0];
    JSON.stringify(v) === JSON.stringify(expected) ? ok(name) : bad(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(v)}`);
    return v;
  } catch (e) { bad(name, `unexpected error: ${e.message}`); }
}
async function expectError(name, uid, sql, pattern, params) {
  try {
    await as(uid, sql, params);
    bad(name, 'expected an error, but the statement succeeded');
  } catch (e) {
    !pattern || new RegExp(pattern, 'i').test(e.message) ? ok(name) : bad(name, `wrong error: ${e.message}`);
  }
}
async function expectOk(name, uid, sql, params) {
  try { await as(uid, sql, params); ok(name); } catch (e) { bad(name, e.message); }
}
async function createAuthUser(email, fullName) {
  const r = await asSystem(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: fullName })]);
  return r.rows[0].id;
}
const signIn = (uid) => asSystem(`update auth.users set last_sign_in_at = now() where id = $1`, [uid]);
const id = async (sql, params) => (await asSystem(sql, params)).rows[0].id;

// ---------------------------------------------------------------- fixtures
console.log('\nSeed data');
const modules = (await asSystem('select count(*)::int n from public.modules')).rows[0].n;
const roles = (await asSystem('select count(*)::int n from public.roles')).rows[0].n;
console.log(`  ${modules} modules, ${roles} roles seeded`);

const OWNER = await createAuthUser('owner@diwakarsolar.test', 'Owner');
const ADMIN = await createAuthUser('admin@diwakarsolar.test', 'Admin User');
const RAHUL = await createAuthUser('rahul@diwakarsolar.test', 'Rahul');
const TECH  = await createAuthUser('tech@diwakarsolar.test', 'Technician One');
const SALES = await createAuthUser('sales@diwakarsolar.test', 'Sales Exec');

const site = {};
for (const n of ['Sadas', 'Thikariya', 'Bassi', 'Suaap', 'Indo Ka Bas']) site[n] = await id(`select id from public.sites where name = $1`, [n]);
const role = {};
for (const r of (await asSystem('select id, key from public.roles')).rows) role[r.key] = r.id;
const dept = await id(`select id from public.departments where code = 'OM'`);

// ---------------------------------------------------------------- tests
console.log('\nAuthentication & bootstrap');
{
  const r = await asSystem(`select status::text s from public.profiles where id = $1`, [OWNER]);
  r.rows[0].s === 'invited' ? ok('handle_new_auth_user created invited profile') : bad('profile status', r.rows[0].s);
}
await expectError('bootstrap not callable by app users', OWNER, `select app.bootstrap_super_admin('owner@diwakarsolar.test')`, 'permission denied');
await asSystem(`select app.bootstrap_super_admin('owner@diwakarsolar.test')`);
await signIn(OWNER);
try { await asSystem(`select app.bootstrap_super_admin('admin@diwakarsolar.test')`); bad('second bootstrap refused', 'succeeded'); }
catch { ok('bootstrap refuses when a Super Admin exists'); }
await expectValue('super admin is recognised', OWNER, `select app.is_super_admin()`, true);
await expectValue('super admin has every permission', OWNER, `select public.has_permission('admin.roles','delete')`, true);
await expectValue('super admin sees the whole portfolio', OWNER, `select cardinality(app.my_site_ids()) >= 13`, true);
await expectValue('anonymous has no user', null, `select auth.uid()`, null);
await expectError('anonymous cannot read sites', null, `select * from public.sites`, 'permission denied');
await expectError('anonymous cannot call get_my_access', null, `select public.get_my_access()`, 'permission denied');
{
  const r = await as(OWNER, `select public.get_my_access() a`);
  const a = r.rows[0].a;
  a.is_super_admin && Object.keys(a.permissions).length === modules && a.site_ids.length >= 13
    ? ok('get_my_access returns full access for super admin') : bad('get_my_access', JSON.stringify(a).slice(0, 300));
}
{
  const r = await asSystem(`select count(*)::int n from public.audit_logs where action = 'login' and actor_id = $1`, [OWNER]);
  r.rows[0].n === 1 ? ok('sign-in is audited server-side') : bad('login audit', r.rows[0].n);
}

console.log('\nUser management (as Super Admin)');
await expectOk('create Admin user', OWNER, `select public.admin_save_user($1, $2, true)`,
  [ADMIN, JSON.stringify({ full_name: 'Admin User', role_ids: [role.admin], all_sites: true })]);
await expectOk('create Rahul (O&M Manager, 3 sites, department, employee id)', OWNER, `select public.admin_save_user($1, $2, true)`,
  [RAHUL, JSON.stringify({ full_name: 'Rahul', employee_code: 'DS-OM-01', department_id: dept,
    role_ids: [role.om_manager], site_ids: [site.Sadas, site.Thikariya, site.Bassi] })]);
await expectOk('create Technician (Sadas only)', OWNER, `select public.admin_save_user($1, $2, true)`,
  [TECH, JSON.stringify({ full_name: 'Technician One', role_ids: [role.technician], site_ids: [site.Sadas] })]);
await expectOk('create Sales Executive (no sites)', OWNER, `select public.admin_save_user($1, $2, true)`,
  [SALES, JSON.stringify({ full_name: 'Sales Exec', role_ids: [role.sales_executive] })]);
{
  const r = await asSystem(`select e.employee_code from public.profiles p join public.employees e on e.id = p.employee_id where p.id = $1`, [RAHUL]);
  r.rows[0]?.employee_code === 'DS-OM-01' ? ok('employee record created and linked') : bad('employee link', JSON.stringify(r.rows));
}
await expectValue('invited user has no permissions before first login', RAHUL, `select public.has_permission('dashboard','view')`, false);
await expectValue('invited user sees no sites', RAHUL, `select cardinality(app.my_site_ids())`, 0);
for (const u of [ADMIN, RAHUL, TECH, SALES]) await signIn(u);
await expectValue('first login activates the account', RAHUL, `select status::text from public.profiles where id = auth.uid()`, 'active');

console.log('\nSite-level access');
await expectRows('Rahul sees exactly his 3 sites', RAHUL, `select name from public.sites`, 3);
await expectRows('Rahul cannot see Phalodi', RAHUL, `select 1 from public.sites where name = 'Phalodi'`, 0);
await expectRows('Technician sees only Sadas', TECH, `select 1 from public.sites`, 1);
await expectRows('Sales Exec sees no sites', SALES, `select 1 from public.sites`, 0);
await expectValue('Admin with all_sites sees the whole portfolio', ADMIN, `select count(*)::int >= 13 from public.sites`, true);
await expectValue('dashboard site total respects site access (Rahul)', RAHUL, `select (public.get_dashboard_summary()->'sites'->>'total')::int`, 3);
await expectValue('dashboard hides user KPIs without admin.users', RAHUL, `select public.get_dashboard_summary() ? 'users'`, false);
await expectValue('dashboard shows user KPIs to Admin', ADMIN, `select (public.get_dashboard_summary()->'users'->>'active')::int`, 5);
await expectOk('new site added by Admin', ADMIN, `insert into public.sites (name, capacity_kwp) values ('Test Site', 1500)`);
await expectValue('site added later is visible to all_sites users', ADMIN, `select exists (select 1 from public.sites where name = 'Test Site')`, true);
await expectRows('...but not to Rahul', RAHUL, `select 1 from public.sites`, 3);
await expectRows('Rahul cannot update a site (no admin.sites)', RAHUL, `update public.sites set capacity_kwp = 1 returning id`, 0);
await expectOk('site-page assignment adds Rahul to Test Site', ADMIN,
  `select public.set_site_users((select id from public.sites where name = 'Test Site'), array[$1::uuid])`, [RAHUL]);
await expectRows('Rahul now sees his 3 sites plus the new one', RAHUL, `select 1 from public.sites`, 4);

console.log('\nProfiles & privacy');
await expectRows('Rahul can only read his own profile', RAHUL, `select id from public.profiles`, 1);
await expectRows('Admin reads all profiles', ADMIN, `select id from public.profiles`, 5);
await expectOk('Rahul can change his own phone', RAHUL, `update public.profiles set phone = '9999999999' where id = auth.uid()`);
await expectError('Rahul cannot change his own status', RAHUL, `update public.profiles set status = 'inactive' where id = auth.uid()`, 'own account status');
await expectError('Rahul cannot grant himself all sites', RAHUL, `update public.profiles set all_sites = true where id = auth.uid()`, 'only change');
await expectRows('Rahul cannot update another profile (RLS filters it)', RAHUL, `update public.profiles set full_name = 'x' where id <> auth.uid() returning id`, 0);
await expectRows('Rahul cannot read employees other than himself', RAHUL, `select 1 from public.employees`, 1);
await expectRows('people directory works for pickers', RAHUL, `select * from public.list_people()`, 5);
await expectRows('Rahul cannot read audit log', RAHUL, `select 1 from public.audit_logs`, 0);

console.log('\nRoles & permissions');
await expectError('Rahul cannot write role_permissions directly', RAHUL,
  `insert into public.role_permissions (role_id, module_id, action) values ($1, (select id from public.modules where key='admin.users'), 'view')`,
  'permission denied', [role.om_manager]);
await expectError('Rahul cannot assign roles to himself', RAHUL, `select public.set_user_roles(auth.uid(), array[$1::uuid])`, 'access denied', [role.admin]);
await expectError('Rahul cannot assign himself sites', RAHUL, `select public.set_user_sites(auth.uid(), array[$1::uuid])`, 'access denied', [site['Indo Ka Bas']]);
await expectRows('Rahul reads only his own roles', RAHUL, `select 1 from public.roles`, 1);
await expectError('Admin cannot grant Super Admin', ADMIN, `select public.set_user_roles($1, array[$2::uuid])`, 'only a super admin', [RAHUL, role.super_admin]);
await expectError('Admin cannot modify the Super Admin user', ADMIN, `select public.admin_save_user($1, '{"full_name":"x"}')`, 'only a super admin', [OWNER]);
await expectError('Admin cannot deactivate the Super Admin', ADMIN, `select public.admin_set_user_status($1, 'inactive')`, 'only a super admin', [OWNER]);
await expectError('Super Admin role cannot be deleted', ADMIN, `delete from public.roles where is_system`, 'cannot be deleted');
await expectError('Super Admin role cannot be renamed', OWNER, `update public.roles set key = 'x' where is_system`, 'cannot be renamed');
await expectError('Super Admin permissions cannot be changed', OWNER, `select public.set_role_permissions($1, '[]')`, 'fixed', [role.super_admin]);
await expectError('last Super Admin cannot deactivate self', OWNER, `update public.profiles set status = 'inactive' where id = auth.uid()`, 'own account status');
await expectError('cannot remove Super Admin role from the last Super Admin', OWNER, `select public.set_user_roles(auth.uid(), '{}')`, 'last active super admin');
await expectError('assigned role cannot be deleted', ADMIN, `delete from public.roles where key = 'om_manager'`, 'assigned to');
await expectOk('Admin creates a custom role', ADMIN, `insert into public.roles (key, name) values ('site_supervisor', 'Site Supervisor')`);
const SUP = await id(`select id from public.roles where key = 'site_supervisor'`);
await expectOk('Admin saves its permission matrix', ADMIN, `select public.set_role_permissions($1, $2)`,
  [SUP, JSON.stringify([{ module: 'dashboard', action: 'view' }, { module: 'admin.sites', action: 'view' }])]);
await expectError('Admin cannot grant a permission he lacks (private HR data)', ADMIN, `select public.set_role_permissions($1, $2)`,
  'do not have', [SUP, JSON.stringify([{ module: 'hr.employees_private', action: 'view' }])]);
await expectOk('unsupported actions are silently ignored', ADMIN, `select public.set_role_permissions($1, $2)`,
  [SUP, JSON.stringify([{ module: 'dashboard', action: 'view' }, { module: 'dashboard', action: 'delete' }, { module: 'admin.sites', action: 'view' }])]);
await expectValue('matrix stored only valid grants', ADMIN, `select count(*)::int from public.role_permissions where role_id = $1`, 2, [SUP]);
await expectError('system role cannot be created', ADMIN, `insert into public.roles (key, name, is_system) values ('x2', 'X2', true)`, 'system roles');

console.log('\nMultiple roles = union of permissions');
await expectValue('Rahul lacks admin.sites view', RAHUL, `select public.has_permission('admin.sites','view')`, false);
await expectOk('Admin gives Rahul a second role', ADMIN, `select public.set_user_roles($1, array[$2::uuid, $3::uuid])`, [RAHUL, role.om_manager, SUP]);
await expectValue('Rahul now has admin.sites view', RAHUL, `select public.has_permission('admin.sites','view')`, true);
await expectValue('...and therefore sees every site', RAHUL, `select count(*)::int >= 13 from public.sites`, true);
await expectOk('Admin removes the extra role', ADMIN, `select public.set_user_roles($1, array[$2::uuid])`, [RAHUL, role.om_manager]);
await expectRows('Rahul back to his own sites', RAHUL, `select 1 from public.sites`, 4);
await expectOk('custom role can now be deleted', ADMIN, `delete from public.roles where key = 'site_supervisor'`);

console.log('\nModule enable/disable');
await expectError('Administration cannot be disabled', ADMIN, `update public.modules set is_enabled = false where key = 'admin.users'`, 'cannot be disabled');
await expectError('module structure is locked', ADMIN, `update public.modules set supported_actions = '{view}' where key = 'hr.org'`, 'managed by migrations');
await expectOk('Departments module can be disabled', ADMIN, `update public.modules set is_enabled = false where key = 'hr.org'`);
await expectValue('disabled module removes permission', ADMIN, `select public.has_permission('hr.org','view')`, false);
await expectOk('...and re-enabled', ADMIN, `update public.modules set is_enabled = true where key = 'hr.org'`);

console.log('\nStandard policy generator (future business modules)');
await db.exec(`
  create table public.test_tickets (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    site_id uuid not null references public.sites(id),
    assigned_to uuid references public.profiles(id),
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz);
  select app.apply_standard_policies('test_tickets', 'om.tickets', 'site_id', array['created_by','assigned_to'], array['assigned_to']);
  update public.modules set is_enabled = true where key = 'om.tickets';`);
await expectOk('Technician creates ticket at his site', TECH, `insert into public.test_tickets (title, site_id) values ('Inverter trip', $1)`, [site.Sadas]);
await expectError('Technician cannot create ticket at another site', TECH, `insert into public.test_tickets (title, site_id) values ('x', $1)`, 'row-level security', [site['Indo Ka Bas']]);
await expectOk('Rahul creates a ticket at Bassi', RAHUL, `insert into public.test_tickets (title, site_id) values ('SCB fault', $1)`, [site.Bassi]);
await expectOk('Rahul creates an unassigned ticket at Sadas', RAHUL, `insert into public.test_tickets (title, site_id) values ('Module cleaning', $1)`, [site.Sadas]);
await expectRows('Technician (own scope) sees only his ticket', TECH, `select 1 from public.test_tickets`, 1);
await expectRows('Rahul (all scope) sees all tickets on his sites', RAHUL, `select 1 from public.test_tickets`, 3);
await expectRows('Sales Exec (no permission) sees none', SALES, `select 1 from public.test_tickets`, 0);
await expectOk('Rahul (ASSIGN) assigns Sadas ticket to Technician', RAHUL, `update public.test_tickets set assigned_to = $1 where title = 'Module cleaning'`, [TECH]);
await expectRows('Technician now sees the assigned ticket too', TECH, `select 1 from public.test_tickets`, 2);
await expectError('Technician cannot reassign (no ASSIGN)', TECH, `update public.test_tickets set assigned_to = $1 where title = 'Module cleaning'`, 'permission to assign', [RAHUL]);
await expectError('Technician cannot move ticket to a foreign site', TECH, `update public.test_tickets set site_id = $1 where title = 'Inverter trip'`, 'row-level security', [site['Indo Ka Bas']]);
await expectError('Technician cannot soft-delete (no DELETE)', TECH, `select public.soft_delete_record('test_tickets', (select id from public.test_tickets where title = 'Inverter trip'))`, 'permission to delete');
await expectError('hard delete is blocked for everyone', RAHUL, `delete from public.test_tickets`, 'permission denied');
await expectOk('Rahul soft-deletes a ticket', RAHUL, `select public.soft_delete_record('test_tickets', (select id from public.test_tickets where title = 'SCB fault'))`);
await expectRows('soft-deleted ticket is no longer returned', RAHUL, `select 1 from public.test_tickets`, 2);
{
  const r = await asSystem(`select action, count(*)::int n from public.audit_logs where entity_table = 'test_tickets' group by action order by action`);
  const m = Object.fromEntries(r.rows.map((x) => [x.action, x.n]));
  m.create === 3 && m.update >= 1 && m.delete === 1 ? ok('record create/update/delete audited') : bad('record audit', JSON.stringify(m));
}

console.log('\nCRM — leads, tenders, quotations, follow-ups (Phase 2)');
await expectValue('Tenders replaced Customers in the catalogue', ADMIN,
  `select count(*)::int from public.modules where key in ('crm.tenders','crm.customers')`, 1);
await expectOk('Sales Exec creates a lead', SALES,
  `insert into public.leads (contact_person, company, lead_value, assigned_to) values ('Mahesh', 'Green Farms', 250000, auth.uid())`);
await expectError('Technician cannot create leads', TECH,
  `insert into public.leads (contact_person) values ('X')`, 'row-level security');

// Tenders: one owned by Sales, one company-wide, one tied to a site
await expectOk('Sales Exec creates a tender', SALES,
  `insert into public.tenders (title, authority, reference_no, estimated_value, emd_amount, submission_due_at, assigned_to)
   values ('5 MW ground mount — JJM', 'Jal Jeevan Mission', 'NIT/2026/114', 41000000, 820000, now() + interval '6 days', auth.uid())`);
await expectOk('Admin creates a tender for a site', ADMIN,
  `insert into public.tenders (title, authority, estimated_value, site_id, status, emd_amount, emd_status)
   values ('O&M — Phalodi plant', 'DISCOM', 5200000, $1, 'submitted', 150000, 'submitted')`, [site['Indo Ka Bas']]);
await expectRows('Sales Exec (own scope) sees only their tender', SALES, `select 1 from public.tenders`, 1);
await expectRows('Admin sees all tenders', ADMIN, `select 1 from public.tenders`, 2);
await expectRows('Technician has no tender access', TECH, `select 1 from public.tenders`, 0);
await expectRows('site-linked tender hidden from users without that site', RAHUL, `select 1 from public.tenders where site_id is not null`, 0);
await expectRows('...but tenders without a site stay visible', RAHUL, `select 1 from public.tenders`, 1);
await expectError('Sales Exec cannot take the go / no-go decision', SALES,
  `update public.tenders set bid_decision = 'go' where assigned_to = auth.uid()`, 'APPROVE permission');
await expectOk('Admin records the go decision', ADMIN, `update public.tenders set bid_decision = 'go' where reference_no = 'NIT/2026/114'`);
await expectValue('approver is stamped server-side', ADMIN,
  `select bid_approved_by = $1 from public.tenders where reference_no = 'NIT/2026/114'`, true, [ADMIN]);
await expectOk('submitting a bid stamps the submission time', ADMIN,
  `update public.tenders set status = 'submitted' where reference_no = 'NIT/2026/114'`);
await expectValue('submitted_at recorded', ADMIN, `select submitted_at is not null from public.tenders where reference_no = 'NIT/2026/114'`, true);
await expectError('Sales Exec cannot reassign a tender (no ASSIGN)', SALES,
  `update public.tenders set assigned_to = $1 where assigned_to = auth.uid()`, 'permission to assign', [ADMIN]);

// Quotations
await expectOk('Sales Exec saves a quotation with line items', SALES,
  `select public.save_quotation(
     jsonb_build_object('client_name', 'Jal Jeevan Mission', 'subject', '5 MW supply'),
     '[{"description":"Modules 550Wp","quantity":9000,"rate":13.5,"tax_rate":12},
       {"description":"Inverters","quantity":20,"rate":185000,"tax_rate":18}]'::jsonb)`);
await expectValue('totals are computed in the database', SALES,
  `select grand_total::int from public.quotations limit 1`, 4502080);   // 9000x13.5 +12% and 20x185000 +18%
await expectError('Sales Exec cannot approve their own quotation', SALES,
  `update public.quotations set status = 'approved'`, 'APPROVE permission');
await expectOk('Admin approves the quotation', ADMIN, `update public.quotations set status = 'approved'`);
await expectValue('approval is stamped server-side', ADMIN, `select approved_by = $1 from public.quotations limit 1`, true, [ADMIN]);
await expectRows('quotation lines follow the quotation permission', TECH, `select 1 from public.quotation_items`, 0);
await expectRows('Sales Exec sees their own quotation lines', SALES, `select 1 from public.quotation_items`, 2);

// Follow-ups
await expectOk('Sales Exec schedules a follow-up', SALES,
  `insert into public.follow_ups (entity_type, tender_id, subject, follow_up_at, assigned_to)
   select 'tender', id, 'Pre-bid meeting', now() + interval '2 days', auth.uid() from public.tenders limit 1`);
await expectOk('follow-up can be completed', SALES,
  `select public.log_followup_done((select id from public.follow_ups limit 1), 'Attended, clarifications noted', null)`);
await expectRows('Technician cannot see follow-ups', TECH, `select 1 from public.follow_ups`, 0);

// Documents
await expectOk('Sales Exec attaches a tender document', SALES,
  `insert into public.documents (module_key, entity_type, entity_id, category, file_name, storage_path)
   select 'crm.tenders', 'tender', id, 'NIT', 'nit.pdf', 'crm.tenders/' || id || '/nit.pdf' from public.tenders limit 1`);
await expectRows('documents follow their module permission', TECH, `select 1 from public.documents`, 0);
await expectRows('Admin sees the document', ADMIN, `select 1 from public.documents`, 1);

// Dashboard
{
  const r = await as(ADMIN, `select public.get_dashboard_summary() s`);
  const t = r.rows[0].s.tenders;
  t && t.total === 2 && t.submitted === 2 && Number(t.emd_blocked) === 150000
    ? ok('dashboard reports tender pipeline and EMD blocked')
    : bad('dashboard tenders', JSON.stringify(t));
}
await expectValue('dashboard hides CRM from users without permission', TECH, `select public.get_dashboard_summary() ? 'tenders'`, false);
await expectValue('Sales Exec dashboard counts only their own tenders', SALES,
  `select (public.get_dashboard_summary()->'tenders'->>'total')::int`, 1);

console.log('\nO&M / Solar (Phase 4)');
{
  // Shipped default: a technician logs in and sees the jobs they do —
  // the daily form, the site register, their tickets and their own score.
  const r = await as(TECH, `select public.get_my_access() a`);
  const keys = Object.keys(r.rows[0].a.permissions).sort();
  const expected = ['approvals', 'dashboard', 'documents', 'om.daily_entry', 'om.operations', 'om.performance', 'om.tickets'];
  JSON.stringify(keys) === JSON.stringify(expected)
    ? ok('by default a technician sees the plant forms they file, their tickets and the documents page (no daily task sheet)')
    : bad('default technician scope', keys.join(', '));
}
// Roles are data: the Super Admin widens the Technician role for this site
// team, and everything below runs against the widened role.
await expectOk('Super Admin widens the Technician role', OWNER, `select public.set_role_permissions($1, $2)`, [
  role.technician,
  JSON.stringify([
    { module: 'dashboard', action: 'view' },
    { module: 'om.daily_entry', action: 'view' }, { module: 'om.daily_entry', action: 'create' }, { module: 'om.daily_entry', action: 'edit' },
    { module: 'om.sites', action: 'view' },
    { module: 'om.equipment', action: 'view' },
    { module: 'om.generation', action: 'view' }, { module: 'om.generation', action: 'create' }, { module: 'om.generation', action: 'edit' },
    { module: 'om.tickets', action: 'view', scope: 'own' }, { module: 'om.tickets', action: 'create', scope: 'own' }, { module: 'om.tickets', action: 'edit', scope: 'own' },
    { module: 'om.maintenance', action: 'view', scope: 'own' }, { module: 'om.maintenance', action: 'edit', scope: 'own' },
    { module: 'tasks', action: 'view', scope: 'own' }, { module: 'tasks', action: 'create', scope: 'own' }, { module: 'tasks', action: 'edit', scope: 'own' },
    { module: 'daily.reports', action: 'view', scope: 'own' }, { module: 'daily.reports', action: 'create', scope: 'own' }, { module: 'daily.reports', action: 'edit', scope: 'own' },
  ]),
]);
await expectOk('Admin completes the plant details for a site', ADMIN,
  `update public.solar_sites set commissioning_date = '2024-03-15', expected_yield = 4.6, tariff_per_kwh = 3.14
   where site_id = $1`, [site.Sadas]);
await expectOk('Rahul adds an inverter to Sadas', RAHUL,
  `insert into public.equipment (site_id, type, name, make, capacity_kw) values ($1, 'inverter', 'INV-01', 'Sungrow', 250)`, [site.Sadas]);
await expectError('Technician cannot add equipment (view only)', TECH,
  `insert into public.equipment (site_id, type, name) values ($1, 'inverter', 'INV-02')`, 'row-level security', [site.Sadas]);
await expectError('Rahul cannot touch a site he is not assigned', RAHUL,
  `insert into public.equipment (site_id, type, name) values ($1, 'inverter', 'X')`, 'row-level security', [site['Indo Ka Bas']]);

await expectOk('Technician records generation for his site', TECH,
  `select public.save_generation(jsonb_build_array(jsonb_build_object(
     'site_id', $1::text, 'gen_date', (current_date - 1)::text, 'generation_kwh', 22000,
     'expected_kwh', 22770, 'grid_outage_hrs', 0.5, 'plant_outage_hrs', 0)))`, [site.Sadas]);
await expectOk('Rahul records generation for Bassi', RAHUL,
  `select public.save_generation(jsonb_build_array(jsonb_build_object(
     'site_id', $1::text, 'gen_date', (current_date - 1)::text, 'generation_kwh', 14000)))`, [site.Bassi]);
await expectError('Technician cannot record generation for another site', TECH,
  `select public.save_generation(jsonb_build_array(jsonb_build_object(
     'site_id', $1::text, 'gen_date', (current_date - 1)::text, 'generation_kwh', 100)))`, 'row-level security', [site.Bassi]);
await expectRows('Technician sees only his own site generation', TECH, `select 1 from public.generation_records`, 1);
await expectRows('Rahul sees generation for his 3 sites', RAHUL, `select 1 from public.generation_records`, 2);
await expectValue('one row per site per day (upsert, not duplicate)', RAHUL,
  `select public.save_generation(jsonb_build_array(jsonb_build_object(
     'site_id', $1::text, 'gen_date', (current_date - 1)::text, 'generation_kwh', 14500)))`, 1, [site.Bassi]);
await expectValue('the updated figure is stored', RAHUL,
  `select generation_kwh::int from public.generation_records where site_id = $1`, 14500, [site.Bassi]);

{
  const r = await as(RAHUL, `select public.get_generation_summary((current_date - 1)::date, (current_date - 1)::date) s`);
  const g = r.rows[0].s;
  // Sadas 4950 kWp + Bassi/Thikariya (capacity from sites) over one day.
  const expectedCuf = Math.round((36500 / (Number(g.capacity_kwp) * 24)) * 10000) / 100;
  Number(g.yesterday) === 36500 && g.pr === null && Number(g.plant_availability) === 100
    && Math.abs(Number(g.cuf) - expectedCuf) < 0.02
    ? ok('monitor sums generation, computes CUF per site (not per reading), and reports PR as "no data" without irradiation')
    : bad('generation summary', JSON.stringify(g).slice(0, 260) + ` expectedCuf=${expectedCuf}`);
}
await expectValue('monitor is limited to the caller sites', TECH,
  `select (public.get_generation_summary((current_date - 1)::date, (current_date - 1)::date)->>'yesterday')::numeric::int`, 22000);

await expectOk('Technician raises a ticket on his site', TECH,
  `insert into public.maintenance_tickets (site_id, title, issue, priority, reported_by)
   values ($1, 'Inverter 1 tripped', 'Fault code E012 since morning', 'high', auth.uid())`, [site.Sadas]);
await expectRows('Rahul sees tickets across his sites', RAHUL, `select 1 from public.maintenance_tickets`, 1);
await expectRows('Sales Exec sees no tickets', SALES, `select 1 from public.maintenance_tickets`, 0);
await expectError('Technician cannot assign a ticket to someone else', TECH,
  `update public.maintenance_tickets set assigned_to = $1`, 'permission to assign', [RAHUL]);
await expectOk('Rahul assigns the ticket to the technician', RAHUL, `update public.maintenance_tickets set assigned_to = $1`, [TECH]);
await expectValue('assigning moves the ticket out of "open"', RAHUL, `select status::text from public.maintenance_tickets`, 'assigned');
await expectOk('Technician starts work', TECH, `update public.maintenance_tickets set status = 'in_progress'`);
await expectValue('start time is stamped by the database', TECH, `select started_at is not null from public.maintenance_tickets`, true);
await expectOk('Technician resolves the ticket', TECH, `update public.maintenance_tickets set status = 'resolved', resolution = 'Reset inverter, cleaned filters'`);
await expectValue('downtime is computed', TECH, `select downtime_hours is not null from public.maintenance_tickets`, true);
await expectError('Technician cannot close the ticket (no APPROVE)', TECH, `update public.maintenance_tickets set status = 'closed'`, 'APPROVE permission');
await expectOk('O&M Manager closes the ticket', RAHUL, `update public.maintenance_tickets set status = 'closed'`);

await expectOk('Rahul schedules preventive maintenance', RAHUL,
  `insert into public.maintenance_records (site_id, type, title, scheduled_date, assigned_to)
   values ($1, 'preventive', 'Quarterly module cleaning', current_date + 5, $2)`, [site.Sadas, TECH]);
await expectRows('Technician sees maintenance assigned to him', TECH, `select 1 from public.maintenance_records`, 1);

{
  const r = await as(RAHUL, `select public.get_dashboard_summary() s`);
  const d = r.rows[0].s;
  Number(d.generation?.yesterday) === 36500 && d.tickets?.open === 0 && d.maintenance?.pending === 1
    ? ok('dashboard shows O&M figures for the caller sites')
    : bad('dashboard O&M', JSON.stringify({ g: d.generation, t: d.tickets, m: d.maintenance }));
}
await expectValue('users without O&M permission get no O&M section', SALES, `select public.get_dashboard_summary() ? 'generation'`, false);

console.log('\nHR / PMS (Phase 5)');
// Everyone in the demo has an employee record created with their user.
const empOf = async (uid) => (await asSystem(`select employee_id from public.profiles where id = $1`, [uid])).rows[0].employee_id;
const RAHUL_EMP = await empOf(RAHUL);
const TECH_EMP = await empOf(TECH);
const SALES_EMP = await empOf(SALES);

await expectOk('HR marks attendance for the team', OWNER,
  `select public.save_attendance(jsonb_build_array(
     jsonb_build_object('employee_id', $1::text, 'att_date', current_date::text, 'status', 'present'),
     jsonb_build_object('employee_id', $2::text, 'att_date', current_date::text, 'status', 'leave'),
     jsonb_build_object('employee_id', $3::text, 'att_date', current_date::text, 'status', 'present')))`,
  [RAHUL_EMP, TECH_EMP, SALES_EMP]);
await expectRows('an employee always sees their OWN attendance', TECH, `select 1 from public.attendance`, 1);
await expectRows('...and nobody else without HR permission', SALES, `select 1 from public.attendance`, 1);
await expectError('an employee cannot mark their own attendance without permission', TECH,
  `insert into public.attendance (employee_id, att_date, status) values ($1, current_date - 1, 'present')`,
  'row-level security', [TECH_EMP]);

// Leave: self-service apply, approval needs the permission
await expectOk('Technician applies for leave', TECH,
  `insert into public.leave_requests (employee_id, leave_type, from_date, to_date, days, reason)
   values ($1, 'casual', current_date + 3, current_date + 4, 2, 'Family function')`, [TECH_EMP]);
await expectRows('the applicant sees their request', TECH, `select 1 from public.leave_requests`, 1);
await expectRows('an unrelated colleague does not', SALES, `select 1 from public.leave_requests`, 0);
await expectError('the applicant cannot approve it', TECH, `update public.leave_requests set status = 'approved'`, 'APPROVE permission');
await expectOk('HR Admin approves the leave', OWNER, `update public.leave_requests set status = 'approved'`);
await expectValue('the approver is stamped', OWNER, `select approved_by = $1 from public.leave_requests`, true, [OWNER]);

// Performance
await expectOk('HR creates a review', OWNER,
  `insert into public.performance_reviews (employee_id, period_label, period_start, period_end, reviewer_id, status)
   values ($1, 'FY 2026-27 H1', date_trunc('year', current_date)::date, current_date, $2, 'manager_review')`, [TECH_EMP, RAHUL]);
await expectOk('goals are added to the review', OWNER,
  `insert into public.performance_goals (review_id, title, kpi, target, weight)
   select id, 'Ticket response time', 'Average response', 'under 4 hours', 40 from public.performance_reviews limit 1`);
await expectRows('the employee can see their own review', TECH, `select 1 from public.performance_reviews`, 1);
await expectRows('...and its goals', TECH, `select 1 from public.performance_goals`, 1);
await expectRows('a colleague cannot see it', SALES, `select 1 from public.performance_reviews`, 0);
await expectError('the employee cannot change their own rating', TECH,
  `update public.performance_reviews set overall_rating = 5`, 'only add your own comments');
await expectOk('the employee can add their own comments', TECH,
  `update public.performance_reviews set employee_comments = 'Happy with the support from the team.'`);
await expectError('the employee cannot complete the review', TECH,
  `update public.performance_reviews set status = 'completed'`, 'APPROVE permission');
await expectOk('HR completes the review', OWNER, `update public.performance_reviews set overall_rating = 4.2, status = 'completed'`);
await expectValue('completion is timestamped', OWNER, `select completed_at is not null from public.performance_reviews`, true);

// Task log
await expectOk('Rahul creates a task for the technician', RAHUL,
  `insert into public.tasks (title, module, assigned_to, due_date, site_id, priority)
   values ('Clean string 7 modules', 'om', $1, current_date + 2, $2, 'high')`, [TECH, site.Sadas]);
await expectRows('the assignee sees the task', TECH, `select 1 from public.tasks`, 1);
await expectRows('an unrelated colleague does not', SALES, `select 1 from public.tasks`, 0);
await expectOk('the assignee completes it', TECH, `update public.tasks set status = 'done'`);
await expectValue('completion time is stamped', TECH, `select completed_at is not null from public.tasks`, true);

// HR summary
{
  const r = await as(OWNER, `select public.get_hr_summary() s`);
  const h = r.rows[0].s;
  h.present === 2 && h.on_leave === 1 && h.leave_pending === 0 && h.tasks_open === 0
    ? ok('HR summary counts attendance, leave and tasks')
    : bad('hr summary', JSON.stringify(h));
}

console.log('\nPMS — the daily working sheet and the 60/20/10/10 score');
await expectValue('the score sheet keeps its four weighted criteria', OWNER,
  `select string_agg(key || ':' || weight, ' ' order by sort_order) from public.pms_criteria`,
  'kpi:60 competency:20 discipline:10 attendance:10');
await expectValue('and the KPI floor the legacy sheet gives for reporting the day', OWNER,
  `select floor_pct from public.pms_criteria where key = 'kpi'`, 60);

// An employee files their own sheet, exactly as the Google Form asked:
// tasks with a status, a priority and remarks.
await expectValue('an employee files their own working sheet', SALES,
  `select (public.save_work_log(current_date, $1::jsonb, 'medium', 'Tender file moved forward', true)->>'task_count')::int`,
  7, [JSON.stringify([
    { seq: 1, description: 'Tender fee DD prepared', status: 'completed' },
    { seq: 2, description: 'Bid document checklist', status: 'completed' },
    { seq: 3, description: 'Vendor quotation follow-up', status: 'not_started' },
    { seq: 4, description: 'Site visit report', status: 'not_started' },
    { seq: 5, description: 'EMD refund letter', status: 'not_started' },
    { seq: 6, description: 'Client call notes', status: 'not_started' },
    { seq: 7, description: 'Portal registration renewal', status: 'not_started' },
  ])]);
await expectError('no sheet for a future date', SALES,
  `select public.save_work_log(current_date + 1, '[]'::jsonb)`, 'future date');
await expectError('and none on a colleague behalf', SALES,
  `select public.save_work_log(current_date, '[{"seq":1,"description":"x","status":"completed"}]'::jsonb,
     'medium', null, true, $1)`, 'may not file', [TECH_EMP]);
await expectError('a submitted sheet is closed to its author', SALES,
  `select public.save_work_log(current_date, '[]'::jsonb)`, 'already submitted');

// The legacy sheet's own arithmetic: 2 of 7 tasks completed scores
// KPI 71, competency 29, final 68 "Good".
{
  const r = await as(OWNER, `select public.get_pms_scores() p`);
  const row = r.rows[0].p.rows.find((x) => x.employee_id === SALES_EMP);
  row && row.kpi === 71 && row.competency === 29 && row.discipline === 100
    && row.attendance === 100 && row.final === 68 && row.rating === 'Good'
    ? ok('2 of 7 tasks scores KPI 71 / competency 29 / final 68 "Good", as the legacy sheet does')
    : bad('pms scoring', JSON.stringify(row));
}
await expectValue('attendance comes from the register, not from discipline', OWNER,
  `select x->>'attendance_source' from jsonb_array_elements(public.get_pms_scores()->'rows') x
   where x->>'employee_id' = $1`, 'register', [SALES_EMP]);

// Work in progress counts half — 2 done + 2 running out of 4 is the same
// 0.75 the legacy sheet scores 90 / 75 / 89 "Excellent".
await expectOk('HR reopens the sheet', OWNER,
  `update public.work_logs set status = 'draft' where employee_id = $1`, [SALES_EMP]);
await expectValue('the employee re-files it', SALES,
  `select (public.save_work_log(current_date, $1::jsonb, 'high', null, true)->>'task_count')::int`,
  4, [JSON.stringify([
    { seq: 1, description: 'Tender fee DD prepared', status: 'completed' },
    { seq: 2, description: 'Bid document checklist', status: 'completed' },
    { seq: 3, description: 'Vendor quotation follow-up', status: 'in_progress' },
    { seq: 4, description: 'Site visit report', status: 'in_progress' },
  ])]);
{
  const r = await as(OWNER, `select public.get_pms_scores() p`);
  const row = r.rows[0].p.rows.find((x) => x.employee_id === SALES_EMP);
  row && row.kpi === 90 && row.competency === 75 && row.final === 89 && row.rating === 'Excellent'
    ? ok('work in progress counts half: 90 / 75 / 89 "Excellent"')
    : bad('pms half credit', JSON.stringify(row));
}
await expectValue('the task mix is counted for the status pie', OWNER,
  `select (public.get_pms_scores()->>'task_completed') || '/' || (public.get_pms_scores()->>'task_in_progress')`, '2/2');

// Scope: the sheet and the score are personal data.
await expectValue('an employee sees only their own line on the score sheet', SALES,
  `select jsonb_array_length(public.get_pms_scores()->'rows')`, 1);
await expectError('a colleague without the module cannot read the day sheets', TECH,
  `select public.get_work_logs()`, 'hr.worklog VIEW');
{
  const r = await as(OWNER, `select public.get_work_logs(current_date) w`);
  const e = r.rows[0].w.entries[0];
  r.rows[0].w.entries.length === 1 && e.tasks.length === 4 && Number(e.score) === 75 && e.priority === 'high'
    ? ok('the day sheet lists each task with its status, priority and score')
    : bad('work log day view', JSON.stringify(r.rows[0].w).slice(0, 200));
}
// Filing your own sheet needs no module permission — it is your own record.
await expectOk('a colleague with no HR permission still files their own sheet', TECH,
  `select public.save_work_log(current_date,
     '[{"seq":1,"description":"Module cleaning block C","status":"completed"}]'::jsonb, 'medium', null, true)`);
await expectValue('a site technician does not keep the daily sheet: even a sheet filed by hand is not scored', OWNER,
  `select count(*)::int from jsonb_array_elements(public.get_pms_scores()->'rows' || public.get_pms_scores()->'not_reporting') x
   where x->>'employee_id' = $1`, 0, [TECH_EMP]);
await expectValue('an employee who never reported is listed separately, not scored as zero', OWNER,
  `select jsonb_array_length(public.get_pms_scores()->'not_reporting') > 0`, true);

console.log('\nDaily Review (Phase 6)');
const deptOm = await id(`select id from public.departments where code = 'OM'`);
const deptHr = await id(`select id from public.departments where code = 'HR'`);

await expectOk('O&M files its daily report with metrics', RAHUL,
  `select public.save_daily_report(
     jsonb_build_object('department_id', $1::text, 'health', 'needs_attention',
                        'work_completed', 'Cleaned 4 blocks at Sadas; inverter 2 reset.',
                        'issues', 'Inverter 2 tripping repeatedly — OEM engineer required.',
                        'next_day_plan', 'String testing at Bassi.', 'status', 'submitted'),
     '[{"label":"Generation (kWh)","value":"36,500"},{"label":"Open tickets","value":"3"}]'::jsonb)`, [deptOm]);
await expectValue('the report carries its metrics', RAHUL, `select count(*)::int from public.daily_report_items`, 2);
await expectValue('submitting stamps the time', RAHUL, `select submitted_at is not null from public.daily_reports`, true);
await expectError('only one report per department per day', RAHUL,
  `select public.save_daily_report(jsonb_build_object('department_id', $1::text, 'work_completed', 'duplicate'), '[]'::jsonb)`,
  'duplicate key', [deptOm]);
await expectRows('a colleague without the permission sees nothing', TECH, `select 1 from public.daily_reports`, 0);
await expectError('the author cannot mark their own report reviewed', RAHUL,
  `update public.daily_reports set status = 'reviewed'`, 'APPROVE permission');

await expectOk('management adds a CCM remark', OWNER,
  `insert into public.review_actions (report_id, action, comment, reviewer_id)
   select id, 'ccm_remark', 'Escalate to OEM today; share the service ticket number.', auth.uid() from public.daily_reports limit 1`);
await expectOk('management marks the report reviewed', OWNER, `update public.daily_reports set status = 'reviewed'`);
await expectValue('the reviewer is stamped', OWNER, `select reviewed_by = $1 from public.daily_reports`, true, [OWNER]);
await expectRows('the author can read the remark on their report', RAHUL, `select 1 from public.review_actions`, 1);

// Deleting remarks: the writer or Management Review editors; never the report's history entries.
const deleted = (where) => `with d as (delete from public.review_actions where ${where} returning 1) select count(*)::int from d`;
await expectValue("the report's author cannot delete management's remark", RAHUL, deleted('true'), 0);
await expectOk('management adds a remark it will delete', OWNER,
  `insert into public.review_actions (report_id, action, comment, reviewer_id)
   select id, 'founder_remark', 'Typo, please ignore.', auth.uid() from public.daily_reports limit 1`);
await expectOk('a returned entry is part of the report history', OWNER,
  `insert into public.review_actions (report_id, action, comment, reviewer_id)
   select id, 'returned', 'Missing numbers', auth.uid() from public.daily_reports limit 1`);
await expectValue('management deletes a remark', OWNER, deleted(`comment = 'Typo, please ignore.'`), 1);
await expectValue('history entries cannot be deleted', OWNER, deleted(`action = 'returned'`), 0);
await expectValue('the deletion is in the audit log', OWNER,
  `select count(*)::int from public.audit_logs where module_key = 'daily.review' and action ilike '%delete%'`, 1);
await expectValue('the review lists remark ids and who may delete them', OWNER,
  `select bool_and((rv->>'id') is not null and (rv->>'can_delete')::boolean = (rv->>'action' in ('ccm_remark','founder_remark')))
     from public.daily_reports r,
          jsonb_array_elements(public.get_daily_review(r.report_date) -> 'departments') d,
          jsonb_array_elements(coalesce(d -> 'today' -> 'reviews', '[]')) rv
    where (d -> 'today' ->> 'id')::uuid = r.id`, true);
// Users may not delete history, so the test removes its own entry as the system.
await asSystem(`delete from public.review_actions where action = 'returned' and comment = 'Missing numbers'`);

await expectOk('the founder records the day headline', OWNER,
  `insert into public.daily_headlines (headline_date, metrics, note)
   values (current_date, '[{"label":"Collections today","value":"12,40,000"},{"label":"Generation","value":"36,500 kWh"}]'::jsonb,
           'Focus on the RVUNL EMD refund.')`);

{
  const r = await as(OWNER, `select public.get_daily_review() v`);
  const v = r.rows[0].v;
  const om = v.departments.find((d) => d.name === 'O&M / Service');
  v.totals.reported === 1 && v.totals.needs_attention === 1 && om?.today?.metrics?.length === 2
    && om?.today?.reviews?.length === 1 && v.headline?.metrics?.length === 2
    ? ok('the daily review shows departments, metrics, remarks and the headline')
    : bad('daily review', JSON.stringify({ totals: v.totals, om: om?.today?.status, headline: Boolean(v.headline) }));
}
{
  const r = await as(OWNER, `select public.get_daily_month() m`);
  const m = r.rows[0].m;
  Array.isArray(m) && m.length === 1 && m[0].reported === 1
    ? ok('the month view counts reporting days')
    : bad('daily month', JSON.stringify(m));
}
// The technician may file their OWN report, so they reach the page — but
// the "own" scope means other departments' reports stay invisible.
await expectValue('own-scope users see the page but not other departments', TECH,
  `select (public.get_daily_review()->'totals'->>'reported')::int`, 0);
await expectValue('a user with no daily permission at all gets nothing', ADMIN,
  `select public.get_daily_review() is not null`, true);
await expectValue('HR can file its own department report', OWNER,
  `select public.save_daily_report(jsonb_build_object('department_id', $1::text, 'work_completed', 'Payroll inputs closed.',
     'status', 'submitted'), '[]'::jsonb) is not null`, true, [deptHr]);
await expectOk('an editor can clear a submitted report back to not filed', OWNER,
  `select public.clear_daily_report(public.save_daily_report(
     jsonb_build_object('report_date', (current_date - 10)::text, 'department_id', $1::text, 'status', 'submitted'),
     '[{"label":"Staff present","value":""}]'::jsonb))`, [deptHr]);
await expectValue('the cleared report no longer counts as filed', OWNER,
  `select (public.get_daily_review(current_date - 10)->'totals'->>'reported')::int`, 0);
await expectValue('a fresh report can be filed after the empty one is cleared', OWNER,
  `select public.save_daily_report(jsonb_build_object('report_date', (current_date - 10)::text,
     'department_id', $1::text, 'work_completed', 'Replacement report', 'status', 'submitted'), '[]'::jsonb) is not null`,
  true, [deptHr]);
const replacementDailyReport = await id(`select id from public.daily_reports where report_date = current_date - 10 and deleted_at is null`);
await expectError('a user without report edit permission cannot clear a report', TECH,
  `select public.clear_daily_report($1)`, 'permission to edit', [replacementDailyReport]);

console.log('\nField entry — the technician form that replaces the Google Form');
await expectValue('the real portfolio is loaded with DC and AC capacity', OWNER,
  `select count(*)::int from public.solar_sites where capacity_dc_kwp > 0`, 12);
await expectValue('the O&M monthly record settles the contested capacities', OWNER,
  `select string_agg(s.name || ':' || ss.capacity_dc_kwp::int || '/' || ss.capacity_ac_kw::int, ' ' order by s.name)
   from public.solar_sites ss join public.sites s on s.id = ss.site_id
   where s.name in ('Jerthi','Bhojusar','Thikariya')`,
  'Bhojusar:3263/2475 Jerthi:3496/2750 Thikariya:4473/3300');
await expectValue('Sadas carries its real capacity and tilt', OWNER,
  `select capacity_dc_kwp::int || '/' || capacity_ac_kw::int || ' @' || tilt_degrees::int
   from public.solar_sites ss join public.sites s on s.id = ss.site_id where s.name = 'Sadas'`, '2903/2065 @22');

// The technician is assigned to Sadas only.
{
  const r = await as(TECH, `select public.get_field_entry() f`);
  const f = r.rows[0].f;
  // Seven, from the company's own site tab - not the 12 the seed guessed.
  f.sites.length === 1 && f.sites[0].name === 'Sadas' && f.sites[0].inverter_count === 7
    ? ok('the form offers only the sites the technician is assigned to, with its real inverter count')
    : bad('field entry form', JSON.stringify(f.sites?.map((x) => [x.name, x.inverter_count])));
}
await expectValue('the technician submits per-inverter readings', TECH,
  `select (public.save_field_entry($1, current_date,
     '[{"label":"INV-01","kwh":1850.5},{"label":"INV-02","kwh":1790.25},{"label":"INV-03","kwh":1902}]'::jsonb,
     5.42, 0.5, 0, 'INV-04 under maintenance')->>'generation_kwh')::numeric`, '5542.750', [site.Sadas]);
await expectValue('the day total is the sum of the inverters, computed in the database', TECH,
  `select generation_kwh::text from public.generation_records where site_id = $1 and gen_date = current_date`, '5542.750', [site.Sadas]);
await expectValue('the readings are kept for later reference', TECH,
  `select jsonb_array_length(inverter_readings) from public.generation_records where site_id = $1 and gen_date = current_date`, 3, [site.Sadas]);
await expectError('a technician cannot submit for a site they are not assigned', TECH,
  `select public.save_field_entry($1, current_date, '[{"label":"INV-01","kwh":100}]'::jsonb)`, 'not assigned to this site', [site.Bassi]);
await expectError('no readings for a future date', TECH,
  `select public.save_field_entry($1, current_date + 1, '[{"label":"INV-01","kwh":100}]'::jsonb)`, 'future date', [site.Sadas]);
await expectValue('re-submitting the same day corrects it instead of duplicating', TECH,
  `select (public.save_field_entry($1, current_date,
     '[{"label":"INV-01","kwh":1900},{"label":"INV-02","kwh":1800}]'::jsonb, 5.5, 0, 0, 'Corrected')->>'generation_kwh')::numeric`, '3700.000', [site.Sadas]);
await expectValue('still one row for that site and day', TECH,
  `select count(*)::int from public.generation_records where site_id = $1 and gen_date = current_date`, 1, [site.Sadas]);

// The O&M head sees it without any sync step.
await expectValue('the O&M head sees the submitted generation immediately', RAHUL,
  `select generation_kwh::int from public.generation_records where site_id = $1 and gen_date = current_date`, 3700, [site.Sadas]);
{
  const r = await as(RAHUL, `select public.get_generation_summary(current_date, current_date) s`);
  const g = r.rows[0].s;
  Number(g.today) === 3700 && g.ac_cuf !== null && g.specific_yield !== null && g.pr !== null
    ? ok('the monitor derives PR, DC CUF, AC CUF and specific yield from the field entry')
    : bad('monitor derivations', JSON.stringify({ today: g.today, cuf: g.cuf, ac: g.ac_cuf, sy: g.specific_yield, pr: g.pr }));
}
await expectValue('the technician still cannot open the tender pipeline', TECH,
  `select public.has_permission('crm.tenders','view')`, false);
// The form works through its own authorisation, so it keeps working even
// for a role that holds nothing but om.daily_entry.
await expectOk('narrowing the role back to the form alone', OWNER, `select public.set_role_permissions($1, $2)`, [
  role.technician,
  JSON.stringify([
    { module: 'dashboard', action: 'view' },
    { module: 'om.daily_entry', action: 'view' }, { module: 'om.daily_entry', action: 'create' }, { module: 'om.daily_entry', action: 'edit' },
  ]),
]);
await expectValue('the form still loads with only om.daily_entry', TECH,
  `select jsonb_array_length(public.get_field_entry()->'sites')`, 1);
await expectValue('and still saves', TECH,
  `select (public.save_field_entry($1, current_date, '[{"label":"INV-01","kwh":2100}]'::jsonb)->>'generation_kwh')::numeric`,
  '2100.000', [site.Sadas]);
await expectValue('but the wider O&M pages stay shut', TECH,
  `select public.get_generation_summary() = '{}'::jsonb`, true);

console.log('\nSite Operations — the daily site register (replaces the Site Operations tab)');
// Back to the shipped default scope: the form, the register, tickets, own score.
await expectOk('the Technician role is set back to its shipped scope', OWNER, `select public.set_role_permissions($1, $2)`, [
  role.technician,
  JSON.stringify([
    { module: 'dashboard', action: 'view' },
    { module: 'om.daily_entry', action: 'view' }, { module: 'om.daily_entry', action: 'create' }, { module: 'om.daily_entry', action: 'edit' },
    { module: 'om.operations', action: 'view' }, { module: 'om.operations', action: 'create' }, { module: 'om.operations', action: 'edit' },
    { module: 'om.tickets', action: 'view', scope: 'own' }, { module: 'om.tickets', action: 'create', scope: 'own' },
    { module: 'om.performance', action: 'view', scope: 'own' },
  ]),
]);
await expectValue('the register carries the 8 administration activities, 8 patrol rounds and 12 security points', OWNER,
  `select count(*) filter (where section = 'administration') || '/' ||
          count(*) filter (where section = 'patrol') || '/' ||
          count(*) filter (where section = 'security') from public.om_checklist_items`, '8/8/12');
await expectValue('the 21 site technicians are in the contact register', OWNER,
  `select count(*)::int from public.om_team_members where deleted_at is null`, 21);

{
  const r = await as(TECH, `select public.get_site_ops(current_date, $1, 'day') o`, [site.Sadas]);
  const o = r.rows[0].o;
  o.sites.length === 1 && o.checklist.length === 28 && o.technicians.length === 2 && o.log === null
    ? ok('the technician opens an empty register for their own site, with their site colleagues listed')
    : bad('site register', JSON.stringify({ sites: o.sites?.length, items: o.checklist?.length, team: o.technicians?.length }));
}
await expectError('a technician cannot open the register of another site', TECH,
  `select public.get_site_ops(current_date, $1, 'day')`, 'not assigned to this site', [site.Bassi]);
await expectError('no register for a future date', TECH,
  `select public.save_site_ops($1, current_date + 1, 'day', '[]'::jsonb)`, 'future date', [site.Sadas]);

// Twelve of the twenty-eight points answered: still a draft.
await expectValue('a part-filled register scores the readiness so far', TECH,
  `select (public.save_site_ops($1, current_date, 'day',
      (select jsonb_agg(jsonb_build_object('item_id', i.id, 'status',
              case when i.section = 'security' then 'ok' else 'pending' end))
       from public.om_checklist_items i),
      'Ramjan Hussain', null, 'normal', null, false)->>'readiness')::numeric`, '42.86', [site.Sadas]);
await expectValue('and it is still a draft', TECH,
  `select status::text from public.om_site_logs where site_id = $1 and log_date = current_date`, 'draft', [site.Sadas]);

await expectValue('submitting a completed register reads 100% ready', TECH,
  `select (public.save_site_ops($1, current_date, 'day',
      (select jsonb_agg(jsonb_build_object('item_id', i.id, 'status', 'ok'))
       from public.om_checklist_items i),
      'Ramjan Hussain', null, 'urgent', 'Boundary light replaced', true)->>'readiness')::numeric`, '100.00', [site.Sadas]);
await expectValue('the counts per section are stored with it', TECH,
  `select admin_done || '/' || patrol_done || '/' || security_done || ' ' || status::text
   from public.om_site_logs where site_id = $1 and log_date = current_date`, '8/8/12 submitted', [site.Sadas]);
await expectError('a technician cannot change a register they already submitted', TECH,
  `select public.save_site_ops($1, current_date, 'day', '[]'::jsonb)`, 'already submitted', [site.Sadas]);
await expectError('nor reopen it by hand', TECH,
  `update public.om_site_logs set status = 'draft' where site_id = $1 and log_date = current_date`,
  'reopened by a supervisor', [site.Sadas]);
await expectOk('the O&M head can reopen it', RAHUL,
  `update public.om_site_logs set status = 'draft' where site_id = $1 and log_date = current_date`, [site.Sadas]);
await expectOk('and close it again', RAHUL,
  `update public.om_site_logs set status = 'submitted' where site_id = $1 and log_date = current_date`, [site.Sadas]);

{
  const r = await as(RAHUL, `select public.get_site_ops_summary(current_date, current_date) s`);
  const g = r.rows[0].s;
  Number(g.submitted) === 1 && Number(g.avg_readiness) === 100 && g.logs[0].site === 'Sadas' && g.logs[0].urgency === 'urgent'
    ? ok('the O&M head sees the submitted register, its readiness and the shift urgency')
    : bad('ops summary', JSON.stringify(g).slice(0, 200));
}
await expectError('a sales user cannot read the site register at all', SALES,
  `select public.get_site_ops_summary()`, 'om.operations VIEW');

console.log('\nTeam Performance — the 80/20 technician score (replaces the Performance tab)');
await expectValue('the score sheet keeps its five criteria', OWNER,
  `select string_agg(key || ':' || max_score, ' ' order by sort_order) from public.om_score_criteria`,
  'attendance:20 daily_work:25 task_assigned:10 form_submit:25 monthly_review:20');
await expectValue('submitting the register scores the day automatically', RAHUL,
  `select attendance || '/' || daily_work || '/' || task_assigned || '/' || form_submit || ' = ' || auto_score
   from public.om_tech_scores where site_id = $1 and score_date = current_date`, '20/25/0/25 = 70', [site.Sadas]);
await expectValue('the task mark says why it is zero', RAHUL,
  `select task_status from public.om_tech_scores where site_id = $1 and score_date = current_date`, 'Not Applicable', [site.Sadas]);
await expectError('a technician cannot award themselves the monthly 20', TECH,
  `select public.save_tech_score((select id from public.om_tech_scores where site_id = $1), 20)`, 'not found|may not change', [site.Sadas]);
await expectValue('the reviewer awards the monthly marks', RAHUL,
  `select (public.save_tech_score((select id from public.om_tech_scores where site_id = $1 and score_date = current_date), 18,
           'Good month, watch the CCTV recordings')->>'total_score')::int`, 88, [site.Sadas]);
await expectValue('a technician sees their own score card', TECH,
  `select count(*)::int from public.om_tech_scores`, 1);
{
  const r = await as(RAHUL, `select public.get_team_performance(current_date - 7, current_date) p`);
  const p = r.rows[0].p;
  p.criteria.length === 5 && Number(p.record_count) === 1 && p.records[0].band === 'Good' && p.ranking[0].technician === 'Ramjan Hussain'
    ? ok('the performance page returns the records, the ranking and the criteria')
    : bad('team performance', JSON.stringify({ c: p.criteria?.length, n: p.record_count, r: p.ranking }).slice(0, 200));
}
await expectError('a sales user cannot read technician scores', SALES,
  `select public.get_team_performance()`, 'om.performance VIEW');
// The score functions run as SECURITY DEFINER, so they apply the data
// scope themselves — a technician sees their own card and no one else's.
await expectOk('the O&M head files the night register at the same site', RAHUL,
  `select public.save_site_ops($1, current_date, 'night',
     (select jsonb_agg(jsonb_build_object('item_id', i.id, 'status', 'ok')) from public.om_checklist_items i),
     'Komal', null, 'normal', null, true)`, [site.Sadas]);
await expectValue('the head sees both technicians', RAHUL,
  `select (public.get_team_performance(current_date, current_date)->>'record_count')::int`, 2);
await expectValue('the technician still sees only their own score', TECH,
  `select (public.get_team_performance(current_date, current_date)->>'record_count')::int`, 1);
// The site register is shared by the site team on purpose: the day shift
// must see what the night shift found. So its default scope is "all",
// bounded by the site.
await expectValue('both shifts of their own site are visible to the technician', TECH,
  `select jsonb_array_length(public.get_site_ops_summary(current_date, current_date)->'logs')`, 2);
await expectValue('the head sees the same two registers', RAHUL,
  `select jsonb_array_length(public.get_site_ops_summary(current_date, current_date)->'logs')`, 2);
// Narrowing the scope in Role Management narrows the summary too, which is
// what proves the SECURITY DEFINER function applies the scope itself.
await expectOk('the Super Admin narrows the register to "own"', OWNER, `select public.set_role_permissions($1, $2)`, [
  role.technician,
  JSON.stringify([
    { module: 'dashboard', action: 'view' },
    { module: 'om.operations', action: 'view', scope: 'own' },
    { module: 'om.performance', action: 'view', scope: 'own' },
  ]),
]);
await expectValue('the technician now sees only the register they filed', TECH,
  `select jsonb_array_length(public.get_site_ops_summary(current_date, current_date)->'logs')`, 1);
{
  const r = await as(RAHUL, `select public.get_om_teams() t`);
  const t = r.rows[0].t;
  Number(t.site_count) === 4 && t.sites.find((x) => x.site === 'Sadas').members.length === 2
    ? ok('the site team directory lists each site and its contacts')
    : bad('team directory', JSON.stringify(t).slice(0, 200));
}

console.log('\nSolar Analytics — dashboard, charts, shutdown and the portfolio year');
{
  const r = await as(RAHUL, `select public.get_daily_performance(current_date) d`);
  const d = r.rows[0].d;
  Number(d.site_count) === 4 && Number(d.total_generation) === 2100 && d.sites.length === 4
    && d.sites.find((x) => x.name === 'Sadas').dc_cuf !== null
    ? ok('the day view lists every assigned site with DC CUF, AC CUF, PR and specific yield')
    : bad('daily performance', JSON.stringify({ n: d.site_count, gen: d.total_generation }).slice(0, 200));
}
await expectError('a technician has no analytics pages', TECH,
  `select public.get_daily_performance()`, 'om.monitor VIEW');
await expectError('and cannot pull another site into a chart', TECH,
  `select public.get_site_analysis($1)`, 'om.analytics VIEW', [site.Bassi]);

// An outage day at Bassi: 11 hours lost is one generating day at 11 peak hours.
await expectOk('the O&M head records an outage day at Bassi', RAHUL,
  `select public.save_field_entry($1, current_date, '[{"label":"INV-01","kwh":9000}]'::jsonb, 5.1, 11, 0, 'Grid down 11:00-22:00')`,
  [site.Bassi]);
await expectValue('shutdown hours convert to generating days lost', RAHUL,
  `select round((x->>'shutdown_days')::numeric, 2)::text
   from jsonb_array_elements(public.get_shutdown_analysis(current_date)->'sites') x
   where x->>'site' = 'Bassi'`, '1.00');
await expectValue('and the month keeps the rest of its days', RAHUL,
  `select ((x->>'monthly_days')::numeric = extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day')) - 1)
   from jsonb_array_elements(public.get_shutdown_analysis(current_date)->'sites') x
   where x->>'site' = 'Bassi'`, true);
{
  const r = await as(RAHUL, `select public.get_site_analysis($1, current_date - 30, current_date) a`, [site.Bassi]);
  const a = r.rows[0].a;
  a.site === 'Bassi' && Number(a.record_count) === 2 && Number(a.best.generation_kwh) === 14500 && a.rows.length === 2
    ? ok('a site chart returns every reading in the range with its metrics')
    : bad('site analysis', JSON.stringify({ n: a.record_count, best: a.best }).slice(0, 200));
}
{
  const r = await as(RAHUL, `select public.get_portfolio_analytics(extract(year from current_date)::int) p`);
  const p = r.rows[0].p;
  Number(p.site_count) === 4 && Number(p.total_generation) > 0 && p.ranking[0].site === 'Sadas'
    && p.matrix.length === 4 && p.monthly.length >= 1
    ? ok('the portfolio year view totals generation, ranks the sites and keeps the month matrix')
    : bad('portfolio analytics', JSON.stringify({ n: p.site_count, total: p.total_generation, top: p.ranking?.[0] }).slice(0, 200));
}
await expectValue('the portfolio only ever counts the sites you may see', TECH,
  `select public.has_permission('om.analytics','view')`, false);

console.log('\nProjects (Phase 3) — plan, approvals, materials, vendors, bills, client money');
await expectValue('the three execution plans ship with the module', OWNER,
  `select count(*)::int from public.project_templates where deleted_at is null`, 3);
await expectValue('each plan carries its task list with day offsets', OWNER,
  `select count(*)::int from public.project_template_tasks t
   join public.project_templates p on p.id = t.template_id
   where p.name = 'Ground-mount Plant (MW scale)'`, 8);

const PRJ = await id(`insert into public.projects
  (name, client_name, segment, project_type, capacity_kwp, capacity_ac_kw, contract_value,
   start_date, target_commissioning, project_manager_id, site_id, district, state)
  values ('Deegod 3.57 MW', 'GCPL Solar Private Limited', 'government', 'ground_mount', 3570, 2800,
          115000000, current_date - 30, current_date + 120, $1, $2, 'Kota', 'Rajasthan')
  returning id`, [RAHUL, site.Sadas]);

await expectValue('applying a plan creates the tasks', ADMIN,
  `select public.apply_project_template($1, (select id from public.project_templates
     where name = 'Ground-mount Plant (MW scale)'))`, 8, [PRJ]);
await expectValue('and dates them from the project start date', ADMIN,
  `select (due_date - (select start_date from public.projects where id = $1))::int
   from public.project_tasks where project_id = $1 and title = 'Installation'`, 110, [PRJ]);
await expectOk('the project manager closes the survey', ADMIN,
  `update public.project_tasks set status = 'done' where project_id = $1 and title = 'Survey'`, [PRJ]);
await expectValue('closing a task is timestamped', ADMIN,
  `select completed_at is not null from public.project_tasks where project_id = $1 and title = 'Survey'`, true, [PRJ]);

{
  const r = await as(ADMIN, `select public.get_project_dashboard() d`);
  const d = r.rows[0].d;
  Number(d.project_count) === 1 && Number(d.capacity_kwp) === 3570 && Number(d.open_tasks) === 7
    && d.projects[0].progress === 13
    ? ok('the dashboard totals the portfolio and derives progress from the plan')
    : bad('project dashboard', JSON.stringify({ n: d.project_count, open: d.open_tasks, p: d.projects?.[0]?.progress }));
}

// Approvals and materials
await expectOk('an approval is tracked with its reference', ADMIN,
  `insert into public.project_approvals (project_id, kind, authority, reference_no, applied_on, expected_on, status)
   values ($1, 'Grid connectivity', 'JVVNL', 'JVVNL/CONN/2026/881', current_date - 20, current_date + 10, 'under_review')`, [PRJ]);
await expectOk('material lines are recorded with their shortage', ADMIN,
  `insert into public.project_materials (project_id, item, uom, qty_required, rate, status)
   values ($1, 'Structure', 'set', 3280, 1450, 'shortage')`, [PRJ]);
await expectValue('the line value is computed, not typed', ADMIN,
  `select amount::numeric from public.project_materials where project_id = $1`, '4756000.00', [PRJ]);

// Vendors and the two-step bill approval
const VEND = await id(`insert into public.vendors (name, category, payment_terms, phone)
  values ('I&C Vendor', 'Installation vendor', 'Milestone based', '7229869779') returning id`);
const BILL = await id(`insert into public.vendor_bills (project_id, vendor_id, bill_no, amount, deductions, description)
  values ($1, $2, 'INV/2026/118', 2500000, 125000, 'Civil works milestone 2') returning id`, [PRJ, VEND]);
await expectValue('the net payable is computed from the deductions', ADMIN,
  `select net_amount::numeric from public.vendor_bills where id = $1`, '2375000.00', [BILL]);
await expectError('a bill cannot skip the project-manager approval', ADMIN,
  `update public.vendor_bills set status = 'accounts_approved' where id = $1`, 'must approve the bill before', [BILL]);
await expectError('a bill cannot be paid before it is approved', ADMIN,
  `update public.vendor_bills set status = 'paid' where id = $1`, 'only be paid after', [BILL]);
// A user without the module never even sees the row, so the update
// touches nothing rather than erroring — and the bill stays submitted.
await expectRows('a sales user cannot reach a vendor bill at all', SALES,
  `update public.vendor_bills set status = 'pm_approved' where id = $1 returning id`, 0, [BILL]);
await expectValue('the bill is still waiting for its first approval', ADMIN,
  `select status::text from public.vendor_bills where id = $1`, 'submitted', [BILL]);
await expectOk('the project manager approves it', ADMIN,
  `update public.vendor_bills set status = 'pm_approved' where id = $1`, [BILL]);
await expectValue('the approver and the time are stamped', ADMIN,
  `select pm_approved_by = $2 and pm_approved_at is not null from public.vendor_bills where id = $1`, true, [BILL, ADMIN]);
await expectError('the same person cannot also give the accounts approval', ADMIN,
  `update public.vendor_bills set status = 'accounts_approved' where id = $1`, 'same person', [BILL]);
await expectOk('accounts approves it separately', OWNER,
  `update public.vendor_bills set status = 'accounts_approved' where id = $1`, [BILL]);
await expectOk('and pays it', OWNER,
  `update public.vendor_bills set status = 'paid', utr_no = 'SBIN2026091812' where id = $1`, [BILL]);
await expectValue('the payment date is stamped', OWNER,
  `select paid_on = current_date from public.vendor_bills where id = $1`, true, [BILL]);

// Client money
await expectOk('a client milestone is invoiced', ADMIN,
  `insert into public.client_payments (project_id, milestone, invoice_no, invoice_date, amount)
   values ($1, 'Supply - 40%', 'DRIPL/2026/44', current_date - 10, 46000000)`, [PRJ]);
await expectValue('an invoice with nothing received reads "invoiced"', ADMIN,
  `select status::text from public.client_payments where project_id = $1`, 'invoiced', [PRJ]);
await expectError('more money cannot be received than was invoiced', ADMIN,
  `update public.client_payments set received_amount = 50000000 where project_id = $1`, 'more than the invoiced', [PRJ]);
await expectOk('a part payment arrives', ADMIN,
  `update public.client_payments set received_amount = 20000000, received_on = current_date where project_id = $1`, [PRJ]);
await expectValue('the status follows the money by itself', ADMIN,
  `select status::text from public.client_payments where project_id = $1`, 'part_received', [PRJ]);
await expectValue('and the dashboard shows what is still outstanding', ADMIN,
  `select (public.get_project_dashboard()->>'client_outstanding')::numeric`, '26000000.00');

// The site engineer's day-wise update
await expectOk('the site engineer files the day-wise update', ADMIN,
  `select public.save_project_update($1, current_date,
     '{"tl_work":"completed","gss_bay":"completed","piling":"completed","panel":"in_progress",
       "module_work":"not_started","inverter":"not_started","material":"in_progress"}'::jsonb,
     'Piling completed for block A. Panel erection started.', 'Rain held work for two days.', null, 'Ankit Goyal')`,
  [PRJ]);
await expectValue('filing it twice corrects the day instead of duplicating it', ADMIN,
  `select count(*)::int from public.project_updates where project_id = $1 and update_date = current_date`, 1, [PRJ]);
await expectValue('and the project stage follows the site', ADMIN,
  `select stage::text from public.projects where id = $1`, 'installation', [PRJ]);
await expectError('no site update for a future date', ADMIN,
  `select public.save_project_update($1, current_date + 1, '{}'::jsonb)`, 'future date', [PRJ]);

await expectValue('a technician has no access to the project modules', TECH,
  `select public.has_permission('projects.bills','view')`, false);

// Site Updates — the page that replaces the Project CRM's Google Form
{
  const SE = await createAuthUser('site.engineer@diwakarsolar.test', 'Site Engineer One');
  await expectOk('a Site Engineer login is created', OWNER, `select public.admin_save_user($1, $2, true)`,
    [SE, JSON.stringify({ full_name: 'Site Engineer One', role_ids: [role.site_engineer] })]);
  await signIn(SE);
  await expectValue('the site engineer can pick any project site', SE,
    `select exists (select 1 from jsonb_array_elements(public.list_site_updates()->'projects') p where p->>'id' = $1::text)`, true, [PRJ]);
  await expectOk('and files the day with the three new work fronts', SE,
    `select public.save_project_update($1, current_date - 1,
       '{"tl_work":"completed","piling":"completed","icr_civil":"completed","cabling":"in_progress","electrical":"on_hold"}'::jsonb,
       'ICR civil done, DC cabling started', 'Electrical held for the shutdown', 'Rain in the evening', 'Site Engineer One')`, [PRJ]);
  await expectValue('the update lists with every front, the remarks and the engineer', SE,
    `select r->>'icr_civil' || '/' || (r->>'cabling') || '/' || (r->>'electrical') || '/' || (r->>'remarks') || '/' || (r->>'engineer_name')
     from jsonb_array_elements(public.list_site_updates(current_date - 1, current_date - 1, $1)->'rows') r`,
    'completed/in_progress/on_hold/Rain in the evening/Site Engineer One', [PRJ]);
  // The DPR: the team's WhatsApp format, filed in the suite
  const dpr = JSON.stringify({
    materials_received: false, materials_items: '', tomorrow_plan: 'Purlin installation\nModule installation',
    safety_followed: false, safety_note: 'PPE not available',
    activities: [
      { name: 'Piling work', status: 'completed' },
      { name: 'Module installation', status: 'in_progress', done: '936', total: '5292', unit: 'Nos' },
      { name: 'DC work', status: 'completed', note: 'Trench work pending 5 inverters' },
      { name: '   ', status: 'completed' },
      { name: 'MMS installation', status: 'nonsense', done: 'abc', total: '189', unit: 'Tables' },
    ],
  });
  await expectOk('the site engineer files a DPR in the WhatsApp format', SE,
    `select public.save_project_update($1, current_date - 2, '{"piling":"completed"}'::jsonb,
       'Purlin installation work\nPrecast wire fencing', null, 'Rain in the evening', 'Site Engineer One', $2::jsonb)`, [PRJ, dpr]);
  await expectValue('every section is kept, blank activity lines dropped and bad values cleaned', SE,
    `select (r->>'materials_received') || '/' || (r->>'safety_followed') || '/' || (r->>'safety_note') || '/' ||
            jsonb_array_length(r->'activities') || '/' || (r->'activities'->1->>'done') || '-' || (r->'activities'->1->>'total') || '/' ||
            (r->'activities'->3->>'status') || '/' || coalesce(r->'activities'->3->>'done', 'none') || '/' || (r->>'tomorrow_plan')
     from jsonb_array_elements(public.list_site_updates(current_date - 2, current_date - 2, $1)->'rows') r`,
    'false/false/PPE not available/4/936-5292/not_started/none/Purlin installation\nModule installation', [PRJ]);
  const dprId = (await asSystem('select id from public.project_updates where project_id = $1 and update_date = current_date - 2 and deleted_at is null', [PRJ])).rows[0].id;
  await expectOk('and attaches the site photos to it', SE,
    `insert into public.documents (module_key, entity_type, entity_id, category, file_name, storage_path)
     values ('projects.updates', 'project_update', $1::uuid, 'DPR photo', 'piling.jpg', 'projects.updates/' || $1::text || '/piling.jpg')`, [dprId]);
  await expectValue('the DPR list counts its photos', SE,
    `select (r->>'photos')::int from jsonb_array_elements(public.list_site_updates(current_date - 2, current_date - 2, $1)->'rows') r`, 1, [PRJ]);
  const NEWPRJ = (await asSystem(`insert into public.projects (name, stage) values ('Test Plant 1 MW', 'installation') returning id`)).rows[0].id;
  await expectValue('a site still being built shows as missing until today\'s DPR is filed', SE,
    `select exists (select 1 from jsonb_array_elements(public.list_site_updates()->'missing_today') m where m->>'id' = $1::text)`, true, [NEWPRJ]);
  await expectOk('the engineer files it', SE,
    `select public.save_project_update($1, (now() at time zone 'Asia/Kolkata')::date, '{}'::jsonb, 'Survey done')`, [NEWPRJ]);
  await expectValue('and it is no longer missing', SE,
    `select exists (select 1 from jsonb_array_elements(public.list_site_updates()->'missing_today') m where m->>'id' = $1::text)`, false, [NEWPRJ]);
  await asSystem('update public.projects set deleted_at = now() where id = $1', [NEWPRJ]);
  await expectValue('the site engineer sees no money or vendor bills', SE,
    `select public.has_permission('projects.bills','view') or public.has_permission('projects.payments','view')`, false);
  await expectError('a technician cannot file a project site update', TECH,
    `select public.save_project_update($1, current_date, '{}'::jsonb, 'x')`, 'You do not have permission', [PRJ]);
  await expectError('nor read them', TECH, `select public.list_site_updates()`, 'Access denied');

  const PM = await createAuthUser('project.manager@diwakarsolar.test', 'Project Manager One');
  await expectOk('a Project Manager login is created', OWNER, `select public.admin_save_user($1, $2, true)`,
    [PM, JSON.stringify({ full_name: 'Project Manager One', role_ids: [role.project_manager] })]);
  await signIn(PM);
  await expectValue('the project manager sees materials and tasks the team or an import recorded', PM,
    `select (select count(*) from public.project_materials where project_id = $1) > 0
        and (select count(*) from public.project_tasks where project_id = $1) > 0`, true, [PRJ]);
  await expectValue('and every site update', PM,
    `select count(*)::int from public.project_updates where project_id = $1 and update_date = current_date - 1`, 1, [PRJ]);
}

// The Projects report in Analytics
await expectValue('the projects report counts the portfolio', ADMIN,
  `select (public.report_projects()->'summary'->>'projects')::int = (select count(*)::int from public.projects where deleted_at is null)`, true);
await expectValue('and lists each project with its progress, tasks and site updates', ADMIN,
  `select (r->>'progress') is not null and (r->>'tasks_open') is not null and (r->>'updates')::int >= 1
   from jsonb_array_elements(public.report_projects(current_date - 7, current_date)->'by_project') r where r->>'project' = 'Deegod 3.57 MW'`, true);
await expectError('a site engineer cannot open the projects report', (await asSystem("select id from auth.users where email = 'site.engineer@diwakarsolar.test'")).rows[0].id,
  `select public.report_projects()`, 'denied');

console.log('\nSite master - the figures read out of the company spreadsheets');
await expectValue('every site carries its real inverter count', OWNER,
  `select string_agg(s.name || ':' || ss.inverter_count, ' ' order by s.name)
   from public.solar_sites ss join public.sites s on s.id = ss.site_id
   where ss.inverter_count is not null and s.name in ('Sadas','Bassi','Jerthi','Niwai','Budsu')`,
  'Bassi:12 Budsu:7 Jerthi:10 Niwai:8 Sadas:7');
await expectValue('and one row per inverter with its own DC capacity', OWNER,
  `select count(*)::int from public.site_inverters`, 113);
await expectValue('Sadas inverter 1 carries 27 strings of 28 x 550 W', OWNER,
  `select strings || 'x' || modules_per_string || 'x' || module_watt || '=' || dc_kwp
   from public.site_inverters i join public.sites s on s.id = i.site_id
   where s.name = 'Sadas' and i.seq = 1`, '27x28x550=415.80');
await expectValue('the Ganeshgarh sheet formula bug is repaired on the way in', OWNER,
  `select round(sum(dc_kwp))::int from public.site_inverters i
   join public.sites s on s.id = i.site_id where s.name = 'Ganeshgarh'`, 3281);
await expectValue('commissioning dates came across', OWNER,
  `select commissioning_date::text from public.solar_sites ss
   join public.sites s on s.id = ss.site_id where s.name = 'Bassi'`, '2025-11-29');

// Per-inverter peer comparison - the sheet's "Need to Check" column.
await expectOk('a day of per-inverter readings is filed', RAHUL,
  `select public.save_field_entry($1, current_date - 2, $2::jsonb, 5.5, 0, 0, null)`,
  [site.Sadas, JSON.stringify([
    { label: 'INV-01', kwh: 1466 }, { label: 'INV-02', kwh: 1361 }, { label: 'INV-03', kwh: 1529 },
    { label: 'INV-04', kwh: 1515 }, { label: 'INV-05', kwh: 1502 }, { label: 'INV-06', kwh: 1278 },
    { label: 'INV-07', kwh: 1457 },
  ])]);
{
  const r = await as(RAHUL, `select public.get_inverter_analysis($1, current_date - 2) a`, [site.Sadas]);
  const a = r.rows[0].a;
  const inv6 = a.inverters.find((x) => x.label === 'INV-06');
  const inv3 = a.inverters.find((x) => x.label === 'INV-03');
  // The sheet's own 23 September figures: INV-03 is the best at 1.000,
  // INV-06 trails at 0.839 and is the one it marks "Need to Check".
  Number(inv3.pct_of_best) === 1 && Math.abs(Number(inv6.pct_of_best) - 0.8392) < 0.001
    && inv6.status === 'Need to Check' && inv3.status === 'OK' && Number(a.flagged) === 1
    ? ok('a weak inverter is flagged by comparing it to its siblings, exactly as the sheet does')
    : bad('inverter analysis', JSON.stringify({ inv3, inv6, flagged: a.flagged }));
}
await expectError('the analysis stops at the sites you are assigned to', RAHUL,
  `select public.get_inverter_analysis($1)`, 'not assigned to this site', [site.Suaap]);
await expectError('and a technician without the module cannot reach it at all', TECH,
  `select public.get_inverter_analysis($1)`, 'may not read generation', [site.Sadas]);

console.log('\nOutage windows - when the plant was down, not just how long');
await expectValue('a labelled block splits grid from plant', OWNER,
  `select app.parse_outage_windows('Grid Failure :-\n18:10 - 18:23\nPlant Trip :-\n11:46 - 12:10')::text`,
  '[{"to": "18:23", "from": "18:10", "kind": "grid"}, {"to": "12:10", "from": "11:46", "kind": "plant"}]');
await expectValue('so the two kinds are counted apart', OWNER,
  `select app.outage_hours(app.parse_outage_windows('Grid Failure :-\n18:10 - 18:23\nPlant Trip :-\n11:46 - 12:10'), 'grid')::text
       || ' / ' ||
          app.outage_hours(app.parse_outage_windows('Grid Failure :-\n18:10 - 18:23\nPlant Trip :-\n11:46 - 12:10'), 'plant')::text`,
  '0.22 / 0.40');
await expectValue('"No" is not a window', OWNER,
  `select app.parse_outage_windows('No')::text`, '[]');
await expectValue('an en-dash window is read, and single-digit hours are padded', OWNER,
  `select app.parse_outage_windows(' 8:32 – 8:42')::text`,
  '[{"to": "08:42", "from": "08:32", "kind": "grid"}]');
await expectValue('a reversed window contributes nothing rather than a negative', OWNER,
  `select app.outage_hours(app.parse_outage_windows('10:18 - 02:46'))::text`, '0.00');

// The form records the windows; the hours follow from them.
await expectValue('the technician files windows and the hours are derived', RAHUL,
  `select (public.save_field_entry($1, current_date - 3, '[{"label":"INV-01","kwh":9000}]'::jsonb,
     5.1, 0, 0, null, $2::jsonb)->>'grid_outage_hrs')::text`,
  '1.50', [site.Bassi, JSON.stringify([
    { kind: 'grid', from: '07:00', to: '08:00' },
    { kind: 'grid', from: '13:30', to: '14:00' },
    { kind: 'plant', from: '11:00', to: '11:15' },
  ])]);
await expectValue('and the plant time is kept separate', RAHUL,
  `select plant_outage_hrs::text from public.generation_records
   where site_id = $1 and gen_date = current_date - 3`, '0.25', [site.Bassi]);
await expectValue('the windows themselves are on the record', RAHUL,
  `select jsonb_array_length(outage_windows) from public.generation_records
   where site_id = $1 and gen_date = current_date - 3`, 3, [site.Bassi]);
await expectValue('a site that only writes a total still works', RAHUL,
  `select (public.save_field_entry($1, current_date - 4, '[{"label":"INV-01","kwh":8000}]'::jsonb,
     5.0, 2.5, 0, null)->>'grid_outage_hrs')::numeric`, '2.5', [site.Bassi]);

// The import keeps the windows instead of flattening them.
{
  const r = await as(OWNER, `select public.import_om_generation($1::jsonb) i`, [JSON.stringify({
    reports: { '2026-04-11': [{ short: 'Sadas', generation: 12000, insolation: '5.2',
      outage: 'Grid Failure :-\n09:00 - 09:30\nPlant Trip :-\n14:00 - 14:45' }] },
  })]);
  Number(r.rows[0].i.inserted) === 1 ? ok('a legacy day with labelled outage imports') : bad('import', JSON.stringify(r.rows[0].i));
}
await expectValue('and its grid and plant hours land in their own columns', OWNER,
  `select grid_outage_hrs::text || ' / ' || plant_outage_hrs::text
   from public.generation_records g join public.sites s on s.id = g.site_id
   where s.name = 'Sadas' and g.gen_date = '2026-04-11'`, '0.50 / 0.75');
await expectValue('with the windows preserved for the audit', OWNER,
  `select outage_windows->1->>'from' from public.generation_records g
   join public.sites s on s.id = g.site_id
   where s.name = 'Sadas' and g.gen_date = '2026-04-11'`, '14:00');

console.log('\nMonth review - judged on the days the plant could have run');
await expectValue('the peak sun hours are a setting, confirmed as 11', OWNER,
  `select (value #>> '{}')::numeric::text from public.app_settings where key = 'om.peak_sun_hours'`, '11');
await expectValue('the June and July targets came across', OWNER,
  `select count(*)::int from public.site_monthly_targets where year = 2026 and month in (6,7)`, 22);

// A controlled month: Sadas (2,903 kWp DC, 2,065 kW AC) in May 2026, 31 days.
//   The O&M monthly record says 436,174.3 kWh; the two daily readings
//   below (400,000 kWh) are not the month's total, so the record wins.
//   Outage: 23 hours from the daily readings.
//   shutdown days  = 23 / 11                         = 2.0909
//   effective days = 31 - 2.0909                     = 28.9091
//   S.Y. per day   = 436174.3/28.9091/2903           = 5.20
//   DC CUF         = 436174.3/(2903*24*31)*100       = 20.19  (the workbook: 20.195)
//   AC CUF         = 436174.3/(2065*24*31)*100       = 28.39  (the workbook: 28.390)
await expectOk('two May readings for Sadas', OWNER,
  `select public.save_generation(jsonb_build_array(
     jsonb_build_object('site_id', $1::text, 'gen_date', '2026-05-10', 'generation_kwh', 250000,
                        'grid_outage_hrs', 13, 'plant_outage_hrs', 0),
     jsonb_build_object('site_id', $1::text, 'gen_date', '2026-05-11', 'generation_kwh', 150000,
                        'grid_outage_hrs', 10, 'plant_outage_hrs', 0)))`, [site.Sadas]);
{
  const r = await as(OWNER, `select public.get_month_review(2026, 5) m`);
  const row = r.rows[0].m.rows.find((x) => x.site === 'Sadas');
  Number(r.rows[0].m.days_in_month) === 31
    && Math.abs(Number(row.shutdown_days) - 2.0909) < 0.001
    && Math.abs(Number(row.effective_days) - 28.91) < 0.01
    && Math.abs(Number(row.actual) - 436174.3) < 0.01
    && Math.abs(Number(row.specific_yield) - 5.20) < 0.01
    && Math.abs(Number(row.dc_cuf) - 20.19) < 0.01
    && Math.abs(Number(row.ac_cuf) - 28.39) < 0.01
    ? ok('the month uses its recorded total, S.Y. is per effective day, and CUF is on calendar days like the workbook')
    : bad('month review', JSON.stringify(row));
}
console.log('\nCUF on AC & DC capacity - the O&M monthly record');
await expectValue("the workbook's 119 plant-months are the monthly record", OWNER,
  `select count(*)::int from public.site_monthly_generation where source = 'workbook'`, 119);
{
  // The Main tab, as of May 2026. Its figures, to three decimals:
  const main = { Suaap: [18.254, 22.344], Bassi: [18.392, 24.623], Budsu: [19.037, 24.12], Jerthi: [18.459, 23.467],
    Niwai: [16.664, 19.996], 'Indo Ka Bas': [21.666, 28.66], Ganeshgarh: [18.972, 25.081], Budhwara: [21.914, 28.82],
    Kadel: [23.433, 29.577], Thikariya: [23.278, 31.553] };
  const r = await as(OWNER, `select public.get_cuf_report(2026, '2026-05-01') c`);
  const plants = Object.fromEntries(r.rows[0].c.plants.map((p) => [p.name, p]));
  const off = Object.entries(main).filter(([n, [dc, ac]]) =>
    Math.abs(Number(plants[n]?.cuf_dc) - dc) > 0.001 || Math.abs(Number(plants[n]?.cuf_ac) - ac) > 0.001);
  off.length === 0
    ? ok('the report reproduces the Main tab to three decimals for every plant it lists')
    : bad('cuf main', JSON.stringify(off.map(([n]) => [n, plants[n]?.cuf_dc, plants[n]?.cuf_ac, plants[n]?.days])));
  // Sadas: the Main tab counts 607 days for October 2024 - May 2026, which is 608.
  Number(plants.Sadas?.days) === 608 && Math.abs(Number(plants.Sadas?.cuf_dc) - 17.56) < 0.01
    ? ok('Sadas counts the 608 days those months have (the Main tab typed 607)')
    : bad('cuf sadas', JSON.stringify(plants.Sadas));
}
await expectValue("a month's CUF matches its plant tab (Sadas, August 2026)", OWNER,
  `select (x->>'cuf_dc')::numeric::text || ' / ' || (x->>'cuf_ac')::numeric::text
     from jsonb_array_elements(public.get_cuf_report(2026)->'monthly') x
    where x->>'site' = 'Sadas' and (x->>'month')::int = 8`, '11.532 / 16.212');
await expectValue('with the JMR and the TL loss beside it', OWNER,
  `select (x->>'jmr_kwh')::numeric::int || ' / ' || (x->>'tl_loss_pct')::numeric::text
     from jsonb_array_elements(public.get_cuf_report(2026)->'monthly') x
    where x->>'site' = 'Sadas' and (x->>'month')::int = 8`, '240720 / 3.355');
await expectError('a sales user cannot open the CUF report', SALES,
  `select public.get_cuf_report()`, 'om.analytics VIEW');

await expectValue('a month with no target shows no forecast rather than a guess', OWNER,
  `select (x->>'forecast') is null from jsonb_array_elements(public.get_month_review(2026, 5)->'rows') x
   where x->>'site' = 'Budhwara'`, true);
await expectValue('and the review says how many targets are missing', OWNER,
  `select (public.get_month_review(2026, 5)->>'missing_targets')::int > 0`, true);
await expectValue('July is 31 days, not the 30 the review pack subtracts from', OWNER,
  `select (public.get_month_review(2026, 7)->>'days_in_month')::int`, 31);
await expectError('a sales user cannot open the month review', SALES,
  `select public.get_month_review()`, 'om.analytics VIEW');

// A bare DELETE or UPDATE is rejected outright when pg_safeupdate is on,
// which turns a working importer into one that cannot run at all. The
// importer's scratch table is dropped on commit, so the guard protects
// nothing there -- but it cannot know that, so the statement carries a WHERE.
await expectValue('no shipped function empties a table without a WHERE', OWNER,
  `select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prosrc ~* '(delete[[:space:]]+from|update)[[:space:]]+[a-z_]+[[:space:]]*;'`, 0);

await expectValue('every commissioned plant has a commissioning date', OWNER,
  `select count(*)::int from public.solar_sites
    where commissioning_date is null and capacity_dc_kwp > 0`, 0);
await expectValue('Kadel was commissioned before its first reading', OWNER,
  `select (ss.commissioning_date <= date '2026-04-15')
     from public.solar_sites ss join public.sites s on s.id = ss.site_id
    where s.name = 'Kadel'`, true);

console.log('\nLegacy import — bringing the four old apps history across');
const OM_PAYLOAD = JSON.stringify({
  reports: {
    '2026-01-05': [
      { site: 'Sadas - Chittorgarh', short: 'Sadas', generation: 9342, insolation: '5.18', outage: 'No', remarks: 'OK' },
      { site: 'Bassi - Sikar', short: 'Bassi', generation: 14663, insolation: '', outage: '07:24 -07:28\n13:40 - 13:45', remarks: '' },
      { site: 'Niwai - Tonk', short: 'Niwai', generation: 3461.41, insolation: '', outage: 'No', remarks: '' },
      { site: 'Gone Away - Nowhere', short: 'Gone Away', generation: 100, insolation: '', outage: 'No', remarks: '' },
      { site: 'Sadas - Chittorgarh', short: 'Sadas', generation: 0, insolation: '', outage: 'No', remarks: '' },
    ],
    '2026-01-06': [
      { site: 'Sadas - Chittorgarh', short: 'Sadas', generation: 9398, insolation: '5.4', outage: 'No', remarks: '' },
    ],
  },
});

await expectValue('a dry run reports what would land without writing anything', OWNER,
  `select public.import_om_generation($1::jsonb, true)->>'inserted'`, '4', [OM_PAYLOAD]);
await expectValue('and nothing was written', OWNER,
  `select count(*)::int from public.generation_records where gen_date = '2026-01-05'`, 0);
{
  const r = await as(OWNER, `select public.import_om_generation($1::jsonb) i`, [OM_PAYLOAD]);
  const i = r.rows[0].i;
  Number(i.inserted) === 4 && Number(i.ignored) === 1 && i.unknown_sites[0] === 'Gone Away'
    && i.from === '2026-01-05' && i.to === '2026-01-06'
    ? ok('the O&M history imports, and a site the suite does not know is reported, not invented')
    : bad('om import', JSON.stringify(i));
}
await expectValue('a zero reading is not a reading', OWNER,
  `select count(*)::int from public.generation_records where gen_date = '2026-01-05'`, 3);
// Real sheets use en dashes, labelled blocks and the odd reversed window.
await expectValue('an en-dash outage window is read too', OWNER,
  `select app.parse_outage_hours('07:00 – 08:24')::text`, '1.40');
await expectValue('labelled grid and plant windows are both counted', OWNER,
  `select app.parse_outage_hours('Grid Failure :-
18:10 - 18:23
Plant Trip :-
11:46 - 12:10')::text`, '0.62');
await expectValue('a window that ends before it starts counts as nothing', OWNER,
  `select app.parse_outage_hours('10:18 - 02:46')::text`, '0.00');
await expectValue('an insolation of 0.00 means not recorded, not no sun', OWNER,
  `select public.import_om_generation($1::jsonb)->>'inserted'`, '1', [JSON.stringify({
    reports: { '2026-03-02': [{ short: 'Sadas', generation: 15552, insolation: '0.00', outage: 'No' }] },
  })]);
await expectValue('so it is stored as unknown rather than zero', OWNER,
  `select irradiation_kwh_m2 is null from public.generation_records g join public.sites s on s.id = g.site_id
   where g.gen_date = '2026-03-02' and s.name = 'Sadas'`, true);
await expectValue('free-text outage windows become hours', OWNER,
  `select grid_outage_hrs::text from public.generation_records g join public.sites s on s.id = g.site_id
   where g.gen_date = '2026-01-05' and s.name = 'Bassi'`, '0.15');
await expectValue('insolation comes across so PR works on the history', OWNER,
  `select irradiation_kwh_m2::text from public.generation_records g join public.sites s on s.id = g.site_id
   where g.gen_date = '2026-01-05' and s.name = 'Sadas'`, '5.180');
await expectValue('the import is marked as legacy data', OWNER,
  `select source from public.generation_records where gen_date = '2026-01-06'`, 'legacy');
{
  const r = await as(OWNER, `select public.import_om_generation($1::jsonb) i`, [OM_PAYLOAD]);
  const i = r.rows[0].i;
  Number(i.inserted) === 0 && Number(i.skipped) === 4
    ? ok('running the same import again changes nothing')
    : bad('import idempotency', JSON.stringify(i));
}
{
  // Site access still applies: Rahul has Sadas, Thikariya, Bassi and Test Site.
  const r = await as(RAHUL, `select public.import_om_generation($1::jsonb) i`, [JSON.stringify({
    reports: { '2026-02-01': [
      { short: 'Sadas', generation: 9253, insolation: '', outage: 'No', remarks: '' },
      { short: 'Niwai', generation: 8658, insolation: '', outage: 'No', remarks: '' },
    ] },
  })]);
  const i = r.rows[0].i;
  Number(i.inserted) === 1 && Number(i.ignored) === 1
    ? ok('an import cannot reach a site the importer is not assigned to')
    : bad('import site scope', JSON.stringify(i));
}
await expectError('a sales user cannot import readings at all', SALES,
  `select public.import_om_generation($1::jsonb)`, 'om.generation CREATE', [OM_PAYLOAD]);
await expectValue('the import is written to the audit log', OWNER,
  `select count(*)::int > 0 from public.audit_logs where action = 'import' and module_key = 'om.generation'`, true);

// Zero generation: a day the plant was down is downtime; zero with clock
// times is a missing reading and is handed back rather than guessed at.
{
  const r = await as(OWNER, `select public.import_om_generation($1::jsonb) i`, [JSON.stringify({
    reports: {
      '2026-08-08': [{ short: 'Niwai', generation: 0, insolation: '', outage: 'Plant Trip Failure', remarks: '' }],
      '2026-08-09': [{ short: 'Niwai', generation: '', insolation: '', outage: 'Grid Failure', remarks: 'Feeder down' }],
      '2026-09-17': [{ short: 'Sadas', generation: 0, insolation: '', outage: '14:21 - 14:23\n14:55 - 15:48', remarks: '' }],
    },
  })]);
  const i = r.rows[0].i;
  Number(i.inserted) === 2 && Number(i.full_day_failures) === 2
    && i.needs_review.length === 1 && i.needs_review[0] === '2026-09-17 Sadas'
    ? ok('a full-day failure imports as downtime, and a zero with outage times is handed back for review')
    : bad('zero-generation import', JSON.stringify(i));
}
await expectValue('a plant failure counts as one whole shutdown day of plant outage', OWNER,
  `select generation_kwh::text || ' / ' || grid_outage_hrs::text || ' / ' || plant_outage_hrs::text
   from public.generation_records g join public.sites s on s.id = g.site_id
   where s.name = 'Niwai' and g.gen_date = '2026-08-08'`, '0.000 / 0.00 / 11.00');
await expectValue('a grid failure is grid outage, and the sheet text is kept in the remarks', OWNER,
  `select grid_outage_hrs::text || ' / ' || remarks
   from public.generation_records g join public.sites s on s.id = g.site_id
   where s.name = 'Niwai' and g.gen_date = '2026-08-09'`, '11.00 / Grid Failure · Feeder down');
await expectValue('the missing reading was not written as a zero', OWNER,
  `select count(*)::int from public.generation_records g join public.sites s on s.id = g.site_id
   where s.name = 'Sadas' and g.gen_date = '2026-09-17'`, 0);

// A site under construction is not a plant yet: it stays off the O&M pages
// until it has a DC capacity, and appears the moment it gets one.
await expectValue('Deegod (0 kWp, under construction) is not on the day view', OWNER,
  `select count(*)::int from jsonb_array_elements(public.get_daily_performance()->'sites') x
   where x->>'name' = 'Deegod'`, 0);
await expectValue('nor in the daily field form', OWNER,
  `select count(*)::int from jsonb_array_elements(public.get_field_entry()->'sites') x
   where x->>'name' = 'Deegod'`, 0);
await expectValue('nor in the portfolio', OWNER,
  `select count(*)::int from jsonb_array_elements(public.get_portfolio_analytics()->'ranking') x
   where x->>'site' = 'Deegod'`, 0);
await expectOk('Deegod gets its DC capacity', OWNER,
  `update public.solar_sites set capacity_dc_kwp = 3570
   where site_id = (select id from public.sites where name = 'Deegod')`);
await expectValue('and is on the day view from then on', OWNER,
  `select count(*)::int from jsonb_array_elements(public.get_daily_performance()->'sites') x
   where x->>'name' = 'Deegod'`, 1);
await expectOk('(put back as it was)', OWNER,
  `update public.solar_sites set capacity_dc_kwp = 0
   where site_id = (select id from public.sites where name = 'Deegod')`);

// The Daily Entry asks what the technicians' Google Form asks.
console.log('\nDaily Entry - weather, failure side and reason');
await expectValue('the reason list has the fifteen causes found in the history', OWNER,
  `select count(*)::int from public.om_failure_reasons where is_active`, 15);
await expectValue('the form loads the reasons with the day', OWNER,
  `select jsonb_array_length(public.get_field_entry()->'failure_reasons')`, 15);
const entryArgs = `$1, current_date - 9, '[{"label":"INV-01","kwh":8000}]'::jsonb, 5.1, 0, 0`;
await expectError('a failure needs a side', OWNER,
  `select public.save_field_entry(${entryArgs}, null, '[{"kind":"grid","from":"10:00","to":"10:20"}]'::jsonb,
     'Clear Weather', true, null, '33 kV grid outage from the GSS side')`, 'which side', [site.Bassi]);
await expectError('and a reason', OWNER,
  `select public.save_field_entry(${entryArgs}, null, '[{"kind":"grid","from":"10:00","to":"10:20"}]'::jsonb,
     'Clear Weather', true, 'gss', null)`, 'failure reason', [site.Bassi]);
await expectError('"Other" needs the details written down', OWNER,
  `select public.save_field_entry(${entryArgs}, null, '[]'::jsonb, 'Clear Weather', true, 'plant', 'Other')`,
  'Describe the failure', [site.Bassi]);
await expectError('"no failure" cannot come with outage times', OWNER,
  `select public.save_field_entry(${entryArgs}, null, '[{"kind":"grid","from":"10:00","to":"10:20"}]'::jsonb,
     'Clear Weather', false, null, null)`, 'no failure', [site.Bassi]);
await expectError('the weather must be one of the form\'s choices', OWNER,
  `select public.save_field_entry(${entryArgs}, null, '[]'::jsonb, 'Blazing', false, null, null)`,
  'generation_weather_check', [site.Bassi]);
await expectValue('a full entry saves the answers', OWNER,
  `select (public.save_field_entry(${entryArgs}, 'Tripped twice', '[{"kind":"grid","from":"10:00","to":"10:20"}]'::jsonb,
     'Lightly Cloudy', true, 'gss', '33 kV grid outage from the GSS side')->>'had_failure')::boolean`, true, [site.Bassi]);
await expectValue('and they come back on the form', OWNER,
  `select e->>'weather' || ' / ' || (e->>'failure_side') || ' / ' || (e->>'failure_reason')
   from jsonb_array_elements(public.get_field_entry(current_date - 9)->'sites') s, lateral (select s->'entry' as e) x
   where s->>'name' = 'Bassi'`, 'Lightly Cloudy / gss / 33 kV grid outage from the GSS side');
await expectValue('the day view shows the weather and the reason', OWNER,
  `select s->>'weather' || ' / ' || (s->>'failure_reason')
   from jsonb_array_elements(public.get_daily_performance(current_date - 9)->'sites') s where s->>'name' = 'Bassi'`,
  'Lightly Cloudy / 33 kV grid outage from the GSS side');

// Legacy remarks are read for the same answers.
await expectOk('three legacy days with the remarks the team writes', OWNER,
  `select public.import_om_generation($1::jsonb)`, [JSON.stringify({ reports: {
    '2026-02-02': [{ short: 'Kadel', generation: 15000, insolation: '', outage: '11:00 - 11:14',
      remarks: 'OK, Lightly Cloudy Weather, Grid Failure = 14 M (Due to a 33 kV grid outage from the GSS side)' }],
    '2026-02-03': [{ short: 'Kadel', generation: 14000, insolation: '', outage: 'Plant Trip :-\n12:00 - 12:35',
      remarks: 'OK, Clear Weather, Plant Trip = 35 M (Due to plant-side B-phase fuse burnt)' }],
    '2026-02-04': [{ short: 'Kadel', generation: 9000, insolation: '', outage: '13:00 - 13:30',
      remarks: 'Fully Cloudy & Stormy Weather, Grid Failure = 30 M (Due to 33 kV grid outage from the GSS side)' }],
  } })]);
const legacyDay = (d) => `select coalesce(weather,'-') || ' / ' || coalesce(failure_side,'-') || ' / ' || coalesce(failure_reason,'-')
  from public.generation_records where gen_date = '${d}' and site_id = (select id from public.sites where name = 'Kadel')`;
await expectValue('a GSS outage remark gives weather, side and reason', OWNER, legacyDay('2026-02-02'),
  'Lightly Cloudy / gss / 33 kV grid outage from the GSS side');
await expectValue('a plant trip for a burnt fuse is a plant-side fuse failure', OWNER, legacyDay('2026-02-03'),
  'Clear Weather / plant / Fuse burnt (DO / HT fuse)');
await expectValue('"stormy weather" does not make a grid outage a storm outage', OWNER, legacyDay('2026-02-04'),
  'Fully Cloudy / gss / 33 kV grid outage from the GSS side');
await expectValue('a technician can read the reason list', TECH,
  `select count(*)::int > 0 from public.om_failure_reasons`, true);
await expectError('but cannot change it', TECH,
  `insert into public.om_failure_reasons (side, label) values ('gss', 'Made up')`, 'row-level security');

// Forecasts from the Master workbook.
const target = (site, month) => `select forecast_kwh::int from public.site_monthly_targets t
  join public.sites s on s.id = t.site_id where s.name = '${site}' and t.year = 2026 and t.month = ${month}`;
await expectValue('the Master file forecasts every month for its eight plants', OWNER,
  `select count(*)::int from public.site_monthly_targets where year = 2026
     and site_id in (select id from public.sites where name in
       ('Bassi','Suaap','Jerthi','Indo Ka Bas','Sadas','Budsu','Ganeshgarh','Niwai'))`, 96);
await expectValue('July is the Master figure, not June repeated', OWNER, target('Bassi', 7), 545900);
await expectValue('June keeps the review pack figure', OWNER, target('Suaap', 6), 433700);
await expectValue('a plant the Master file does not forecast keeps its July target', OWNER, target('Budhwara', 7), 606600);

// Insolation the sun cannot deliver.
await expectError('the daily form refuses an insolation of 44.77', OWNER,
  `select public.save_field_entry($1, current_date - 6, '[{"label":"INV-01","kwh":9000}]'::jsonb, 44.77)`,
  'not possible', [site.Bassi]);
await expectValue('and a real one is still accepted', OWNER,
  `select (public.save_field_entry($1, current_date - 6, '[{"label":"INV-01","kwh":9000}]'::jsonb, 4.477)->>'generation_kwh')::numeric::int`,
  9000, [site.Bassi]);
{
  const r = await as(OWNER, `select public.import_om_generation($1::jsonb) i`, [JSON.stringify({
    reports: {
      '2026-09-19': [{ short: 'Niwai', generation: 12000, insolation: '44.77', outage: 'No' }],
      '2026-09-23': [{ short: 'Niwai', generation: 12576, insolation: '3.94', outage: 'No' }],
    },
  })]);
  const i = r.rows[0].i;
  Number(i.inserted) === 2 && i.insolation_rejected.length === 1 && i.insolation_rejected[0].startsWith('2026-09-19 Niwai')
    && i.suspect_pr.length === 1 && i.suspect_pr[0].startsWith('2026-09-23 Niwai: PR 121')
    ? ok('the importer keeps the reading, drops an impossible insolation and flags a PR over 100%')
    : bad('insolation import', JSON.stringify(i));
}
await expectValue('a dry run flags the PR too, before anything is written', OWNER,
  `select jsonb_array_length(public.import_om_generation($1::jsonb, true)->'suspect_pr')`, 1,
  [JSON.stringify({ reports: { '2026-09-25': [{ short: 'Niwai', generation: 12576, insolation: '3.94', outage: 'No' }] } })]);
// A second import fills in what a generation-only first import left out,
// without touching generation or anything edited in the suite.
await expectOk('a generation-only first import (like production on 26 Sep)', OWNER,
  `select public.import_om_generation($1::jsonb)`, [JSON.stringify([
    { date: '2026-03-10', site: 'Suaap', generation: 16000 },
    { date: '2026-03-11', site: 'Suaap', generation: 15000 },
    { date: '2026-03-12', site: 'Suaap', generation: 14000 },
  ])]);
await expectOk('one of them is then corrected in the suite', OWNER,
  `update public.generation_records set remarks = 'Checked on site'
   where site_id = (select id from public.sites where name = 'Suaap') and gen_date = '2026-03-12'`);
{
  const r = await as(OWNER, `select public.import_om_generation($1::jsonb) i`, [JSON.stringify({ reports: {
    '2026-03-10': [{ short: 'Suaap', generation: 16000, insolation: '5.4', outage: '10:00 - 10:30', remarks: 'Grid trip' }],
    '2026-03-11': [{ short: 'Suaap', generation: 99999, insolation: '5.1', outage: 'No', remarks: '' }],
    '2026-03-12': [{ short: 'Suaap', generation: 14000, insolation: '5.0', outage: '11:00 - 11:15', remarks: 'x' }],
  } })]);
  const i = r.rows[0].i;
  Number(i.filled) === 2 && Number(i.skipped) === 1 && Number(i.inserted) === 0
    ? ok('the second import fills the two untouched readings and leaves the corrected one alone')
    : bad('fill import', JSON.stringify(i));
}
await expectValue('the outage, its hours, the remarks and the insolation arrived', OWNER,
  `select grid_outage_hrs::text || ' / ' || remarks || ' / ' || irradiation_kwh_m2::text
   from public.generation_records where gen_date = '2026-03-10'
     and site_id = (select id from public.sites where name = 'Suaap')`, '0.50 / Grid trip / 5.400');
await expectValue('generation was not changed by the import', OWNER,
  `select generation_kwh::int from public.generation_records where gen_date = '2026-03-11'
     and site_id = (select id from public.sites where name = 'Suaap')`, 15000);
await expectValue('the reading corrected in the suite kept its own values', OWNER,
  `select remarks || ' / ' || coalesce(irradiation_kwh_m2::text, 'none') from public.generation_records
   where gen_date = '2026-03-12' and site_id = (select id from public.sites where name = 'Suaap')`, 'Checked on site / none');
// An impossible insolation already stored by an earlier import (Kadel's
// 9.92 in production predates the check), so it is planted past the guard.
await db.exec(`
  alter table public.generation_records disable trigger guard_insolation;
  update public.generation_records set irradiation_kwh_m2 = 9.92, updated_by = null
   where gen_date = '2026-03-11' and site_id = (select id from public.sites where name = 'Suaap');
  alter table public.generation_records enable trigger guard_insolation;`);
await expectValue('is cleared by the next import when it has nothing valid to put there', OWNER,
  `select (public.import_om_generation($1::jsonb)->>'filled')::int`, 1,
  [JSON.stringify({ reports: { '2026-03-11': [{ short: 'Suaap', generation: 15000, insolation: '', outage: 'No' }] } })]);
await expectValue('so it reads as not recorded', OWNER,
  `select irradiation_kwh_m2 is null from public.generation_records where gen_date = '2026-03-11'
     and site_id = (select id from public.sites where name = 'Suaap')`, true);
await expectValue('running it again fills nothing', OWNER,
  `select (public.import_om_generation($1::jsonb)->>'filled')::int`, 0,
  [JSON.stringify({ reports: { '2026-03-10': [{ short: 'Suaap', generation: 16000, insolation: '5.9', outage: '12:00 - 13:00', remarks: 'y' }] } })]);
await expectValue('the dropped insolation is stored as not recorded', OWNER,
  `select irradiation_kwh_m2 is null from public.generation_records g join public.sites s on s.id = g.site_id
   where s.name = 'Niwai' and g.gen_date = '2026-09-19'`, true);

// Daily Review
const DR_PAYLOAD = JSON.stringify({
  depts: [{ id: 'dept-om', name: 'O&M / Service' }, { id: 'dept-x', name: 'Ghost Department' }],
  reports: [
    { deptId: 'dept-om', date: '2026-01-05', status: 'On track', reporter: 'Rajpal',
      metrics: [{ label: 'Generation (kWh)', value: '45,300' }, { label: 'Open tickets', value: '3' }],
      highlights: 'Cleaned 4 blocks at Sadas.', blockers: '', remarks: '' },
    { deptId: 'dept-x', date: '2026-01-05', status: 'Critical', metrics: [], highlights: 'x' },
    // The shape the live export actually has: the CCM's comment typed into
    // `blockers`, the status only saying that he commented.
    { deptId: 'dept-om', date: '2026-01-06', status: ' CCM Remarks', reporter: 'Rajpal Singh',
      analyzedBy: 'Jitendra Sharma', metrics: [{ label: 'Open tickets', value: '1' }],
      highlights: 'Inverter 3 checked.',
      blockers: 'Monitor closely to avoid delay in the installation schedule.', remarks: '' },
  ],
  notes: [{ date: '2026-01-06', text: 'Founder: keep an eye on Digod.' }],
});
{
  const r = await as(OWNER, `select public.import_daily_reports($1::jsonb) i`, [DR_PAYLOAD]);
  const i = r.rows[0].i;
  Number(i.inserted) === 2 && Number(i.ignored) === 1 && Number(i.ccm_remarks) === 1
    && i.unknown_departments[0] === 'Ghost Department'
    ? ok('daily reports import and an unmatched department is reported')
    : bad('daily import', JSON.stringify(i));
}
await expectValue('the metrics come across as report lines', OWNER,
  `select count(*)::int from public.daily_report_items i
   join public.daily_reports r on r.id = i.report_id where r.report_date = '2026-01-05'`, 2);
await expectValue('a report nobody signed off stays submitted, not claimed as reviewed', OWNER,
  `select status::text from public.daily_reports where report_date = '2026-01-05'`, 'submitted');
await expectValue('one the CCM looked at is marked reviewed', OWNER,
  `select status::text from public.daily_reports where report_date = '2026-01-06'`, 'reviewed');
await expectValue('the reporter name survives with no account to link to', OWNER,
  `select reporter_name from public.daily_reports where report_date = '2026-01-06'`, 'Rajpal Singh');
await expectValue('the CCM comment becomes a review action, not the department blockers', OWNER,
  `select count(*)::int from public.review_actions a
   join public.daily_reports r on r.id = a.report_id
   where r.report_date = '2026-01-06' and a.action = 'ccm_remark'
     and a.reviewer_name = 'Jitendra Sharma'`, 1);
await expectValue('and the issues column is left empty rather than holding his words', OWNER,
  `select issues is null from public.daily_reports where report_date = '2026-01-06'`, true);
await expectValue('a CCM remark does not by itself make a department unhealthy', OWNER,
  `select health::text from public.daily_reports where report_date = '2026-01-06'`, 'on_track');
await expectValue('the founder note lands on the day it belongs to', OWNER,
  `select note from public.daily_headlines where headline_date = '2026-01-06'`,
  'Founder: keep an eye on Digod.');
await expectValue('Accounts and Finance is out of the daily round (but active for HR)', OWNER,
  `select status::text || ' / ' || in_daily_review::text from public.departments where name = 'Accounts & Finance'`, 'active / false');

// Solar Sites portfolio
await expectValue('the O&M register is called Generation Sites', OWNER,
  `select label from public.modules where key = 'om.sites'`, 'Generation Sites');
await expectValue('Solar Sites is its own top-level section', OWNER,
  `select g.key from public.modules m join public.module_groups g on g.id = m.group_id
    where m.key = 'sites.overview'`, 'portfolio');
await expectValue('and it renders flat, because the group shares its label', OWNER,
  `select (g.label = m.label) from public.modules m
   join public.module_groups g on g.id = m.group_id where m.key = 'sites.overview'`, true);
{
  const r = await as(OWNER, `select public.get_site_portfolio() p`);
  const p = r.rows[0].p;
  Number(p.sites) > 0 && Array.isArray(p.rows) && p.rows.every((x) => x.capacity_dc_kwp > 0)
    ? ok('the portfolio lists every plant that has a capacity on record')
    : bad('portfolio', JSON.stringify(p).slice(0, 200));
}
await expectError('a sales user cannot open the portfolio', SALES,
  `select public.get_site_portfolio()`, 'sites.overview VIEW');
// SECURITY DEFINER, so the site scope has to be applied inside the function.
{
  const all = await as(OWNER, `select (public.get_site_portfolio()->>'sites')::int n`);
  const one = await as(TECH, `select (public.get_site_portfolio()->>'sites')::int n`).catch(() => null);
  one === null || Number(one.rows[0].n) < Number(all.rows[0].n)
    ? ok('a technician sees fewer plants than the owner, or none at all')
    : bad('portfolio scope', `tech saw ${one.rows[0].n} of ${all.rows[0].n}`);
}

// Navigation grouping
await expectValue('O&M holds only O&M modules', OWNER,
  `select count(*)::int from public.modules m
   join public.module_groups g on g.id = m.group_id
   where g.key = 'operations' and m.key not like 'om.%'`, 0);
await expectValue('Projects and Vendors sit in their own group', OWNER,
  `select count(*)::int from public.modules m
   join public.module_groups g on g.id = m.group_id
   where g.key = 'projects' and m.key in ('projects.projects','projects.vendors')`, 2);
await expectValue('Daily Review is its own group again, not part of HR', OWNER,
  `select g.key from public.modules m
   join public.module_groups g on g.id = m.group_id where m.key = 'daily.review'`, 'daily_review');
await expectValue('and its routes point back at /daily-review', OWNER,
  `select route from public.modules where key = 'daily.reports'`, '/daily-review/reports');
await expectValue('HR is labelled HR again', OWNER,
  `select label from public.module_groups where key = 'hr'`, 'HR & Performance');

// Founder remarks across departments
{
  const r = await as(OWNER, `select public.save_review_remark('2026-01-06'::date,
    'Keep an eye on Digod deliveries.') x`);
  const x = r.rows[0].x;
  // Only O&M reported that day, so one remark lands and the rest are named.
  Number(x.applied) === 1 && x.no_report_that_day.length > 0
    ? ok('a founder remark to every department reaches the ones that reported, and names the ones that did not')
    : bad('bulk remark', JSON.stringify(x));
}
await expectValue('sending the same remark again does not double-post it', OWNER,
  `select (public.save_review_remark('2026-01-06'::date,
     'Keep an eye on Digod deliveries.')->>'applied')::int`, 0);
await expectValue('it is filed as a founder remark', OWNER,
  `select count(*)::int from public.review_actions a
   join public.daily_reports r on r.id = a.report_id
   where r.report_date = '2026-01-06' and a.action = 'founder_remark'`, 1);
await expectError('an empty remark is refused', OWNER,
  `select public.save_review_remark('2026-01-06'::date, '   ')`, 'needs some text');
await expectError('an unknown remark type is refused', OWNER,
  `select public.save_review_remark('2026-01-06'::date, 'hi', null, 'sack_them')`, 'Unknown remark type');
await expectError('a technician cannot write founder remarks', TECH,
  `select public.save_review_remark('2026-01-06'::date, 'hi')`, 'daily.review');

// PMS work sheets
const PMS_PAYLOAD = JSON.stringify([
  { employee: 'Technician One', post: 'Technician', department: 'O&M / Service', date: '2026-01-05',
    priority: 'Medium', remarks: 'All done',
    tasks: [{ description: 'Module cleaning block A', status: 'Completed' },
            { description: 'String testing', status: 'In Progress' }] },
  { employee: 'Somebody Unknown', post: 'Officer', department: 'Admin', date: '2026-01-05',
    priority: 'Low', tasks: [{ description: 'Filing', status: 'Completed' }] },
]);
{
  const r = await as(OWNER, `select public.import_work_logs($1::jsonb) i`, [PMS_PAYLOAD]);
  const i = r.rows[0].i;
  Number(i.inserted) === 1 && Number(i.employees_created) === 0 && i.unknown_employees[0] === 'Somebody Unknown'
    ? ok('work sheets import, and a name not on the master is reported, not made into an employee')
    : bad('pms import', JSON.stringify(i));
}
await expectValue('the task statuses are mapped from the form wording', OWNER,
  `select count(*) filter (where t.status = 'completed') || '/' || count(*) filter (where t.status = 'in_progress')
   from public.work_log_tasks t join public.work_logs w on w.id = t.log_id
   where w.log_date = '2026-01-05'`, '1/1');

console.log('\nPMS people - the master, its spellings, and the history');
await expectValue('the 21 PMS employees are on the master with their DRIPL numbers', OWNER,
  `select count(*)::int from public.employees where employee_code like 'DRIPL\\_%'`, 20);
await expectValue('Shivdatt Singh, whom HR took off the list, is no longer on it', OWNER,
  `select count(*)::int from public.employees where full_name = 'Shivdatt Singh'`, 0);
{
  const r = await asSystem(`select status::text || ' / ' || (deleted_at is not null) s from public.employees where full_name = 'Shivdatt Singh'`);
  r.rows[0]?.s === 'inactive / true' ? ok('but is marked removed, not erased') : bad('Shivdatt kept', JSON.stringify(r.rows));
}
await expectValue('"Banwari" is Banwari Verma', OWNER,
  `select e.employee_code from public.employees e where e.id = app.employee_by_name('  banwari ')`, 'DRIPL_1101');
await expectValue('"RAMKESH DAINI" is Ramkesh Saini', OWNER,
  `select e.full_name from public.employees e where e.id = app.employee_by_name('RAMKESH DAINI')`, 'Ramkesh Saini');
await expectValue('"KESHAV  AGARWAL" with two spaces is Keshav Agarwal', OWNER,
  `select e.employee_code from public.employees e where e.id = app.employee_by_name('KESHAV  AGARWAL')`, 'DRIPL_1099');
{
  const two = JSON.stringify([
    { employee: 'Banwari', date: '2026-08-20', priority: '', tasks: [
      { description: 'Attendance updated in Manual Register', status: 'Completed' },
      { description: 'Interview calling', status: 'In Progress' }] },
    { employee: 'Banwari Verma', date: '2026-08-20', priority: 'High', remarks: 'Second form', tasks: [
      { description: 'Interview calling', status: 'In Progress' },
      { description: 'UA number follow-up', status: 'Completed' }] },
  ]);
  const r = await as(OWNER, `select public.import_work_logs($1::jsonb) i`, [two]);
  const i = r.rows[0].i;
  Number(i.inserted) === 1 && Number(i.merged) === 1
    ? ok('a second form for the same person and day adds to that day\'s sheet')
    : bad('pms merge', JSON.stringify(i));
  await expectValue('without repeating a task, and at the higher priority', OWNER,
    `select w.task_count || ' / ' || w.priority || ' / ' || w.remarks from public.work_logs w
     where w.log_date = '2026-08-20' and w.employee_id = app.employee_by_name('Banwari Verma')`, '3 / high / Second form');
  const again = await as(OWNER, `select public.import_work_logs($1::jsonb) i`, [two]);
  Number(again.rows[0].i.inserted) === 0 && Number(again.rows[0].i.merged) === 0
    ? ok('importing the same forms again adds nothing')
    : bad('pms re-import', JSON.stringify(again.rows[0].i));
}
// Filing the Daily Work sheet marks you present.
{
  const ketan = `app.employee_by_name('Ketan Sharma')`;
  const att = (d) => `select coalesce((select status::text || ' / ' || source from public.attendance
    where employee_id = ${ketan} and att_date = ${d} and deleted_at is null), 'none')`;
  const task = `'[{"seq":1,"description":"Gate patrol","status":"completed"}]'::jsonb`;
  await expectOk('HR saves a draft for Ketan', OWNER,
    `select public.save_work_log(current_date - 2, ${task}, 'medium', null, false, ${ketan})`);
  await expectValue('a draft does not mark anyone present', OWNER, att('current_date - 2'), 'none');
  await expectOk('the sheet is submitted', OWNER,
    `select public.save_work_log(current_date - 2, ${task}, 'medium', null, true, ${ketan})`);
  await expectValue('submitting it marks him present, automatically', OWNER, att('current_date - 2'), 'present / daily_work');
  await expectValue('and the imported history marked every filed day too', OWNER,
    `select count(*)::int from public.work_logs w where w.status <> 'draft' and w.deleted_at is null
       and not exists (select 1 from public.attendance a where a.employee_id = w.employee_id and a.att_date = w.log_date)`, 0);
  await expectOk('HR marks a day absent by hand first', OWNER,
    `select public.save_attendance(jsonb_build_array(jsonb_build_object(
       'employee_id', (${ketan})::text, 'att_date', (current_date - 3)::text, 'status', 'absent')))`);
  await expectOk('then a sheet is filed for that day', OWNER,
    `select public.save_work_log(current_date - 3, ${task}, 'medium', null, true, ${ketan})`);
  await expectValue('HR\'s own mark wins', OWNER, att('current_date - 3'), 'absent / manual');
  await expectOk('HR changes an automatic mark to half day', OWNER,
    `select public.save_attendance(jsonb_build_array(jsonb_build_object(
       'employee_id', (${ketan})::text, 'att_date', (current_date - 2)::text, 'status', 'half_day')))`);
  await expectValue('which makes it HR\'s record', OWNER, att('current_date - 2'), 'half_day / manual');
  await expectOk('a sheet is filed and then taken back to draft', OWNER,
    `select public.save_work_log(current_date - 4, ${task}, 'medium', null, true, ${ketan})`);
  await expectOk('(reopened)', OWNER,
    `update public.work_logs set status = 'draft' where employee_id = ${ketan} and log_date = current_date - 4`);
  await expectValue('its automatic mark goes with it', OWNER, att('current_date - 4'), 'none');

  // A working day with no sheet and no mark is an absence.
  const banwari = `app.employee_by_name('Banwari Verma')`;
  await expectOk('Banwari files for one of the two working days only', OWNER,
    `select public.save_work_log(current_date - 2, ${task}, 'medium', null, true, ${banwari})`);
  await expectValue('the day he did not file counts as absent: 1 of 2 working days', OWNER,
    `select x->>'attendance' || '% ' || (x->>'attendance_source') from jsonb_array_elements(
       public.get_pms_scores(current_date - 3, current_date - 2)->'rows') x
     where (x->>'employee_id')::uuid = ${banwari}`, '50% register');
  await expectValue('HR marked Ketan absent one day and half day the other: 25%', OWNER,
    `select (x->>'attendance')::int from jsonb_array_elements(
       public.get_pms_scores(current_date - 3, current_date - 2)->'rows') x
     where (x->>'employee_id')::uuid = ${ketan}`, 25);
}

await expectValue('the Daily Review round is still the six departments that file one', OWNER,
  `select (public.get_daily_review('2026-08-20')->'totals'->>'departments')::int`, 6);
await expectValue('Tender, Land & Legal, Marketing and Security exist for HR, outside the round', OWNER,
  `select count(*)::int from public.departments
    where name in ('Tender', 'Land & Legal', 'Marketing & Social Media', 'Security') and status = 'active' and not in_daily_review`, 4);
await expectValue('and the counts on the sheet are computed, not trusted', OWNER,
  `select task_count || '-' || completed || '-' || in_progress from public.work_logs w
   join public.employees e on e.id = w.employee_id
   where w.log_date = '2026-01-05' and e.full_name = 'Technician One'`, '2-1-1');
await expectValue('the imported history shows in Work History like any other sheet', OWNER,
  `select (public.get_work_history($1, '2026-01-05', '2026-01-05')->'days'->0->>'score')::int`, 75, [TECH_EMP]);

console.log('\nHR employee master import');
{
  // Made-up people in the HR system's export format; real data never lives here.
  const rows = JSON.stringify([
    { code: 'DRIPL_1111', name: 'Ketan Sharma', email: 'Ketan.Test@Example.com', phone: '91-9000000001',
      department: 'Opreation & Maintenance', job_title: 'Security Officer', location: 'Head Office',
      legal_entity: 'Test Entity', joined: '2026-08-21', dob: '1990-01-02', gender: 'Male', status: 'Working' },
    { code: 'DRIPL_1101', name: 'Banwari Lal Test', department: 'HR', job_title: 'HR Generalist', status: 'Working' },
    { code: 'DRIPL_9001', name: 'test  technician', phone: '9000000002', department: 'Opretion and Maintenace',
      job_title: 'Technician Bassi', location: 'Budsu, Nagaur ', joined: '2026-03-25', status: 'Working' },
    { code: 'DRIPL_9002', name: 'Test Buyer', department: 'Procrument & Logiscitcs',
      job_title: 'Procrument & Logiscitcs Manager', location: 'Jerthi, Sikar Project', status: 'Working' },
    { code: 'DRIPL_9003', name: 'Test Leaver', department: 'Project', job_title: 'Site Engineer', exit_date: '2026-09-01' },
    { code: 'DRIPL_9004', name: 'Ketan Sharma', department: 'Project', job_title: 'Site Engineer' },
  ]);
  const preview = (await as(OWNER, `select public.import_employees($1::jsonb) r`, [rows])).rows[0].r;
  preview.added.length === 3 && preview.updated.length === 2 && preview.skipped.length === 1
    ? ok('the preview finds 3 new, 2 to fill in and 1 name clash')
    : bad('employee import preview', JSON.stringify(preview).slice(0, 400));
  await expectValue('and a preview writes nothing', OWNER,
    `select count(*)::int from public.employees where employee_code like 'DRIPL_900%'`, 0);
  await expectError('someone without HR rights cannot import', SALES,
    `select public.import_employees($1::jsonb, true)`, 'hr.employees', [rows]);
  await expectOk('HR imports the sheet', OWNER, `select public.import_employees($1::jsonb, true)`, [rows]);
  const emp = (code) => `select e.full_name || ' / ' || d.name || ' / ' || g.name || ' / ' || coalesce(e.work_location, '-')
      || ' / ' || coalesce(e.phone, '-') || ' / ' || e.status from public.employees e
      join public.departments d on d.id = e.department_id join public.designations g on g.id = e.designation_id
     where e.employee_code = '${code}'`;
  await expectValue('a new technician lands in O&M, the plant as location, title tidied', OWNER, emp('DRIPL_9001'),
    'Test Technician / O&M / Service / Technician / Budsu, Nagaur / +91 9000000002 / active');
  await expectValue("the sheet's misspellings are corrected", OWNER, emp('DRIPL_9002'),
    'Test Buyer / Procurement & Stores / Procurement & Logistics Manager / Jerthi, Sikar / - / active');
  await expectValue('someone with an exit date comes in inactive', OWNER,
    `select status::text from public.employees where employee_code = 'DRIPL_9003'`, 'inactive');
  await expectValue('an existing employee only has blanks filled; the PMS department stays', OWNER, emp('DRIPL_1111'),
    'Ketan Sharma / Security / Security Officer / Head Office / +91 9000000001 / active');
  await expectValue('with the e-mail tidied and the private data behind its own permission', OWNER,
    `select e.email::text || ' / ' || p.date_of_birth || ' / ' || p.gender from public.employees e
       join public.employee_private p on p.employee_id = e.id where e.employee_code = 'DRIPL_1111'`,
    'ketan.test@example.com / 1990-01-02 / Male');
  await expectValue('a different spelling of a name becomes an alias', OWNER,
    `select app.employee_by_name('Banwari Lal Test') = (select id from public.employees where employee_code = 'DRIPL_1101')`, true);
  {
    const again = (await as(OWNER, `select public.import_employees($1::jsonb) r`, [rows])).rows[0].r;
    again.added.length === 0 && again.updated.length === 0
      && again.differences.some((d) => d.code === 'DRIPL_1101' && d.field === 'Designation' && d.sheet === 'HR Generalist')
      ? ok('importing the same sheet again changes nothing, and shows where the sheet differs')
      : bad('employee re-import', JSON.stringify(again).slice(0, 400));
  }
}

console.log('\nDocuments in every section');
{
  const addDoc = (module, name, extra = '') => `insert into public.documents
      (module_key, entity_type, entity_id, category, file_name, storage_path${extra ? ', valid_until' : ''})
    values ('${module}', 'section', null, 'Site report', '${name}', '${module}/section/' || gen_random_uuid() || '-${name}'${extra ? `, ${extra}` : ''})`;
  await expectOk('a technician with only VIEW adds a work document to the Team Performance section', TECH,
    addDoc('om.performance', 'inverter-fault-photos.pdf'));
  await expectError('but not to a section they cannot open', TECH,
    addDoc('crm.tenders', 'not-mine.pdf'), 'row-level security');
  await expectError('programs and scripts are refused', TECH,
    addDoc('om.performance', 'tool.exe'), 'row-level security');
  await expectError('a section document belongs to no record', TECH,
    `insert into public.documents (module_key, entity_type, entity_id, file_name, storage_path)
     values ('om.performance', 'section', gen_random_uuid(), 'x.pdf', 'om.performance/section/x.pdf')`, 'documents_entity_check');
  await expectOk('storage takes the file in the section folder', TECH,
    `insert into storage.objects (bucket_id, name, owner_id) values ('documents', 'om.performance/section/a-photo.jpg', $1)`, [TECH]);
  await expectError('and refuses another section\'s folder', TECH,
    `insert into storage.objects (bucket_id, name, owner_id) values ('documents', 'crm.tenders/section/a.pdf', $1)`, 'row-level security', [TECH]);
  await expectOk('the same with an expiry date, for a certificate', TECH,
    addDoc('om.performance', 'insurance-certificate.pdf', 'current_date + 10'));

  const mine = (await as(TECH, `select public.list_documents('om.performance', 'section') r`)).rows[0].r;
  const photo = mine.rows.find((d) => d.file_name === 'inverter-fault-photos.pdf');
  const cert = mine.rows.find((d) => d.file_name === 'insurance-certificate.pdf');
  mine.total === 2 && photo?.mine && photo.can_delete && photo.uploaded_by === 'Technician One' && cert?.expiry === 'expiring'
    ? ok('the library lists them with the uploader, what they may do, and what is expiring')
    : bad('section document list', JSON.stringify(mine).slice(0, 400));
  await expectValue('the expiring filter finds the certificate only', TECH,
    `select (public.list_documents(null, 'all', null, null, false, true)->>'total')::int`, 1);
  await expectValue('filtering by menu category: both are under O&M', TECH,
    `select (public.list_documents(null, 'all', null, null, false, false, 50, 0, 'operations')->>'total')::int`, 2);
  await expectValue('and none under CRM & Tenders', TECH,
    `select (public.list_documents(null, 'all', null, null, false, false, 50, 0, 'crm')->>'total')::int`, 0);
  await expectValue('each document says which category it belongs to', TECH,
    `select public.list_documents('om.performance')->'rows'->0->>'group_label'`, 'O&M');
  await expectValue('someone who cannot open the section does not see them', SALES,
    `select (public.list_documents('om.performance')->>'total')::int`, 0);
  await expectValue('every role may open the Documents page', SALES,
    `select public.get_my_access()->'permissions' ? 'documents'`, true);
  await expectOk('the uploader deletes their own document', TECH,
    `delete from public.documents where file_name = 'inverter-fault-photos.pdf'`);
  await expectValue('and it is gone', OWNER,
    `select count(*)::int from public.documents where file_name = 'inverter-fault-photos.pdf'`, 0);
}

console.log('\nPMS replacement: employee logins and the work history calendar');
{
  const ketanId = (await asSystem(`select app.employee_by_name('Ketan Sharma') id`)).rows[0].id;
  const banwariId = (await asSystem(`select app.employee_by_name('Banwari Verma') id`)).rows[0].id;
  const EMPL = await createAuthUser('ketan.login@diwakarsolar.test', 'Ketan Sharma');
  await expectOk('HR gives Ketan, already on the employee list, a login with the Employee role', OWNER,
    `select public.admin_save_user($1, $2, true)`,
    [EMPL, JSON.stringify({ full_name: 'Ketan Sharma', employee_id: ketanId, role_ids: [role.employee] })]);
  await signIn(EMPL);
  await expectValue('the login is linked to his existing record, not a new one', OWNER,
    `select (select employee_id from public.profiles where id = $1) = $2
        and (select count(*) from public.employees where full_name = 'Ketan Sharma' and deleted_at is null) = 1`,
    true, [EMPL, ketanId]);
  const SECOND = await createAuthUser('ketan.again@diwakarsolar.test', 'Ketan Again');
  await expectError('a second login for the same employee is refused', OWNER,
    `select public.admin_save_user($1, $2, true)`, 'already has a login',
    [SECOND, JSON.stringify({ full_name: 'Ketan Again', employee_id: ketanId, role_ids: [role.employee] })]);
  {
    const list = (await as(OWNER, `select public.employee_logins() r`)).rows[0].r;
    const k = list.find((x) => x.employee_id === ketanId);
    const b = list.find((x) => x.employee_id === banwariId);
    k?.login_email === 'ketan.login@diwakarsolar.test' && k.roles.includes('Employee') && b && !b.user_id
      ? ok('the login list shows who has a login and who is still to be invited')
      : bad('employee_logins', JSON.stringify({ k, b }));
  }
  await expectError('someone without user management cannot read it', EMPL, `select public.employee_logins()`, 'admin.users');
  await expectValue('an Employee sees only their own work and its history, score, attendance, leave, the dashboard and documents', EMPL,
    `select string_agg(k, ',' order by k) from jsonb_object_keys(public.get_my_access()->'permissions') k`,
    'approvals,dashboard,documents,hr.attendance,hr.history,hr.leave,hr.scorecard,hr.worklog');

  const task = `'[{"seq":1,"description":"Gate register checked","status":"completed"},{"seq":2,"description":"Patrol round","status":"in_progress"}]'::jsonb`;
  await expectOk('Ketan files and submits today\'s sheet himself', EMPL,
    `select public.save_work_log(current_date, ${task}, 'medium', 'All quiet', true)`);
  // For now employees may catch up on the last 8 days (setting worklog_backfill_days).
  await expectOk('for now he may also fill a sheet from 8 days ago', EMPL,
    `select public.save_work_log(current_date - 8, ${task}, 'low', 'Caught up', true)`);
  await expectError('but not 9 days back', EMPL,
    `select public.save_work_log(current_date - 9, ${task}, 'low', null, false)`, 'last 8 days');
  await asSystem(`update public.app_settings set value = to_jsonb(0) where key = 'worklog_backfill_days'`);
  await expectError('with the setting at 0 it is today only again: not yesterday\'s', EMPL,
    `select public.save_work_log(current_date - 1, ${task}, 'low', null, false)`, 'sheet only');
  await asSystem(`update public.app_settings set value = to_jsonb(8) where key = 'worklog_backfill_days'`);
  await expectOk('HR keeps a draft of his yesterday for him', OWNER,
    `select public.save_work_log(current_date - 1, ${task}, 'low', null, false, $1)`, [ketanId]);
  await expectError('nor a colleague\'s sheet', EMPL,
    `select public.save_work_log(current_date, ${task}, 'low', null, false, $1)`, 'may not file', [banwariId]);
  await expectOk('HR can still fill in an older day for him', OWNER,
    `select public.save_work_log(current_date - 6, ${task}, 'low', 'Filled in by HR', true, $1)`, [ketanId]);

  const mine = (await as(EMPL, `select public.get_work_history(null, current_date - 6, current_date) r`)).rows[0].r;
  const day = (d) => mine.days.find((x) => x.date === d);
  const today = (await asSystem(`select current_date::text d, (current_date - 1)::text y, (current_date - 6)::text o`)).rows[0];
  day(today.d)?.state === 'submitted' && day(today.d).tasks.length === 2 && Number(day(today.d).score) === 75
    && day(today.y)?.state === 'draft' && day(today.o)?.state === 'submitted' && mine.days.length === 7
    && mine.employee.name === 'Ketan Sharma'
    ? ok('his calendar shows each day: submitted with its tasks and score, the draft, the day HR filled in')
    : bad('work history', JSON.stringify(mine).slice(0, 500));
  Number(mine.summary.submitted) >= 2 && Number(mine.summary.tasks) >= 4 && 'missed' in mine.summary
    ? ok('with a summary of days filed, missed, tasks and score')
    : bad('work history summary', JSON.stringify(mine.summary));
  await expectError('he cannot open a colleague\'s calendar', EMPL,
    `select public.get_work_history($1, current_date - 6, current_date)`, 'may not see', [banwariId]);
  await expectValue('HR opens anyone\'s', OWNER,
    `select jsonb_array_length(public.get_work_history($1, current_date - 6, current_date)->'days')`, 7, [banwariId]);
  await expectValue('"All time" starts at his first sheet or joining date, not in the year 2000', EMPL,
    `select (h->>'from')::date = (select least(e.joining_date, min(l.log_date)) from public.employees e
                                  left join public.work_logs l on l.employee_id = e.id and l.deleted_at is null
                                  where e.id = $1 group by e.joining_date)
            and jsonb_array_length(h->'days') = current_date - (h->>'from')::date + 1
     from (select public.get_work_history(null, '2000-01-01', current_date) h) x`, true, [ketanId]);
}

console.log('\nNo duplicate employees, and technicians on their own plant');
{
  const again = (await as(OWNER, `select public.import_employees($1::jsonb) r`,
    [JSON.stringify([{ code: 'DS-1001', name: 'Shivdatt Singh', department: 'Opreation & Maintenance', job_title: 'Site Engineer' }])])).rows[0].r;
  again.added.length === 0 && again.skipped.some((s) => /Removed/.test(s.reason))
    ? ok('the HR sheet does not bring back someone removed from the list')
    : bad('import of a removed employee', JSON.stringify(again).slice(0, 300));

  await asSystem(`insert into public.employees (employee_code, full_name, email, work_location)
                  values ('DRIPL_9010', 'Test Linker', 'linker@example.test', 'Budsu, Nagaur')`);
  const LINKER = await createAuthUser('linker@example.test', 'Test Linker');
  await expectOk('User Management creates a login with an email already on the employee list', OWNER,
    `select public.admin_save_user($1, $2, true)`, [LINKER, JSON.stringify({ full_name: 'Test Linker', role_ids: [role.technician] })]);
  await expectValue('the login is linked to that employee; no second record is made', OWNER,
    `select (select e.employee_code from public.profiles p join public.employees e on e.id = p.employee_id where p.id = $1)
            || ' / ' || (select count(*) from public.employees where full_name = 'Test Linker')`, 'DRIPL_9010 / 1', [LINKER]);
  const list = (await as(OWNER, `select public.employee_logins() r`)).rows[0].r;
  const t = list.find((x) => x.employee_code === 'DRIPL_9010');
  t?.site === 'Budsu' && t.site_id && t.work_location === 'Budsu, Nagaur'
    ? ok('a work location like "Budsu, Nagaur" names the plant the login should cover')
    : bad('plant from work location', JSON.stringify(t));
}

console.log('\nDepartment Review Coordinator');
{
  const COORD = await createAuthUser('coordinator@diwakarsolar.test', 'Review Coordinator');
  await expectOk('a coordinator login is created', OWNER, `select public.admin_save_user($1, $2, true)`,
    [COORD, JSON.stringify({ full_name: 'Review Coordinator', role_ids: [role.review_coordinator, role.employee] })]);
  await signIn(COORD);
  const depts = (await asSystem(`select id, name from public.departments where in_daily_review and status = 'active' order by name limit 2`)).rows;
  for (const d of depts) {
    await expectOk(`the coordinator files ${d.name}'s report of the day`, COORD,
      `select public.save_daily_report(jsonb_build_object('report_date', (current_date + 0)::text, 'department_id', $1::text,
         'health', 'on_track', 'work_completed', 'Filed by the coordinator', 'status', 'submitted'), '[]'::jsonb)`, [d.id]);
  }
  await expectOk('and writes the CCM remark for all departments at once', COORD,
    `select public.save_review_remark(current_date, 'Keep the dispatch on schedule', null, 'ccm_remark')`);
  await expectValue('the Review Summary shows those reports to the coordinator', COORD,
    `select (public.get_daily_review(current_date)->'totals'->>'reported')::int >= 2`, true);
  await expectValue('but marking a report reviewed stays with management', COORD,
    `select public.has_permission('daily.review', 'approve')`, false);
}

console.log('\nDepartment Review: the legacy workbook');
{
  const COORD = (await asSystem("select id from auth.users where email = 'coordinator@diwakarsolar.test'")).rows[0].id;
  const d = (n) => `(current_date - ${n})::text`;
  const day = (await asSystem(`select ${d(40)} a, ${d(0)} t`)).rows[0];
  const rows = JSON.stringify([
    { date: day.a, department: 'Admin', reporter: 'Keshav Agarwal', status: 'On track',
      metrics: [{ label: 'Office housekeeping', value: 'Completed' }, { label: 'Admin issues', value: 'None' }],
      updates: 'Routine admin completed.', ccm: 'Keep the register current', founder: 'Good work' },
    { date: day.a, department: 'HR', reporter: 'Banwari Verma', status: ' CCM Remarks', updates: 'Payroll done' },
    { date: day.t, department: 'Admin', updates: 'Already filed today', founder: 'Founder note for today' },
    { date: day.a, department: 'Sales & Marketing', updates: 'Not a department here' },
    { date: 'not a date', department: 'Admin' },
  ]);
  const preview = (await as(COORD, `select public.import_review_excel($1::jsonb) r`, [rows])).rows[0].r;
  preview.added.length === 2 && preview.filled.length === 1 && preview.unknown_departments[0] === 'Sales & Marketing' && preview.unreadable === 1
    ? ok('the preview finds 2 new department-days, 1 to fill in, an unknown department and an unreadable row')
    : bad('review import preview', JSON.stringify(preview).slice(0, 400));
  await expectValue('and a preview writes nothing', OWNER,
    `select count(*)::int from public.daily_reports where report_date = current_date - 40`, 0);
  await expectOk('the coordinator imports the sheet', COORD, `select public.import_review_excel($1::jsonb, true)`, [rows]);
  await expectValue('a new department-day becomes a submitted report with its updates as numbers', OWNER,
    `select r.status::text || ' / ' || r.health::text || ' / ' || r.reporter_name || ' / ' ||
            (select string_agg(i.label || '=' || i.value, ', ' order by i.sort_order) from public.daily_report_items i where i.report_id = r.id)
     from public.daily_reports r join public.departments dd on dd.id = r.department_id
     where dd.name = 'Admin' and r.report_date = current_date - 40`,
    'submitted / on_track / Keshav Agarwal / Office housekeeping=Completed, Admin issues=None');
  await expectValue('"CCM Remarks" as a status does not mark the department unwell', OWNER,
    `select r.health::text from public.daily_reports r join public.departments dd on dd.id = r.department_id
     where dd.name = 'HR' and r.report_date = current_date - 40`, 'on_track');
  await expectValue('CCM remarks are signed CCM, Founder remarks by Sunil Bansal', OWNER,
    `select string_agg(a.action || ':' || a.reviewer_name, ', ' order by a.action) from public.review_actions a
     join public.daily_reports r on r.id = a.report_id join public.departments dd on dd.id = r.department_id
     where dd.name = 'Admin' and r.report_date = current_date - 40`, 'ccm_remark:CCM, founder_remark:Sunil Bansal');
  await expectValue('a report already filed keeps what was typed and only gains the new remark', OWNER,
    `select r.work_completed || ' / ' || (select count(*) from public.review_actions a where a.report_id = r.id and a.action = 'founder_remark')
     from public.daily_reports r join public.departments dd on dd.id = r.department_id
     where dd.name = 'Admin' and r.report_date = current_date`, 'Filed by the coordinator / 1');
  const again = (await as(COORD, `select public.import_review_excel($1::jsonb) r`, [rows])).rows[0].r;
  again.added.length === 0 && again.filled.length === 0 && again.unchanged === 3
    ? ok('importing the same sheet again changes nothing')
    : bad('review re-import', JSON.stringify(again).slice(0, 300));
  await expectError('someone who cannot file reports cannot import', TECH,
    `select public.import_review_excel('[]'::jsonb)`, 'daily.reports');
}

console.log('\nSuper Technician');
{
  const SUPER = await createAuthUser('super.tech@diwakarsolar.test', 'Super Technician');
  await expectOk('a Super Technician login is created with no plants ticked', OWNER, `select public.admin_save_user($1, $2, true)`,
    [SUPER, JSON.stringify({ full_name: 'Super Technician', role_ids: [role.super_technician], site_ids: [] })]);
  await signIn(SUPER);
  await expectValue('the role opens every plant', SUPER,
    `select cardinality(app.my_site_ids()) = (select count(*) from public.sites)`, true);
  await expectOk('and fills the site form of any plant', SUPER,
    `select public.save_field_entry($1, current_date - 20, '[{"label":"INV-01","kwh":100}]'::jsonb)`, [site.Bassi]);
  await expectError('a plain technician still cannot', TECH,
    `select public.save_field_entry($1, current_date - 20, '[{"label":"INV-01","kwh":100}]'::jsonb)`, 'not assigned to this site', [site.Bassi]);
}

console.log('\nApprovals');
{
  const ASKER = (await asSystem("select id from auth.users where email = 'ketan.login@diwakarsolar.test'")).rows[0].id;   // Employee role
  const OTHER = (await asSystem("select id from auth.users where email = 'coordinator@diwakarsolar.test'")).rows[0].id;  // not an approver
  const banwariEmp = (await asSystem("select id from public.employees where employee_code = 'DRIPL_1101'")).rows[0].id;
  const rajpalEmp = (await asSystem('select employee_id id from public.approval_approvers where employee_id <> $1 order by sort_order limit 1', [banwariEmp])).rows[0].id; // another approver
  const HEAD = await createAuthUser('banwari.head@diwakarsolar.test', 'Banwari Verma');
  await expectOk('the HR head gets a login', OWNER, `select public.admin_save_user($1, $2, true)`,
    [HEAD, JSON.stringify({ full_name: 'Banwari Verma', employee_id: banwariEmp, role_ids: [role.employee] })]);
  await signIn(HEAD);

  await expectValue('everyone on the approver list can be chosen', ASKER,
    `select jsonb_array_length(public.list_approvers()->'approvers')`,
    (await asSystem('select count(*)::int n from public.approval_approvers')).rows[0].n);
  await expectValue('an approver filters by their own name only', HEAD,
    `select (public.list_approvers()->>'all')::boolean = false and public.list_approvers()->>'me' = $1::text`, true, [banwariEmp]);
  await expectValue('a Super Admin filters by anyone', OWNER, `select (public.list_approvers()->>'all')::boolean`, true);

  await expectError('a request must say who it goes to', ASKER,
    `select public.save_approval_request($1::jsonb)`, 'Choose who', [JSON.stringify({ category: 'purchase', title: 'No approver chosen' })]);
  await expectError('and an approver cannot send one to themselves', HEAD,
    `select public.save_approval_request($1::jsonb)`, 'cannot approve your own',
    [JSON.stringify({ category: 'travel', title: 'Visit to Sadas', approver_id: banwariEmp })]);

  const req = JSON.stringify({ category: 'purchase', title: 'Two padlocks for the store', details: 'Old ones are rusted', amount: 850, priority: 'urgent', approver_id: banwariEmp });
  const id = (await as(ASKER, `select public.save_approval_request($1::jsonb) id`, [req])).rows[0].id;
  id ? ok('an employee sends a purchase request to the HR head') : bad('raise request', 'no id');
  await expectValue('it gets a number, waits, and says who it went to', ASKER,
    `select (r->>'request_no') like 'APR-%' and r->>'status' = 'pending' and r->>'approver' = 'Banwari Verma'
     from jsonb_array_elements(public.list_approvals('mine')->'rows') r where r->>'id' = $1`, true, [id]);
  await expectValue('the head sees it waiting for him', HEAD,
    `select (public.list_approvals('to_approve')->>'waiting')::int = 1
        and exists (select 1 from jsonb_array_elements(public.list_approvals('to_approve')->'rows') r where r->>'id' = $1 and (r->>'can_decide')::boolean)`, true, [id]);
  await expectValue('a colleague does not see it', OTHER,
    `select count(*)::int from jsonb_array_elements(public.list_approvals('all')->'rows') r where r->>'id' = $1`, 0, [id]);
  await expectError('nor can a colleague decide it', OTHER, `select public.decide_approval($1, 'approved')`, 'only the approver', [id]);
  await expectError('nor can the employee approve their own', ASKER, `select public.decide_approval($1, 'approved')`, 'only the approver', [id]);
  await expectValue("the head cannot look at another approver's requests by changing the filter", HEAD,
    `select count(*)::int from jsonb_array_elements(public.list_approvals('all', null, null, 100, $1)->'rows') r where r->>'id' = $2`, 1, [rajpalEmp, id]);
  await expectValue('the Super Admin sees it too, and can filter by the head', OWNER,
    `select exists (select 1 from jsonb_array_elements(public.list_approvals('all', null, null, 100, $1)->'rows') r where r->>'id' = $2)`, true, [banwariEmp, id]);
  await expectError('sending it back needs a reason', HEAD, `select public.decide_approval($1, 'needs_info')`, 'Say why', [id]);
  await expectOk('the head asks for the quotation', HEAD,
    `select public.decide_approval($1, 'needs_info', 'Attach the shop quotation')`, [id]);
  await expectValue('the employee sees what is asked', ASKER,
    `select r->>'status' || ' / ' || (r->>'decision_note') from jsonb_array_elements(public.list_approvals('mine')->'rows') r where r->>'id' = $1`,
    'needs_info / Attach the shop quotation', [id]);
  await expectOk('the employee attaches the quotation to their request', ASKER,
    `insert into public.documents (module_key, entity_type, entity_id, category, file_name, storage_path)
     values ('approvals', 'approval', $1::uuid, 'Quotation', 'quotation.pdf', 'approvals/' || $1::text || '/quotation.pdf')`, [id]);
  await expectRows('which the head it was sent to can see', HEAD, `select 1 from public.documents where entity_type = 'approval'`, 1);
  await expectRows('and a colleague cannot', OTHER, `select 1 from public.documents where entity_type = 'approval'`, 0);
  await expectError('nor attach to', OTHER,
    `insert into public.documents (module_key, entity_type, entity_id, file_name, storage_path)
     values ('approvals', 'approval', $1::uuid, 'x.pdf', 'approvals/' || $1::text || '/x.pdf')`, 'row-level security', [id]);
  await expectOk('and resubmits', ASKER, `select public.save_approval_request($1::jsonb, $2)`,
    [JSON.stringify({ category: 'purchase', title: 'Two padlocks for the store', amount: 850, note: 'Quotation attached', approver_id: banwariEmp }), id]);
  await expectOk('the head approves', HEAD, `select public.decide_approval($1, 'approved', 'Buy from the usual shop')`, [id]);
  await expectValue('the employee sees it approved by the head, with the whole history', ASKER,
    `select r->>'status' || ' / ' || (r->>'decided_by') || ' / ' || (select string_agg(e->>'action', ',') from jsonb_array_elements(r->'events') e)
     from jsonb_array_elements(public.list_approvals('mine')->'rows') r where r->>'id' = $1`,
    'approved / Banwari Verma / submitted,needs_info,resubmitted,approved', [id]);
  await expectError('a decided request can no longer be changed', ASKER,
    `select public.save_approval_request($1::jsonb, $2)`, 'no longer be changed', [JSON.stringify({ title: 'Changed', approver_id: banwariEmp }), id]);
  const id2 = (await as(ASKER, `select public.save_approval_request($1::jsonb) id`,
    [JSON.stringify({ category: 'advance', title: 'Travel advance for Jaipur visit', amount: 3000, approver_id: rajpalEmp })])).rows[0].id;
  await expectValue("a request sent to another head is not the HR head's to see", HEAD,
    `select count(*)::int from jsonb_array_elements(public.list_approvals('all')->'rows') r where r->>'id' = $1`, 0, [id2]);
  await expectOk('the employee withdraws a request they no longer need', ASKER, `select public.cancel_approval($1)`, [id2]);
  await expectValue('it shows as cancelled', ASKER,
    `select r->>'status' from jsonb_array_elements(public.list_approvals('mine')->'rows') r where r->>'id' = $1`, 'cancelled', [id2]);
}

console.log('\nDeactivation');
await expectOk('Admin deactivates Technician', ADMIN, `select public.admin_set_user_status($1, 'inactive')`, [TECH]);
await expectValue('deactivated user loses every permission immediately', TECH, `select public.has_permission('dashboard','view')`, false);
await expectRows('deactivated user sees no sites', TECH, `select 1 from public.sites`, 0);
await expectRows('deactivated user sees no tickets', TECH, `select 1 from public.test_tickets`, 0);
await expectValue('get_my_access returns no permissions', TECH, `select public.get_my_access()->'permissions'`, {});
await expectError('Admin cannot deactivate himself', ADMIN, `select public.admin_set_user_status(auth.uid(), 'inactive')`, 'own account status');

console.log('\nAudit log');
await expectError('authenticated users cannot insert audit rows', ADMIN, `insert into public.audit_logs (action) values ('fake')`, 'permission denied');
await expectError('audit rows cannot be deleted', OWNER, `delete from public.audit_logs`, 'permission denied');
await expectError('client log_event rejects arbitrary actions', ADMIN, `select public.log_event('user.create')`, 'not allowed');
await expectOk('logout event can be logged', RAHUL, `select public.log_event('logout', 'auth', 'Signed out')`);
await expectError('export event requires EXPORT permission', RAHUL, `select public.log_event('export', 'admin.audit', 'x')`, 'not permitted');
{
  const r = await asSystem(`select distinct action from public.audit_logs order by 1`);
  const actions = r.rows.map((x) => x.action);
  const need = ['login', 'logout', 'user.create', 'role.assign', 'site.assign', 'permission.change', 'user.deactivate', 'create', 'update', 'delete'];
  const missing = need.filter((a) => !actions.includes(a));
  missing.length === 0 ? ok(`audit covers: ${need.join(', ')}`) : bad('audit coverage', `missing ${missing.join(', ')}`);
}
await expectValue('Admin can read audit log', ADMIN, `select count(*) > 10 from public.audit_logs`, true);

console.log('\nStorage (avatars)');
await expectOk('user uploads own avatar', RAHUL, `insert into storage.objects (bucket_id, name) values ('avatars', $1 || '/photo.png')`, [RAHUL]);
await expectError('user cannot upload into another user folder', RAHUL, `insert into storage.objects (bucket_id, name) values ('avatars', $1 || '/photo.png')`, 'row-level security', [ADMIN]);

console.log('\nTender analysis privacy');
await asSystem(`insert into public.tender_analysis_jobs(created_by, files) values ($1, '[]')`, [OWNER]);
await expectRows('creator can read saved analysis jobs', OWNER, `select id from public.tender_analysis_jobs`, 1);
await expectRows('another admin cannot read private analysis jobs', ADMIN, `select id from public.tender_analysis_jobs`, 0);
await expectError('client cannot forge a completed analysis job', OWNER, `insert into public.tender_analysis_jobs(created_by, files, status) values (auth.uid(), '[]', 'completed')`, 'permission denied');
await expectError('client cannot overwrite an analysis result', OWNER, `update public.tender_analysis_jobs set result = '{}'`, 'permission denied');
await expectError('client cannot save an analysis step result', OWNER, `select public.tender_analysis_save_part((select id from public.tender_analysis_jobs limit 1), 'synopsis', '{}')`, 'permission denied');
await expectOk('tender user uploads to own analysis folder', OWNER, `insert into storage.objects(bucket_id, name) values ('tender-analysis', $1 || '/source.pdf')`, [OWNER]);
await expectError('tender user cannot upload to another folder', OWNER, `insert into storage.objects(bucket_id, name) values ('tender-analysis', $1 || '/source.pdf')`, 'row-level security', [ADMIN]);
await expectRows('another user cannot read the analysis source', ADMIN, `select id from storage.objects where bucket_id = 'tender-analysis'`, 0);
await expectError('inactive user cannot upload analysis PDFs', TECH, `insert into storage.objects(bucket_id, name) values ('tender-analysis', $1 || '/source.pdf')`, 'row-level security', [TECH]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
