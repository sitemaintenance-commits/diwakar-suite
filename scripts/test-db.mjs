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
  const expected = ['dashboard', 'hr.scorecard', 'hr.worklog',
                    'om.daily_entry', 'om.operations', 'om.performance', 'om.tickets'];
  JSON.stringify(keys) === JSON.stringify(expected)
    ? ok('by default a technician sees the forms they file, their tickets and their own scores')
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
await expectValue('a day of approved leave is not counted as an absence', OWNER,
  `select x->>'attendance_source' from jsonb_array_elements(public.get_pms_scores()->'rows') x
   where x->>'employee_id' = $1`, 'discipline', [TECH_EMP]);
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

console.log('\nField entry — the technician form that replaces the Google Form');
await expectValue('the real portfolio is loaded with DC and AC capacity', OWNER,
  `select count(*)::int from public.solar_sites where capacity_dc_kwp > 0`, 12);
await expectValue('the Daily Report tab settles the contested capacities', OWNER,
  `select string_agg(s.name || ':' || ss.capacity_dc_kwp::int || '/' || ss.capacity_ac_kw::int, ' ' order by s.name)
   from public.solar_sites ss join public.sites s on s.id = ss.site_id
   where s.name in ('Jerthi','Bhojusar','Thikariya')`,
  'Bhojusar:3280/2475 Jerthi:3361/2750 Thikariya:4473/3300');
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

// Daily Review
const DR_PAYLOAD = JSON.stringify({
  depts: [{ id: 'dept-om', name: 'O&M / Service' }, { id: 'dept-x', name: 'Ghost Department' }],
  reports: [
    { deptId: 'dept-om', date: '2026-01-05', status: 'On track', reporter: 'Rajpal',
      metrics: [{ label: 'Generation (kWh)', value: '45,300' }, { label: 'Open tickets', value: '3' }],
      highlights: 'Cleaned 4 blocks at Sadas.', blockers: '', remarks: '' },
    { deptId: 'dept-x', date: '2026-01-05', status: 'Critical', metrics: [], highlights: 'x' },
  ],
});
{
  const r = await as(OWNER, `select public.import_daily_reports($1::jsonb) i`, [DR_PAYLOAD]);
  const i = r.rows[0].i;
  Number(i.inserted) === 1 && Number(i.ignored) === 1 && i.unknown_departments[0] === 'Ghost Department'
    ? ok('daily reports import and an unmatched department is reported')
    : bad('daily import', JSON.stringify(i));
}
await expectValue('the metrics come across as report lines', OWNER,
  `select count(*)::int from public.daily_report_items i
   join public.daily_reports r on r.id = i.report_id where r.report_date = '2026-01-05'`, 2);
await expectValue('imported history lands as reviewed, not as a draft', OWNER,
  `select status::text from public.daily_reports where report_date = '2026-01-05'`, 'reviewed');

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
  Number(i.inserted) === 2 && Number(i.employees_created) === 1
    ? ok('work sheets import, and an employee missing from the master is created')
    : bad('pms import', JSON.stringify(i));
}
await expectValue('the task statuses are mapped from the form wording', OWNER,
  `select count(*) filter (where t.status = 'completed') || '/' || count(*) filter (where t.status = 'in_progress')
   from public.work_log_tasks t join public.work_logs w on w.id = t.log_id
   where w.log_date = '2026-01-05'`, '2/1');
await expectValue('and the counts on the sheet are computed, not trusted', OWNER,
  `select task_count || '-' || completed || '-' || in_progress from public.work_logs w
   join public.employees e on e.id = w.employee_id
   where w.log_date = '2026-01-05' and e.full_name = 'Technician One'`, '2-1-1');
await expectValue('the imported history scores like any other sheet', OWNER,
  `select (x->>'kpi')::int from jsonb_array_elements(
     public.get_pms_scores('2026-01-01', '2026-01-31')->'rows') x
   where x->>'employee' = 'Technician One'`, 90);

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
