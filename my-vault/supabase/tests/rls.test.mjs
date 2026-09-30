// Security tests for supabase/schema.sql, run against PGlite (Postgres in WASM)
// with minimal stand-ins for Supabase auth/storage. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';

const schema = fs.readFileSync(process.argv[2] ?? new URL('../schema.sql', import.meta.url), 'utf8');
const db = new PGlite({ extensions: { pg_trgm } });

// ---- Minimal Supabase platform stubs (mirrors Supabase's definitions) ----
await db.exec(`
create schema auth; create schema storage; create schema extensions;
create role anon nologin; create role authenticated nologin;
grant usage on schema public, auth, storage, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin _parts := string_to_array(name, '/'); return _parts[1 : array_length(_parts,1) - 1]; end $$;
create function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text; begin _parts := string_to_array(name, '/'); _filename := _parts[array_length(_parts,1)]; return reverse(split_part(reverse(_filename), '.', 1)); end $$;
`);

await db.exec(schema);
await db.exec(schema); // idempotency
console.log('schema applied twice OK');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${A}','a@x.com','{"full_name":"Alice"}'), ('${B}','b@x.com','{}')`);

let pass = 0;
let fail = 0;
const as = async (uid, role = 'authenticated') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
};
async function expectOk(name, sql, check) {
  try {
    const r = await db.query(sql);
    if (check && !check(r)) throw new Error('check failed: ' + JSON.stringify(r.rows));
    console.log('PASS', name);
    pass++;
    return r;
  } catch (e) {
    console.log('FAIL', name, '-', e.message);
    fail++;
  }
}
async function expectErr(name, sql, match) {
  try {
    const r = await db.query(sql);
    console.log('FAIL', name, '- no error, rows:', r.rows.length);
    fail++;
  } catch (e) {
    if (match && !match.test(e.message)) {
      console.log('FAIL', name, '- wrong error:', e.message);
      fail++;
    } else {
      console.log('PASS', name, '(' + e.message.slice(0, 70) + ')');
      pass++;
    }
  }
}

await expectOk('profiles created by trigger', `select count(*)::int n from public.profiles`, (r) => r.rows[0].n === 2);
await expectOk('profile name from metadata', `select full_name from public.profiles where id='${A}'`, (r) => r.rows[0].full_name === 'Alice');

await as(A);
await expectOk(
  'A inserts own file',
  `insert into public.files (id, user_id, original_name, display_name, storage_path, mime_type, extension, category, size_bytes, tags, description)
   values ('aaaaaaaa-0000-0000-0000-000000000001', '${A}', 'Invoice 2024.PDF', '  Invoice 2024  ', '${A}/pdfs/aaaaaaaa-0000-0000-0000-000000000001.pdf',
   'application/pdf', 'PDF', 'pdf', 1000, array['  Receipts','receipts','Tax '], 'Q1 paperwork')`,
);
await expectOk('name trimmed, tags normalised, ext lowercased, search_text built', `select display_name, tags, extension, search_text from public.files`, (r) =>
  r.rows[0].display_name === 'Invoice 2024' &&
  JSON.stringify(r.rows[0].tags) === '["receipts","tax"]' &&
  r.rows[0].extension === 'pdf' &&
  r.rows[0].search_text.includes('q1 paperwork'),
);
await expectOk('substring AND search via ilike', `select count(*)::int n from public.files where search_text ilike '%voic%' and search_text ilike '%rece%'`, (r) => r.rows[0].n === 1);
await expectErr('A cannot insert into B folder', `insert into public.files (user_id, original_name, display_name, storage_path, category, size_bytes) values ('${A}','x','x','${B}/pdfs/x.pdf','pdf',1)`, /row-level security/);
await expectErr('A cannot insert row owned by B', `insert into public.files (user_id, original_name, display_name, storage_path, category, size_bytes) values ('${B}','x','x','${B}/pdfs/y.pdf','pdf',1)`, /row-level security/);
await expectErr('A cannot point thumbnail at B', `insert into public.files (original_name, display_name, storage_path, thumbnail_path, category, size_bytes) values ('x','x','${A}/pdfs/t.pdf','${B}/thumbs/t.webp','pdf',1)`, /row-level security/);
await expectErr('bad path format rejected', `insert into public.files (original_name, display_name, storage_path, category, size_bytes) values ('x','x','${A}/secret/x.pdf','pdf',1)`, /files_storage_path_format/);
await expectErr('blocked extension rejected', `insert into public.files (original_name, display_name, storage_path, extension, category, size_bytes) values ('x.exe','x','${A}/other/x.exe','exe','other',1)`, /files_extension_not_blocked/);
await expectErr('quota enforced', `insert into public.files (original_name, display_name, storage_path, category, size_bytes) values ('big','big','${A}/other/big.bin','other', 2147483648)`, /STORAGE_LIMIT_EXCEEDED/);
await expectErr('storage_path immutable', `update public.files set storage_path='${A}/pdfs/zzz.pdf'`, /IMMUTABLE_COLUMN/);
await expectErr('size immutable', `update public.files set size_bytes=1`, /IMMUTABLE_COLUMN/);
await expectErr('pdf -> image category change blocked', `update public.files set category='image'`, /INVALID_CATEGORY_CHANGE/);
await expectErr('empty name blocked', `update public.files set display_name='   '`, /EMPTY_NAME/);
await expectOk('A can rename / favorite / trash', `update public.files set display_name='Renamed', is_favorite=true, deleted_at=now() returning id`, (r) => r.rows.length === 1);
await expectErr('A cannot raise own quota', `update public.profiles set storage_quota_bytes = 999999999999 where id='${A}'`, /permission denied/);
await expectOk('A can update own name + prefs', `update public.profiles set full_name='Alice B', preferences='{"view":"list"}' where id='${A}' returning id`, (r) => r.rows.length === 1);
await expectErr('A avatar_path must be in own folder', `update public.profiles set avatar_path='${B}/avatar/x.webp' where id='${A}'`, /row-level security/);
await expectOk('vault_stats for A', `select public.vault_stats() s`, (r) => {
  const s = r.rows[0].s;
  return s.trash === 1 && s.total_bytes === 1000 && s.quota_bytes === 1073741824 && s.bytes_by_category.pdf === 1000;
});

await as(B);
await expectOk('B sees none of A files', `select count(*)::int n from public.files`, (r) => r.rows[0].n === 0);
await expectOk('B update of A file affects 0 rows', `update public.files set display_name='pwned' returning id`, (r) => r.rows.length === 0);
await expectOk('B delete of A file affects 0 rows', `delete from public.files returning id`, (r) => r.rows.length === 0);
await expectOk('B sees only own profile', `select count(*)::int n from public.profiles`, (r) => r.rows[0].n === 1);
await expectOk('B stats are empty', `select public.vault_stats() s`, (r) => r.rows[0].s.total_files === 0 && r.rows[0].s.total_bytes === 0);

await as(A);
await expectOk('A uploads object to own folder', `insert into storage.objects (bucket_id, name) values ('vault-files', '${A}/images/a.jpg') returning id`);
await expectOk('A uploads thumbnail', `insert into storage.objects (bucket_id, name) values ('vault-files', '${A}/thumbs/a.webp') returning id`);
await expectErr('A cannot upload into B folder', `insert into storage.objects (bucket_id, name) values ('vault-files', '${B}/images/evil.jpg')`, /row-level security/);
await expectErr('A cannot upload to unknown subfolder', `insert into storage.objects (bucket_id, name) values ('vault-files', '${A}/random/x.jpg')`, /row-level security/);
await expectErr('A cannot upload .exe', `insert into storage.objects (bucket_id, name) values ('vault-files', '${A}/other/x.exe')`, /row-level security/);
await expectErr('A cannot upload to another bucket', `insert into storage.objects (bucket_id, name) values ('other-bucket', '${A}/images/x.jpg')`, /row-level security/);
await as(B);
await expectOk('B cannot see A objects', `select count(*)::int n from storage.objects`, (r) => r.rows[0].n === 0);
await expectOk('B cannot delete A objects', `delete from storage.objects returning id`, (r) => r.rows.length === 0);

await as(null, 'anon');
await expectErr('anon cannot read files', `select * from public.files`, /permission denied/);
await expectErr('anon cannot read profiles', `select * from public.profiles`, /permission denied/);
await expectErr('anon cannot call vault_stats', `select public.vault_stats()`, /permission denied/);
await expectOk('anon sees no storage objects', `select count(*)::int n from storage.objects`, (r) => r.rows[0].n === 0);
await expectErr('anon cannot upload', `insert into storage.objects (bucket_id, name) values ('vault-files', '${A}/images/anon.jpg')`, /row-level security/);

await db.exec('reset role');
await expectOk('bucket is private', `select public from storage.buckets where id='vault-files'`, (r) => r.rows[0].public === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
