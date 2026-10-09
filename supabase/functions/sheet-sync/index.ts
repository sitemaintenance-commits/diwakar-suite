// sheet-sync — bring the technicians' Google Form sheet into Daily Entry.
//
// Reads the sheet (shared as "anyone with the link can view") tab by tab:
// the newest two month tabs ("Form responses- Oct 2026", "... Sept 2026"),
// parses each answer and hands one row per site and day to
// sync_generation_sheet(), which saves new days, updates days that came
// from the sheet and never touches a day entered or edited in the suite.
//
// Who may run it:
//   * the 30-minute scheduler, with header x-sync-secret = SYNC_SECRET
//   * a signed-in user who can file or edit Daily Entry ("Sync now")
//
// The sheet's id comes from setting generation_sheet ({sheet_id, from}).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { parseSheet, parseTabs, type SheetRow } from './parse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SYNC_SECRET = Deno.env.get('SYNC_SECRET') ?? '';
const TABS_TO_READ = 2;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'diwakar-suite-sheet-sync' } });
  if (!res.ok) throw new Error(`The sheet could not be read (${res.status}). Is it shared as "anyone with the link can view"?`);
  return await res.text();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let by = 'scheduler';

  // The scheduler, or a person allowed to file Daily Entry.
  const secret = req.headers.get('x-sync-secret') ?? '';
  if (!(SYNC_SECRET && secret === SYNC_SECRET)) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'Not signed in.' }, 401);
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) return json(req, { error: 'Session expired. Please sign in again.' }, 401);
    const [{ data: canCreate }, { data: canEdit }] = await Promise.all([
      caller.rpc('has_permission', { p_module: 'om.daily_entry', p_action: 'create' }),
      caller.rpc('has_permission', { p_module: 'om.daily_entry', p_action: 'edit' }),
    ]);
    if (!canCreate && !canEdit) return json(req, { error: 'Access denied: Daily Entry permission required.' }, 403);
    by = userData.user.email ?? userData.user.id;
  }

  try {
    const { data: setting } = await admin.from('app_settings').select('value').eq('key', 'generation_sheet').single();
    const sheetId = String((setting?.value as { sheet_id?: string } | null)?.sheet_id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{20,}$/.test(sheetId)) {
      return json(req, { error: 'The Google Sheet is not set up yet.', code: 'not_configured' }, 503);
    }

    // The month tabs, newest first; read the latest two (a day filed late lands in last month's tab).
    const tabs = parseTabs(await fetchText(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`));
    if (!tabs.length) throw new Error('No tabs found in the sheet.');
    const rows: SheetRow[] = [];
    const read: string[] = [];
    for (const t of tabs.slice(0, TABS_TO_READ)) {
      const csv = await fetchText(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${t.gid}`);
      rows.push(...parseSheet(csv));
      read.push(t.name);
    }

    const { data: result, error } = await admin.rpc('sync_generation_sheet', { p_rows: rows });
    if (error) throw new Error(error.message);

    const summary = { at: new Date().toISOString(), by, tabs: read, rows: rows.length, ...(result as Record<string, unknown>) };
    await admin.from('app_settings').upsert({ key: 'generation_sheet_last_sync', value: summary, updated_at: summary.at });
    return json(req, { ok: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from('app_settings').upsert({
      key: 'generation_sheet_last_sync',
      value: { at: new Date().toISOString(), by, error: message },
      updated_at: new Date().toISOString(),
    });
    return json(req, { error: message }, 500);
  }
});
