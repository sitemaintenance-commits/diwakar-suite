// send-document — email documents from the suite as attachments.
//
// Everything runs as the caller: the documents are read through RLS and the
// files downloaded through the storage policies, so nobody can send a file
// they could not open themselves. Mail goes out through Resend
// (https://resend.com) with the caller as Reply-To.
//
// Secrets:
//   RESEND_API_KEY   the Resend API key
//   MAIL_FROM        e.g. "Diwakar Solar <documents@diwakarsolar.com>" (a
//                    domain verified in Resend)
//
// Body: { document_ids: string[], to: string[], cc?: string[], subject: string, message?: string }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? '';

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const MAX_TOTAL = 25 * 1024 * 1024;   // Resend allows 40 MB a message, base64 included
const MAX_RECIPIENTS = 20;
const MAX_FILES = 10;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function emails(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\s]+/) : [];
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'Not signed in.' }, 401);

  if (!RESEND_API_KEY || !MAIL_FROM) {
    return json(req, { error: 'Email is not set up yet. Use Share or Email link for now.', code: 'not_configured' }, 503);
  }

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) return json(req, { error: 'Session expired. Please sign in again.' }, 401);

    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.document_ids) ? body.document_ids.map(String).slice(0, MAX_FILES + 1) : [];
    const to = emails(body.to);
    const cc = emails(body.cc).filter((e) => !to.includes(e));
    const subject = String(body.subject ?? '').trim().slice(0, 200);
    const message = String(body.message ?? '').trim().slice(0, 5000);

    if (!ids.length) return json(req, { error: 'Choose a document to send.' }, 400);
    if (ids.length > MAX_FILES) return json(req, { error: `Send up to ${MAX_FILES} documents at a time.` }, 400);
    if (!to.length) return json(req, { error: 'Add at least one email address.' }, 400);
    const bad = [...to, ...cc].filter((e) => !EMAIL_RE.test(e));
    if (bad.length) return json(req, { error: `Check these addresses: ${bad.join(', ')}` }, 400);
    if (to.length + cc.length > MAX_RECIPIENTS) return json(req, { error: `Up to ${MAX_RECIPIENTS} recipients.` }, 400);
    if (!subject) return json(req, { error: 'Add a subject.' }, 400);

    // Read through RLS: a document the caller cannot see is simply not found.
    const { data: docs, error: docErr } = await caller
      .from('documents').select('id, file_name, storage_path, mime_type, size_bytes').in('id', ids);
    if (docErr) return json(req, { error: docErr.message }, 400);
    if (!docs || docs.length !== ids.length) return json(req, { error: 'A document was not found, or you cannot open it.' }, 403);

    const total = docs.reduce((n, d) => n + Number(d.size_bytes ?? 0), 0);
    if (total > MAX_TOTAL) return json(req, { error: 'The files are larger than 25 MB together. Send fewer, or use Email link.' }, 400);

    const attachments = [];
    for (const d of docs) {
      const { data: blob, error } = await caller.storage.from('documents').download(d.storage_path);
      if (error || !blob) return json(req, { error: `Could not read ${d.file_name}.` }, 403);
      attachments.push({ filename: d.file_name, content: encodeBase64(new Uint8Array(await blob.arrayBuffer())) });
    }

    const { data: me } = await caller.from('profiles').select('full_name, email').eq('id', userData.user.id).single();
    const sender = me?.full_name || userData.user.email || 'A colleague';
    const replyTo = me?.email || userData.user.email || undefined;
    const list = docs.map((d) => `<li>${esc(d.file_name)}</li>`).join('');
    const html = `<div style="font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
      ${message ? `<p style="white-space:pre-line">${esc(message)}</p>` : ''}
      <p>Attached:</p><ul>${list}</ul>
      <p style="color:#64748b;font-size:12px">Sent by ${esc(sender)} from the Diwakar Solar Management Suite.</p></div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM, to, cc: cc.length ? cc : undefined, reply_to: replyTo, subject, html,
        text: `${message ? message + '\n\n' : ''}Attached: ${docs.map((d) => d.file_name).join(', ')}\n\nSent by ${sender} from the Diwakar Solar Management Suite.`,
        attachments,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(req, { error: `The email could not be sent: ${out?.message ?? res.statusText}` }, 502);
    }

    // Who sent which files to whom, in the audit log.
    await caller.rpc('log_event', {
      p_action: 'document.emailed',
      p_module: 'documents',
      p_summary: `Emailed ${docs.length} document(s) to ${[...to, ...cc].join(', ')}`,
      p_details: { document_ids: ids, files: docs.map((d) => d.file_name), to, cc, subject, email_id: out?.id ?? null },
    });

    return json(req, { ok: true, id: out?.id ?? null, sent_to: [...to, ...cc] });
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
