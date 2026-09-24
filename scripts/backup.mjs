// Dump the linked Supabase database to a dated .sql file.
//
//   npm run db:backup
//
// The file lands in backups/ , which .gitignore excludes — a dump holds
// real employee and financial data and must never reach GitHub.
//
// Restore with:  psql "<connection string>" -f backups/<file>.sql
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const file = `backups/diwakar-suite-${stamp}.sql`;

mkdirSync('backups', { recursive: true });

console.log(`Dumping the linked project to ${file} …`);
try {
  execSync(`npx supabase db dump -f "${file}"`, { stdio: 'inherit' });
  console.log(`\nDone: ${file}`);
  console.log('Keep a copy off this machine — Drive, or wherever you keep company records.');
} catch {
  console.error('\nDump failed. Is the project linked? Try:  npx supabase link --project-ref <ref>');
  process.exit(1);
}
