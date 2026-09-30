// Package the built suite for cPanel hosting (suite.diwakarsolar.com on
// Hosting Raja): the contents of dist/ plus deploy/cpanel/.htaccess, as
// release/suite-cpanel.zip. Upload it to the subdomain's folder in cPanel
// File Manager and Extract it there.
//
//   npm run package:cpanel     (builds first)
//
// Only the built website goes in: never the project folder, which holds the
// source, its history and the .env files.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const out = join(root, 'release');
const zip = join(out, 'suite-cpanel.zip');

if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html is missing: run npm run build first.');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const bundle = html.match(/\/assets\/index-[^"]+\.js/)?.[0];
if (!bundle || !readFileSync(join(dist, bundle), 'utf8').includes('.supabase.co')) {
  throw new Error('The build has no Supabase address: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.');
}

copyFileSync(join(root, 'deploy', 'cpanel', '.htaccess'), join(dist, '.htaccess'));
// Cloudflare's header file means nothing to Apache.
rmSync(join(dist, '_headers'), { force: true });

mkdirSync(out, { recursive: true });
rmSync(zip, { force: true });
// Windows' own tar (bsdtar) writes a standard zip with forward slashes, which
// cPanel's extractor needs; elsewhere use zip.
if (process.platform === 'win32') {
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', dist, '.'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: dist, stdio: 'inherit' });
}
console.log(`\n${zip} (${(statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);
console.log('cPanel → File Manager → the subdomain folder → Upload → Extract.');
