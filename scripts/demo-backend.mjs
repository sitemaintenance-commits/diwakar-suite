// LOCAL DEMO BACKEND — for previewing the app without a Supabase project.
//
//   npm run demo:api     (this server, http://localhost:54399)
//   npm run dev:demo     (the app, http://localhost:5173)
//
// It runs the REAL migrations in an in-memory Postgres (PGlite) and serves a
// small subset of the Supabase HTTP API (auth token, PostgREST reads/writes,
// RPCs and the admin-users function). Every query runs AS the signed-in user,
// so RLS and permissions behave exactly as in production. Data resets when
// the server restarts. Never deploy this.
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const PORT = 54399;
const PASSWORD = 'demo1234';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const db = await PGlite.create({ extensions: { citext, pg_trgm } });
await db.exec(readFileSync(join(root, 'scripts', 'supabase-emulation.sql'), 'utf8'));
const mig = join(root, 'supabase', 'migrations');
for (const f of readdirSync(mig).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(mig, f), 'utf8'));

// ---------------------------------------------------------------- helpers
async function asUser(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid ?? '', role: 'authenticated' })]);
    await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function mkUser(email, name, meta = {}) {
  return (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify({ full_name: name, ...meta })])).id;
}
const signIn = (id) => db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [id]);

// ---------------------------------------------------------------- demo data
const OWNER = await mkUser('owner@diwakarsolar.com', 'Diwakar Owner');
await db.query(`select app.bootstrap_super_admin('owner@diwakarsolar.com')`);
await signIn(OWNER);
// Site capacities, districts and tilts come from the migration (the real portfolio).
await db.query(`insert into public.designations (name) values ('Site Engineer'), ('O&M Technician'), ('Sales Manager'), ('HR Executive')`);

const PEOPLE = [
  ['admin@diwakarsolar.com', 'Anita Sharma', 'admin', [], true, 'ADMIN'],
  ['rahul@diwakarsolar.com', 'Rahul Meena', 'om_manager', ['Sadas', 'Thikariya', 'Bassi'], false, 'OM'],
  ['tech@diwakarsolar.com', 'Suresh Kumar', 'technician', ['Sadas'], false, 'OM'],
  ['sales@diwakarsolar.com', 'Priya Verma', 'sales_executive', [], false, null],
  ['hr@diwakarsolar.com', 'Banwari Verma', 'hr_admin', [], false, 'HR'],
];
for (const [email, name, role, sites, all, dept] of PEOPLE) {
  const id = await mkUser(email, name);
  const rid = (await one(`select id from public.roles where key = $1`, [role])).id;
  const sids = [];
  for (const s of sites) sids.push((await one(`select id from public.sites where name = $1`, [s])).id);
  const did = dept ? (await one(`select id from public.departments where code = $1`, [dept])).id : '';
  await asUser(OWNER, async (tx) => {
    await tx.query(`select public.admin_save_user($1, $2, true)`, [id, JSON.stringify({ full_name: name, department_id: did })]);
    await tx.query(`select public.set_user_roles($1, array[$2::uuid])`, [id, rid]);
    await tx.query(`select public.set_user_sites($1, $2::uuid[], $3)`, [id, sids, all]);
  });
  if (role !== 'sales_executive') await signIn(id);
}
await mkUser('newjoiner@diwakarsolar.com', 'New Joiner');

// ---------------------------------------------------------------- demo CRM data
const SALES_ID = (await one(`select id from public.profiles where email = 'sales@diwakarsolar.com'`)).id;
const inDays = (n) => `now() + interval '${n} days'`;
await asUser(OWNER, async (tx) => {
  await tx.query(`insert into public.tenders
    (title, reference_no, authority, portal, tender_type, work_type, district, state, capacity_kwp,
     estimated_value, tender_fee, emd_amount, emd_mode, emd_status, emd_submitted_on, published_on,
     prebid_at, submission_due_at, status, assigned_to, notes)
   values
    ('Supply & installation of 2 MW ground mount solar plant', 'NIT/JJM/2026-27/114', 'Jal Jeevan Mission', 'Rajasthan eProc',
     'open', 'Ground mount', 'Ajmer', 'Rajasthan', 2000, 96000000, 11800, 1920000, 'Bank guarantee', 'submitted',
     current_date - 6, current_date - 12, ${inDays(2)}, ${inDays(9)}, 'preparing', $1,
     'Turnover criteria met. Bank guarantee from SBI in process.'),
    ('Rooftop solar 450 kWp on government college buildings', 'GEM/2026/B/4471902', 'Directorate of College Education', 'GeM',
     'gem', 'Rooftop solar', 'Jaipur', 'Rajasthan', 450, 22500000, 0, 450000, 'Online / NEFT', 'submitted',
     current_date - 20, current_date - 30, null, ${inDays(-4)}, 'submitted', $1,
     'Bid submitted on GeM. Technical opening awaited.'),
    ('O&M of 5 MW solar plant for 3 years', 'RVUNL/OM/2026/08', 'RVUNL', 'CPPP (eprocure.gov.in)',
     'open', 'O&M contract', 'Jodhpur', 'Rajasthan', 5000, 18500000, 5900, 370000, 'DD', 'refund_requested',
     current_date - 60, current_date - 75, null, ${inDays(-40)}, 'lost', $1,
     'L2 by a narrow margin. EMD refund requested on the portal.')`, [SALES_ID]);

  await tx.query(`update public.tenders set our_bid_value = 18980000, our_rank = 2, l1_value = 18150000,
             l1_bidder = 'Suryakiran Energy', total_bidders = 7, result_declared_on = current_date - 20,
             lost_reason = 'Price - 4.5% above L1'
           where reference_no = 'RVUNL/OM/2026/08'`);

  await tx.query(`insert into public.tenders
    (title, reference_no, authority, portal, work_type, district, state, capacity_kwp, estimated_value,
     emd_amount, emd_status, submission_due_at, status, assigned_to, loa_no, loa_date, work_order_no,
     contract_value, completion_days, our_bid_value, our_rank, total_bidders, result_declared_on)
   values
    ('Solar street lights - 1,200 poles', 'NN/JPR/2026/SL-22', 'Nagar Nigam Jaipur (Greater)', 'Rajasthan eProc',
     'Solar street light', 'Jaipur', 'Rajasthan', 96, 38400000, 768000, 'refunded', ${inDays(-95)}, 'won', $1,
     'LOA/NNJ/2026/318', current_date - 40, 'WO/NNJ/2026/0982', 37250000, 180, 37250000, 1, 5, current_date - 45)`, [SALES_ID]);

  await tx.query(`insert into public.leads (company, contact_person, phone, email, district, state, source, status,
             requirement, capacity_kwp, lead_value, next_follow_up, assigned_to, notes)
           values
            ('Shree Cement Ltd', 'Mahesh Agarwal', '9829011223', 'mahesh@example.com', 'Beawar', 'Rajasthan',
             'Referral', 'interested', 'Captive rooftop', 750, 32000000, current_date + 3, $1,
             'Site survey done. Awaiting board approval.'),
            ('Hotel Rajputana', 'Kavita Singh', '9829044556', null, 'Jaipur', 'Rajasthan', 'Website', 'new',
             'Rooftop + storage', 60, 3400000, current_date + 1, $1, null)`, [SALES_ID]);

  await tx.query(`select public.save_quotation(
            jsonb_build_object('client_name', 'Jal Jeevan Mission', 'subject', '2 MW ground mount - price bid',
                               'tender_id', (select id from public.tenders where reference_no = 'NIT/JJM/2026-27/114')::text,
                               'terms', 'Payment: 70% against delivery, 30% after commissioning. Delivery: 90 days from LOA. Warranty: 5 years on workmanship, OEM warranty on modules.'),
            '[{"description":"Solar modules 550 Wp (DCR)","hsn_sac":"85414011","unit":"Nos","quantity":3640,"rate":13200,"tax_rate":12},
              {"description":"String inverters 100 kW","hsn_sac":"85044090","unit":"Nos","quantity":20,"rate":410000,"tax_rate":18},
              {"description":"Module mounting structure (galvanised)","hsn_sac":"7308","unit":"MT","quantity":142,"rate":92000,"tax_rate":18},
              {"description":"Balance of system, cabling and installation","hsn_sac":"9954","unit":"Lot","quantity":1,"rate":8600000,"tax_rate":18}]'::jsonb)`);

  await tx.query(`insert into public.follow_ups (entity_type, tender_id, type, subject, follow_up_at, assigned_to, notes)
           select 'tender', id, 'pre-bid', 'Pre-bid meeting at JJM office', ${inDays(2)}, $1,
                  'Carry turnover certificates and past experience proofs.'
           from public.tenders where reference_no = 'NIT/JJM/2026-27/114'`, [SALES_ID]);
  await tx.query(`insert into public.follow_ups (entity_type, tender_id, type, subject, follow_up_at, assigned_to, notes)
           select 'tender', id, 'portal', 'Check technical opening result', ${inDays(-1)}, $1, 'GeM portal'
           from public.tenders where reference_no = 'GEM/2026/B/4471902'`, [SALES_ID]);
  await tx.query(`insert into public.follow_ups (entity_type, tender_id, type, subject, follow_up_at, assigned_to, notes)
           select 'tender', id, 'email', 'EMD refund follow-up with RVUNL accounts', ${inDays(-3)}, $1,
                  'Refund pending for 20 days.'
           from public.tenders where reference_no = 'RVUNL/OM/2026/08'`, [SALES_ID]);
  await tx.query(`insert into public.follow_ups (entity_type, lead_id, type, subject, follow_up_at, assigned_to)
           select 'lead', id, 'call', 'Board approval status', ${inDays(3)}, $1
           from public.leads where company = 'Shree Cement Ltd'`, [SALES_ID]);
});

// ---------------------------------------------------------------- demo O&M data
const RAHUL_ID = (await one(`select id from public.profiles where email = 'rahul@diwakarsolar.com'`)).id;
const TECH_ID = (await one(`select id from public.profiles where email = 'tech@diwakarsolar.com'`)).id;
await asUser(OWNER, async (tx) => {
  // The real portfolio is seeded by the migration; the demo only fills in
  // the commercial details for the three sites used in this data set.
  await tx.query(`update public.solar_sites ss
    set commissioning_date = v.comm::date, module_make = v.mm, module_count = v.mc, inverter_make = v.im,
        grid_connection = v.grid, discom = v.disc, tariff_per_kwh = v.tariff, expected_yield = v.yield_,
        om_lead_id = $1
    from (values
      ('Sadas', '2024-03-15', 'Adani 550 Wp', 5278, 'Sungrow 250 kW', '33 kV', 'AVVNL', 3.14, 4.6),
      ('Thikariya', '2023-11-02', 'Waaree 545 Wp', 8207, 'Sungrow 125 kW', '11 kV', 'JVVNL', 3.02, 4.4),
      ('Bassi', '2025-01-20', 'Vikram 550 Wp', 8033, 'Sineng 250 kW', '11 kV', 'JVVNL', 2.98, 4.5)
    ) v(name, comm, mm, mc, im, grid, disc, tariff, yield_)
    join public.sites s on s.name = v.name
    where ss.site_id = s.id`, [RAHUL_ID]);

  await tx.query(`insert into public.equipment (site_id, type, name, make, model, capacity_kw, installed_on, warranty_until)
    select s.id, v.t::public.equipment_type, v.n, v.mk, v.md, v.cap, v.inst::date, v.warr::date
    from (values
      ('Sadas', 'inverter', 'INV-01', 'Sungrow', 'SG250HX', 250, '2024-03-01', '2029-03-01'),
      ('Sadas', 'inverter', 'INV-02', 'Sungrow', 'SG250HX', 250, '2024-03-01', '2029-03-01'),
      ('Sadas', 'transformer', 'TRF-01', 'Kirloskar', '5 MVA', 5000, '2024-02-20', '2027-02-20'),
      ('Thikariya', 'inverter', 'INV-01', 'Sungrow', 'SG125HV', 125, '2023-10-15', '2028-10-15'),
      ('Bassi', 'inverter', 'INV-01', 'Sineng', 'EP-250', 250, '2025-01-10', '2030-01-10')
    ) v(site, t, n, mk, md, cap, inst, warr)
    join public.sites s on s.name = v.site`);

  // 30 days of readings with a believable spread; no data for today yet
  await tx.query(`insert into public.generation_records
      (site_id, gen_date, generation_kwh, expected_kwh, grid_outage_hrs, plant_outage_hrs, source)
    select s.id,
           (current_date - d)::date,
           round((ss.capacity_dc_kwp * ss.expected_yield * (0.82 + ((d * 7 + s.name_len) % 24) / 100.0))::numeric, 2),
           round((ss.capacity_dc_kwp * ss.expected_yield)::numeric, 2),
           case when (d + s.name_len) % 11 = 0 then 1.5 else 0 end,
           case when (d + s.name_len) % 17 = 0 then 2.0 else 0 end,
           'manual'
    from generate_series(1, 30) d
    join (select id, name, length(name) as name_len from public.sites where name in ('Sadas','Thikariya','Bassi')) s on true
    join public.solar_sites ss on ss.site_id = s.id`);

  await tx.query(`insert into public.maintenance_tickets (site_id, title, issue, category, priority, status, reported_by, assigned_to, reported_at)
    select s.id, v.title, v.issue, v.cat, v.pri::public.priority, v.st::public.ticket_status, $1, $2, now() - (v.age || ' hours')::interval
    from (values
      ('Sadas', 'Inverter 2 tripped with fault E012', 'Trips every morning after 11 am, resets manually.', 'Inverter fault', 'high', 'assigned', 30),
      ('Thikariya', 'String 7 output low', 'Module cleaning due; bird droppings on rows 4-6.', 'Module cleaning', 'medium', 'open', 8),
      ('Bassi', 'Grid outage since morning', 'DISCOM feeder maintenance, informed by JE.', 'Grid outage', 'critical', 'in_progress', 4)
    ) v(site, title, issue, cat, pri, st, age)
    join public.sites s on s.name = v.site`, [TECH_ID, TECH_ID]);

  await tx.query(`insert into public.maintenance_records (site_id, type, title, scheduled_date, assigned_to, status)
    select s.id, v.t::public.maintenance_type, v.title, (current_date + v.days)::date, $1, v.st::public.task_status
    from (values
      ('Sadas', 'cleaning', 'Fortnightly module cleaning', 3, 'todo'),
      ('Thikariya', 'preventive', 'Quarterly inverter servicing', -2, 'todo'),
      ('Bassi', 'inspection', 'Thermography of string combiner boxes', 12, 'todo')
    ) v(site, t, title, days, st)
    join public.sites s on s.name = v.site`, [TECH_ID]);

  // Six days of site registers. Filing them through the RPC also runs the
  // scoring trigger, so Team Performance has real rows to show.
  await tx.query(`do $do$
    declare
      v_site record;
      v_member record;
      v_entries jsonb;
      v_day int;
    begin
      for v_site in select id, name from public.sites where name in ('Sadas','Thikariya','Bassi') loop
        for v_day in 1..6 loop
          select m.id, m.full_name into v_member from public.om_team_members m
          where m.site_id = v_site.id order by m.full_name limit 1 offset (v_day % 2);

          select jsonb_agg(jsonb_build_object('item_id', i.id, 'status',
                   case when (i.sort_order * 3 + v_day + length(v_site.name)) % 17 = 0 then 'not_ok' else 'ok' end))
            into v_entries
          from public.om_checklist_items i;

          perform public.save_site_ops(
            v_site.id, (current_date - v_day)::date, 'day', v_entries,
            v_member.full_name, v_member.id,
            (case when v_day = 2 and v_site.name = 'Bassi' then 'urgent' else 'normal' end)::public.ops_urgency,
            case when v_day = 2 and v_site.name = 'Bassi' then 'Feeder tripped twice; DISCOM informed.' else null end,
            true);
        end loop;
      end loop;

      -- The month-end marks the reviewers have already awarded.
      update public.om_tech_scores set monthly_review = 16 + (extract(day from score_date)::int % 5)
      where score_date < current_date - 3;
    end
  $do$;`);
});

// ---------------------------------------------------------------- demo projects (Phase 3)
await asUser(OWNER, async (tx) => {
  await tx.query(`insert into public.projects
      (name, client_name, segment, project_type, capacity_kwp, capacity_ac_kw, contract_value,
       stage, start_date, target_commissioning, project_manager_id, site_id, district, state)
    values
      ('Deegod 3.57 MW', 'GCPL Solar Private Limited', 'government', 'ground_mount', 3570, 2800,
       115000000, 'installation', current_date - 60, current_date + 90, $1,
       (select id from public.sites where name = 'Deegod'), 'Kota', 'Rajasthan'),
      ('Bhojusar 3.28 MW', 'GCPL Solar Private Limited', 'government', 'ground_mount', 3280, 2520,
       98000000, 'commissioning', current_date - 150, current_date - 10, $1,
       (select id from public.sites where name = 'Bhojusar'), 'Bikaner', 'Rajasthan')`, [RAHUL_ID]);

  await tx.query(`select public.apply_project_template(p.id,
      (select id from public.project_templates where name = 'Ground-mount Plant (MW scale)'))
    from public.projects p`);

  // Bhojusar is nearly finished; Deegod is in the middle of installation.
  await tx.query(`update public.project_tasks t set status = 'done'
    from public.projects p where p.id = t.project_id
      and p.name like 'Bhojusar%' and t.sort_order <= 6`);
  await tx.query(`update public.project_tasks t set status = 'done'
    from public.projects p where p.id = t.project_id
      and p.name like 'Deegod%' and t.sort_order <= 3`);
  await tx.query(`update public.project_tasks t set status = 'in_progress'
    from public.projects p where p.id = t.project_id
      and p.name like 'Deegod%' and t.sort_order = 4`);

  await tx.query(`insert into public.vendors (name, category, payment_terms, phone, contact_person, gst_no)
    values ('I&C Vendor', 'Installation vendor', 'Milestone based', '7229869779', 'Ankit Goyal', '08AABCI1234M1Z5'),
           ('Suryakiran Modules', 'Modules', '30 days', '9829112233', 'R. Mehta', '08AAACS7777K1ZP')`);

  await tx.query(`insert into public.project_approvals (project_id, kind, authority, reference_no, applied_on, expected_on, status)
    select p.id, v.kind, v.auth, v.ref, current_date - v.ago, current_date + v.due, v.st::public.approval_status
    from public.projects p,
      (values ('DISCOM connectivity', 'JVVNL', 'JVVNL/CONN/2026/881', 40, 5, 'under_review'),
              ('CEIG / Electrical inspector', 'CEIG Rajasthan', 'CEIG/2026/4471', 20, 25, 'applied')) v(kind, auth, ref, ago, due, st)
    where p.name like 'Deegod%'`);

  await tx.query(`insert into public.project_materials (project_id, item, uom, qty_required, qty_received, rate, status, vendor_id)
    select p.id, v.item, v.uom, v.qty, v.recd, v.rate, v.st::public.material_status,
           (select id from public.vendors where name = v.vend)
    from public.projects p,
      (values ('SOLAR MODULE', 'nos', 5290, 5290, 11500, 'at_site', 'Suryakiran Modules'),
              ('Solar INVERTER', 'nos', 9, 9, 420000, 'at_site', 'I&C Vendor'),
              ('Structure', 'set', 3280, 2100, 1450, 'shortage', 'I&C Vendor'),
              ('HT Cable', 'm', 290, 290, 620, 'at_site', 'I&C Vendor'),
              ('Transformer', 'nos', 1, 0, 1850000, 'dispatched', 'I&C Vendor')) v(item, uom, qty, recd, rate, st, vend)
    where p.name like 'Bhojusar%'`);

  await tx.query(`insert into public.vendor_bills (project_id, vendor_id, bill_no, bill_date, amount, deductions, description)
    select p.id, (select id from public.vendors where name = 'I&C Vendor'), v.no, current_date - v.ago, v.amt, v.ded, v.descr
    from public.projects p,
      (values ('INV/2026/118', 12, 2500000, 125000, 'Civil works milestone 2'),
              ('INV/2026/124', 4, 1850000, 92500, 'Structure erection milestone 1')) v(no, ago, amt, ded, descr)
    where p.name like 'Bhojusar%'`);
  await tx.query(`update public.vendor_bills set status = 'pm_approved'
    where bill_no = 'INV/2026/118'`);

  await tx.query(`insert into public.client_payments (project_id, milestone, invoice_no, invoice_date, amount, received_amount, received_on)
    select p.id, v.ms, v.inv, current_date - v.ago, v.amt, v.recd,
           case when v.recd > 0 then current_date - v.ago + 12 else null end
    from public.projects p,
      (values ('Advance - 10%', 'DRIPL/2026/21', 140, 9800000, 9800000),
              ('Supply - 40%', 'DRIPL/2026/38', 60, 39200000, 25000000),
              ('Commissioning - 30%', 'DRIPL/2026/44', 10, 29400000, 0)) v(ms, inv, ago, amt, recd)
    where p.name like 'Bhojusar%'`);

  await tx.query(`do $do$
    declare v_p uuid; v_d int;
    begin
      select id into v_p from public.projects where name like 'Deegod%';
      for v_d in 1..5 loop
        perform public.save_project_update(v_p, (current_date - v_d)::date,
          jsonb_build_object(
            'tl_work', case when v_d > 3 then 'in_progress' else 'completed' end,
            'gss_bay', case when v_d > 2 then 'not_started' else 'in_progress' end,
            'piling', 'completed', 'panel', case when v_d > 4 then 'not_started' else 'in_progress' end,
            'module_work', 'not_started', 'inverter', 'not_started', 'material', 'in_progress'),
          'Piling completed for block A. Panel erection in progress.',
          case when v_d = 3 then 'Work held for two days due to heavy rainfall.' else null end,
          null, 'Ankit Goyal');
      end loop;
    end
  $do$;`);
});

// ---------------------------------------------------------------- demo HR + daily review
await asUser(OWNER, async (tx) => {
  // today's attendance
  await tx.query(`select public.save_attendance((
      select jsonb_agg(jsonb_build_object('employee_id', e.id::text, 'att_date', current_date::text,
                                          'status', case when e.full_name = 'Suresh Kumar' then 'leave' else 'present' end))
      from public.employees e where e.deleted_at is null))`);

  // Six days of daily working sheets, so the PMS score sheet has a spread
  // to show. Task counts and completion vary by employee and by day.
  await tx.query(`do $do$
    declare
      v_emp record;
      v_day int;
      v_tasks jsonb;
      v_n int;
      v_done int;
      i int;
    begin
      for v_emp in select id, full_name from public.employees where deleted_at is null order by full_name loop
        for v_day in 1..6 loop
          v_n := 2 + ((length(v_emp.full_name) + v_day) % 5);
          v_done := greatest(0, v_n - ((length(v_emp.full_name) + v_day * 3) % 3));
          v_tasks := '[]'::jsonb;
          for i in 1..v_n loop
            v_tasks := v_tasks || jsonb_build_object(
              'seq', i,
              'description', (array['Follow-up with the vendor on pending material',
                                    'Updated the tracking sheet and shared it',
                                    'Site coordination call and action points',
                                    'Prepared the documents for approval',
                                    'Reconciled the register for the day',
                                    'Closed the pending items from yesterday'])[1 + ((i + v_day) % 6)],
              'status', case when i <= v_done then 'completed'
                             when i = v_done + 1 then 'in_progress'
                             else 'not_started' end);
          end loop;
          perform public.save_work_log((current_date - v_day)::date, v_tasks,
                                       (case when v_day % 3 = 0 then 'high' else 'medium' end)::public.priority,
                                       null, true, v_emp.id);
        end loop;
      end loop;
    end
  $do$;`);

  await tx.query(`insert into public.leave_requests (employee_id, leave_type, from_date, to_date, days, reason)
    select id, 'casual', current_date + 6, current_date + 7, 2, 'Sister''s wedding'
    from public.employees where full_name = 'Priya Verma'`);

  await tx.query(`insert into public.performance_reviews (employee_id, period_label, period_start, period_end, status, reviewer_id)
    select id, 'FY 2026-27 H1', date_trunc('year', current_date)::date, current_date, 'manager_review', $1
    from public.employees where full_name = 'Suresh Kumar'`, [RAHUL_ID]);
  await tx.query(`insert into public.performance_goals (review_id, sort_order, title, kpi, target, actual, weight)
    select r.id, 1, 'Ticket response time', 'Average first response', 'Under 4 hours', '3.2 hours', 40
    from public.performance_reviews r limit 1`);
  await tx.query(`insert into public.performance_goals (review_id, sort_order, title, kpi, target, actual, weight)
    select r.id, 2, 'Preventive maintenance completion', 'Scheduled vs done', '100%', '92%', 35
    from public.performance_reviews r limit 1`);

  await tx.query(`insert into public.tasks (title, description, module, assigned_to, due_date, priority, status, site_id)
    select v.title, v.descr, v.m::public.task_module, $1, (current_date + v.days)::date, v.p::public.priority,
           v.st::public.task_status, (select id from public.sites where name = v.site)
    from (values
      ('Collect EMD refund acknowledgement', 'Follow up with RVUNL accounts section.', 'crm', 2, 'high', 'todo', 'Sadas'),
      ('String testing at Bassi', 'Check strings 4-9 after cleaning.', 'om', 1, 'medium', 'in_progress', 'Bassi'),
      ('Submit GeM bid documents', 'Upload signed technical bid before the deadline.', 'crm', -1, 'critical', 'todo', 'Thikariya')
    ) v(title, descr, m, days, p, st, site)`, [TECH_ID]);

  // daily reports for today
  await tx.query(`select public.save_daily_report(
      jsonb_build_object('department_id', (select id from public.departments where code = 'OM')::text,
        'health', 'needs_attention', 'status', 'submitted',
        'work_completed', 'Cleaned 4 blocks at Sadas. Inverter 2 reset twice. String testing started at Bassi.',
        'issues', 'Inverter 2 keeps tripping with E012 — OEM engineer required this week.',
        'next_day_plan', 'Complete string testing at Bassi; module cleaning at Thikariya.'),
      '[{"label":"Generation (kWh)","value":"45,300"},{"label":"Open tickets","value":"3"},{"label":"Plant availability","value":"99.6%"}]'::jsonb)`);
  await tx.query(`select public.save_daily_report(
      jsonb_build_object('department_id', (select id from public.departments where code = 'PROJ')::text,
        'health', 'on_track', 'status', 'submitted',
        'work_completed', 'Structure erection completed for block C at the Nagar Nigam street light project.',
        'next_day_plan', 'Start module mounting for block C.'),
      '[{"label":"Installed today (kWp)","value":"85"},{"label":"Manpower on site","value":"24"}]'::jsonb)`);
  await tx.query(`select public.save_daily_report(
      jsonb_build_object('department_id', (select id from public.departments where code = 'ACCTS')::text,
        'health', 'critical', 'status', 'submitted',
        'work_completed', 'Raised invoices for Nagar Nigam milestone 2.',
        'issues', 'EMD refund of Rs 3.7 L from RVUNL pending for 20 days; cash flow tight this week.',
        'next_day_plan', 'Follow up with RVUNL and bank for the BG renewal.'),
      '[{"label":"Collections today (Rs)","value":"12,40,000"},{"label":"Cash / bank balance (Rs)","value":"47,80,000"}]'::jsonb)`);

  await tx.query(`insert into public.review_actions (report_id, action, comment, reviewer_id)
    select r.id, 'ccm_remark', 'Escalate the inverter issue to the OEM today and share the service ticket number.', $1
    from public.daily_reports r
    join public.departments d on d.id = r.department_id and d.code = 'OM'`, [OWNER]);
  await tx.query(`insert into public.review_actions (report_id, action, comment, reviewer_id)
    select r.id, 'founder_remark', 'Call the RVUNL finance controller directly. Report back by tomorrow evening.', $1
    from public.daily_reports r
    join public.departments d on d.id = r.department_id and d.code = 'ACCTS'`, [OWNER]);

  await tx.query(`insert into public.daily_headlines (headline_date, metrics, note)
    values (current_date,
      '[{"label":"Collections today (Rs)","value":"12,40,000"},{"label":"Generation (kWh)","value":"45,300"},
        {"label":"Installed today (kWp)","value":"85"},{"label":"Open tenders","value":"1"}]'::jsonb,
      'Priority: RVUNL EMD refund and the inverter 2 fault at Sadas.')`);
});

// ---------------------------------------------------------------- PostgREST-ish reads
// Canned reads that return the shapes the app requests (embeds included).
const READ_SQL = {
  // Phase 3 — projects
  projects: `select * from public.projects where deleted_at is null order by capacity_kwp desc`,
  project_tasks: `select * from public.project_tasks where deleted_at is null order by sort_order`,
  project_templates: `select t.*,
      coalesce((select json_agg(x order by x.sort_order) from public.project_template_tasks x
                where x.template_id = t.id), '[]') as project_template_tasks
    from public.project_templates t where t.deleted_at is null order by t.name`,
  project_template_tasks: `select * from public.project_template_tasks order by sort_order`,
  project_approvals: `select * from public.project_approvals where deleted_at is null order by created_at`,
  project_materials: `select * from public.project_materials where deleted_at is null order by created_at`,
  project_updates: `select * from public.project_updates where deleted_at is null order by update_date desc`,
  vendors: `select * from public.vendors where deleted_at is null order by name`,
  vendor_bills: `select * from public.vendor_bills where deleted_at is null order by bill_date desc`,
  client_payments: `select * from public.client_payments where deleted_at is null order by created_at`,
  // O&M site register and performance
  om_checklist_items: `select * from public.om_checklist_items order by section, sort_order`,
  om_team_members: `select * from public.om_team_members where deleted_at is null order by full_name`,
  om_site_logs: `select * from public.om_site_logs where deleted_at is null order by log_date desc`,
  om_tech_scores: `select * from public.om_tech_scores where deleted_at is null order by score_date desc`,
  om_score_criteria: `select * from public.om_score_criteria order by sort_order`,
  // PMS
  work_logs: `select * from public.work_logs where deleted_at is null order by log_date desc`,
  work_log_tasks: `select * from public.work_log_tasks order by seq`,
  pms_criteria: `select * from public.pms_criteria order by sort_order`,
  roles: `select * from public.roles order by is_system desc, name`,
  user_roles: `select * from public.user_roles`,
  user_sites: `select * from public.user_sites`,
  role_permissions: `select * from public.role_permissions`,
  sites: `select * from public.sites order by name`,
  departments: `select * from public.departments order by name`,
  designations: `select * from public.designations order by name`,
  app_settings: `select key, value from public.app_settings`,
  employees: `select * from public.employees`,
  audit_logs: `select * from public.audit_logs order by occurred_at desc`,
  leads: `select * from public.leads where deleted_at is null order by created_at desc`,
  tenders: `select t.*, (select json_build_object('id', s.id, 'name', s.name) from public.sites s where s.id = t.site_id) as sites
            from public.tenders t where t.deleted_at is null order by t.submission_due_at nulls last`,
  quotation_items: `select * from public.quotation_items order by line_no`,
  quotations: `select q.*,
      (select json_build_object('id', t.id, 'tender_code', t.tender_code, 'title', t.title) from public.tenders t where t.id = q.tender_id) as tenders,
      (select json_build_object('id', l.id, 'lead_code', l.lead_code, 'contact_person', l.contact_person, 'company', l.company) from public.leads l where l.id = q.lead_id) as leads,
      coalesce((select json_agg(i order by i.line_no) from public.quotation_items i where i.quotation_id = q.id), '[]') as quotation_items
    from public.quotations q where q.deleted_at is null order by q.created_at desc`,
  follow_ups: `select f.*,
      (select json_build_object('id', l.id, 'lead_code', l.lead_code, 'contact_person', l.contact_person, 'company', l.company) from public.leads l where l.id = f.lead_id) as leads,
      (select json_build_object('id', t.id, 'tender_code', t.tender_code, 'title', t.title) from public.tenders t where t.id = f.tender_id) as tenders
    from public.follow_ups f where f.deleted_at is null order by f.follow_up_at`,
  documents: `select * from public.documents where deleted_at is null order by created_at desc`,
  attendance: `select * from public.attendance where deleted_at is null order by att_date desc`,
  leave_requests: `select l.*, (select json_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.employees e where e.id = l.employee_id) as employees
                   from public.leave_requests l where l.deleted_at is null order by l.from_date desc`,
  performance_reviews: `select r.*, (select json_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                     from public.employees e where e.id = r.employee_id) as employees
                        from public.performance_reviews r where r.deleted_at is null order by r.created_at desc`,
  performance_goals: `select * from public.performance_goals order by sort_order`,
  tasks: `select t.*, (select json_build_object('id', s.id, 'name', s.name) from public.sites s where s.id = t.site_id) as sites
          from public.tasks t where t.deleted_at is null order by t.due_date nulls last`,
  daily_reports: `select * from public.daily_reports where deleted_at is null order by report_date desc`,
  daily_headlines: `select * from public.daily_headlines order by headline_date desc`,
  solar_sites: `select ss.*, (select json_build_object('id', s.id, 'name', s.name, 'code', s.code, 'location', s.location,
                                 'district', s.district, 'state', s.state, 'status', s.status, 'capacity_kwp', s.capacity_kwp)
                              from public.sites s where s.id = ss.site_id) as sites
                from public.solar_sites ss`,
  equipment: `select * from public.equipment where deleted_at is null order by type, name`,
  generation_records: `select g.*, (select json_build_object('id', s.id, 'name', s.name) from public.sites s where s.id = g.site_id) as sites
                       from public.generation_records g where g.deleted_at is null order by g.gen_date desc`,
  maintenance_tickets: `select t.*,
      (select json_build_object('id', s.id, 'name', s.name) from public.sites s where s.id = t.site_id) as sites,
      (select json_build_object('id', e.id, 'name', e.name, 'type', e.type) from public.equipment e where e.id = t.equipment_id) as equipment
    from public.maintenance_tickets t where t.deleted_at is null order by t.reported_at desc`,
  maintenance_records: `select m.*,
      (select json_build_object('id', s.id, 'name', s.name) from public.sites s where s.id = m.site_id) as sites,
      (select json_build_object('id', e.id, 'name', e.name) from public.equipment e where e.id = m.equipment_id) as equipment
    from public.maintenance_records m where m.deleted_at is null order by m.scheduled_date`,
  modules: `select m.*, json_build_object('key', g.key, 'label', g.label, 'sort_order', g.sort_order) as module_groups
            from public.modules m join public.module_groups g on g.id = m.group_id order by g.sort_order, m.sort_order`,
  profiles: `select p.*,
      (select to_jsonb(e) || jsonb_build_object(
          'departments', (select json_build_object('name', d.name) from public.departments d where d.id = e.department_id),
          'designations', (select json_build_object('name', g.name) from public.designations g where g.id = e.designation_id))
        from public.employees e where e.id = p.employee_id) as employees,
      coalesce((select json_agg(json_build_object('role_id', ur.role_id, 'roles',
          (select json_build_object('id', r.id, 'name', r.name, 'key', r.key, 'is_system', r.is_system) from public.roles r where r.id = ur.role_id)))
        from public.user_roles ur where ur.user_id = p.id), '[]') as user_roles,
      coalesce((select json_agg(json_build_object('site_id', us.site_id, 'sites',
          (select json_build_object('id', s.id, 'name', s.name) from public.sites s where s.id = us.site_id)))
        from public.user_sites us where us.user_id = p.id), '[]') as user_sites
    from public.profiles p order by p.full_name`,
};

/** Applies PostgREST filters we use (eq, in, ilike, gte, lte, or=ilike list) in JS. */
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      const terms = v.replace(/^\(|\)$/g, '').split(',').map((t) => t.split('.'));
      out = out.filter((r) =>
        terms.some(([col, op, ...rest]) => {
          const val = rest.join('.');
          if (op === 'ilike') return String(r[col] ?? '').toLowerCase().includes(val.replace(/%/g, '').toLowerCase());
          if (op === 'eq') return String(r[col]) === val;
          return false;
        }),
      );
      continue;
    }
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'in') {
      const set = new Set(val.replace(/^\(|\)$/g, '').split(',').filter(Boolean).map((s) => s.replace(/"/g, '')));
      out = out.filter((r) => set.has(String(r[k])));
    } else if (op === 'gte') out = out.filter((r) => new Date(r[k]) >= new Date(val));
    else if (op === 'lte') out = out.filter((r) => new Date(r[k]) <= new Date(val));
    else if (op === 'ilike') out = out.filter((r) => String(r[k] ?? '').toLowerCase().includes(val.replace(/%/g, '').toLowerCase()));
  }
  return out;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function filterSql(params, startIndex) {
  const where = [];
  const values = [];
  for (const [k, v] of params) {
    if (!IDENT.test(k) || ['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    if (op !== 'eq') continue;
    values.push(rest.join('.'));
    where.push(`${k}::text = $${startIndex + values.length}`);
  }
  return { where: where.length ? `where ${where.join(' and ')}` : '', values };
}

// ---------------------------------------------------------------- RPC argument encoding
const argTypes = new Map();
async function rpcArgs(name, body) {
  if (!argTypes.has(name)) {
    const r = await db.query(
      `select unnest(proargnames) as n, unnest(proargtypes::oid[]::regtype[]::text[]) as t from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = $1`,
      [name],
    );
    argTypes.set(name, Object.fromEntries(r.rows.map((x) => [x.n, x.t])));
  }
  const types = argTypes.get(name);
  const keys = Object.keys(body);
  const values = keys.map((k) => {
    const v = body[k];
    if (v === null || v === undefined) return null;
    if (Array.isArray(v) && types[k]?.endsWith('[]')) return `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}`;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  const call = keys.map((k, i) => `${k} => $${i + 1}::${types[k] ?? 'text'}`).join(', ');
  return { call, values };
}

// ---------------------------------------------------------------- HTTP
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.demo`;
const subOf = (req) => {
  try {
    return JSON.parse(Buffer.from((req.headers.authorization ?? '').split(' ')[1].split('.')[1], 'base64url').toString()).sub;
  } catch {
    return null;
  }
};
const userObj = (id, email) => ({ id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range',
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const pgError = (e) => ({ message: e.message, code: e.code ?? 'P0001', details: e.detail ?? null, hint: e.hint ?? null });

async function handleAdminUsers(sub, body) {
  const needs = async (action) => (await asUser(sub, (tx) => tx.query(`select public.has_permission('admin.users', $1) as ok`, [action]))).rows[0].ok;
  switch (body.action) {
    case 'invite':
    case 'create': {
      if (!(await needs('create'))) return [403, { error: 'Access denied: admin.users CREATE permission required.' }];
      const exists = await one(`select 1 as x from auth.users where email = $1`, [body.email]);
      if (exists) return [400, { error: 'A user with this email address has already been registered' }];
      const id = await mkUser(body.email, body.full_name, body.action === 'create' ? { initial_status: 'active' } : {});
      try {
        await asUser(sub, (tx) => tx.query(`select public.admin_save_user($1, $2, true)`, [id, JSON.stringify({ ...(body.data ?? {}), full_name: body.full_name })]));
      } catch (e) {
        await db.query(`delete from auth.users where id = $1`, [id]);
        return [400, { error: e.message }];
      }
      return [200, { id }];
    }
    case 'resend_invite':
    case 'reset_password':
      if (!(await needs(body.action === 'resend_invite' ? 'create' : 'edit'))) return [403, { error: 'Access denied.' }];
      return [200, { ok: true }]; // demo: no email is sent
    case 'set_status':
      try {
        await asUser(sub, (tx) => tx.query(`select public.admin_set_user_status($1, $2)`, [body.user_id, body.status]));
        return [200, { ok: true }];
      } catch (e) {
        return [e.code === '42501' ? 403 : 400, { error: e.message }];
      }
    default:
      return [400, { error: 'Unknown action.' }];
  }
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* ignore */
    }
    const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');

    try {
      // ---- auth
      if (url.pathname === '/auth/v1/token') {
        const u = await one(`select id, email from auth.users where email = $1`, [String(body.email ?? '').toLowerCase()]);
        if (!u || body.password !== PASSWORD)
          return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
        await signIn(u.id);
        return send(res, 200, {
          access_token: jwt(u.id, u.email),
          token_type: 'bearer',
          expires_in: 86400,
          expires_at: Math.floor(Date.now() / 1000) + 86400,
          refresh_token: 'demo-refresh',
          user: userObj(u.id, u.email),
        });
      }
      if (url.pathname === '/auth/v1/user') {
        const sub = subOf(req);
        const u = sub && (await one(`select email from auth.users where id = $1`, [sub]));
        return u ? send(res, 200, userObj(sub, u.email)) : send(res, 401, { msg: 'Invalid token' });
      }
      if (url.pathname === '/auth/v1/logout') return send(res, 204);
      if (url.pathname === '/auth/v1/recover') return send(res, 200, {});

      const sub = subOf(req);

      // ---- edge function
      if (url.pathname === '/functions/v1/admin-users') {
        const [status, payload] = await handleAdminUsers(sub, body);
        return send(res, status, payload);
      }

      // ---- storage (avatars): not emulated
      if (url.pathname.startsWith('/storage/v1/')) return send(res, 400, { message: 'Photo upload is not available in the local demo.' });

      const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
      if (!m) return send(res, 404, { message: 'Not found' });
      const [, isRpc, name] = m;

      // ---- RPC
      if (isRpc) {
        const { call, values } = await rpcArgs(name, body);
        const fn = await one(
          `select p.proretset, p.prorettype = 'void'::regtype as is_void from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = $1`,
          [name],
        );
        if (!fn) return send(res, 404, { message: `Function ${name} not found`, code: 'PGRST202' });
        if (fn.is_void) {
          await asUser(sub, (tx) => tx.query(`select public.${name}(${call})`, values));
          return send(res, 204);
        }
        const sql = fn.proretset
          ? `select coalesce((select json_agg(x) from public.${name}(${call}) x), '[]'::json) as v`
          : `select to_json(public.${name}(${call})) as v`;
        const r = await asUser(sub, (tx) => tx.query(sql, values));
        return send(res, 200, r.rows[0].v);
      }

      if (!IDENT.test(name)) return send(res, 400, { message: 'Bad table' });

      // ---- writes (run as the user: RLS + triggers apply)
      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const upsert = (req.headers.prefer ?? '').includes('merge-duplicates');
        const out = [];
        await asUser(sub, async (tx) => {
          for (const row of rows) {
            const cols = Object.keys(row).filter((c) => IDENT.test(c));
            const conflict = upsert && name === 'app_settings' ? ` on conflict (key) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}` : '';
            const r = await tx.query(
              `insert into public.${name} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_record(null::public.${name}, $1)${conflict} returning to_jsonb(${name}.*) as v`,
              [JSON.stringify(row)],
            );
            out.push(r.rows[0]?.v);
          }
        });
        return send(res, 201, wantsObject ? out[0] : out);
      }
      if (req.method === 'PATCH') {
        const cols = Object.keys(body).filter((c) => IDENT.test(c));
        const { where, values } = filterSql(url.searchParams, 1);
        const r = await asUser(sub, (tx) =>
          tx.query(
            `update public.${name} set (${cols.join(', ')}) = (select ${cols.join(', ')} from jsonb_populate_record(null::public.${name}, $1)) ${where} returning to_jsonb(${name}.*) as v`,
            [JSON.stringify(body), ...values],
          ),
        );
        const out = r.rows.map((x) => x.v);
        if (wantsObject) return out[0] ? send(res, 200, out[0]) : send(res, 406, { message: 'No rows updated', code: 'PGRST116' });
        return send(res, 200, out);
      }
      if (req.method === 'DELETE') {
        const { where, values } = filterSql(url.searchParams, 0);
        await asUser(sub, (tx) => tx.query(`delete from public.${name} ${where}`, values));
        return send(res, 204);
      }

      // ---- reads
      const sql = READ_SQL[name];
      if (!sql) return send(res, 200, []);
      const r = await asUser(sub, (tx) => tx.query(`select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`));
      let rows = applyFilters(r.rows[0].v, url.searchParams);
      const total = rows.length;
      const range = req.headers.range?.match(/(\d+)-(\d+)/);
      const offset = Number(url.searchParams.get('offset') ?? (range ? range[1] : 0));
      const limit = url.searchParams.get('limit') ?? (range ? Number(range[2]) - Number(range[1]) + 1 : null);
      if (limit !== null) rows = rows.slice(offset, offset + Number(limit));
      if (wantsObject) return rows[0] ? send(res, 200, rows[0]) : send(res, 406, { message: 'Not found', code: 'PGRST116' });
      return send(res, 200, rows, { 'Content-Range': `${offset}-${offset + Math.max(0, rows.length - 1)}/${total}` });
    } catch (e) {
      return send(res, e.code === '42501' ? 403 : 400, pgError(e));
    }
  })
  .listen(PORT, () => {
    console.log(`\nDemo backend ready on http://localhost:${PORT}`);
    console.log(`Sign in at http://localhost:5173 with password "${PASSWORD}" as any of:`);
    for (const e of ['owner@diwakarsolar.com (Super Admin)', ...PEOPLE.map(([e, n, r]) => `${e} (${r})`)]) console.log(`  • ${e}`);
  });
