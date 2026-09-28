// tender-ai — finds a government tender from a screenshot or a few words,
// fetches its official notice (PDF) and summarises it with Google Gemini.
//
// Actions:
//   lookup    { images?: [{ media_type, data }], text? }
//             -> { found, fields, sources, documents, pdf, summary, notes }
//             Gemini searches Google for the tender, the function downloads
//             the official PDF it points to and, when it gets one, Gemini
//             reads the PDF and writes the summary.
//   summarize { pdf: { name, data } }              (a PDF the user uploads)
//   summarize { document_id }                      (a PDF already attached)
//             -> { fields, summary }
//
// Nothing is written to the database here. The browser creates the tender
// and attaches the PDF as the signed-in user, so row-level security keeps
// deciding who may do what. The caller must hold crm.tenders CREATE or EDIT.
//
// Secrets: GEMINI_API_KEY (free key from aistudio.google.com)
//          GEMINI_MODEL   optional, defaults to the latest Flash model
import { ApiError, FinishReason, GoogleGenAI, type GenerateContentResponse, type Part } from 'npm:@google/genai@2.24.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// "-latest" follows Google's newest Flash, so a model retirement doesn't
// break the feature. Set GEMINI_MODEL to pin one (e.g. gemini-flash-lite-latest
// for a larger free daily quota).
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
// Files go inline in the request, which Gemini caps at about 20 MB after
// base64 encoding.
const MAX_PDF_BYTES = 14 * 1024 * 1024;
const MAX_IMAGES = 4;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const gemini = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY') ?? '' });

// ------------------------------------------------------------------ schemas
// The tender fields mirror public.tenders so the form can be pre-filled.
// Pick-lists match src/features/crm/shared.tsx so the form selects show them.
const PORTALS = ['GeM', 'CPPP (eprocure.gov.in)', 'Rajasthan eProc', 'IREPS', 'Authority website', 'Offline'];
const TENDER_TYPES = ['open', 'limited', 'gem', 'eoi', 'rfp', 'rfq', 'single'];
const WORK_TYPES = ['Rooftop solar', 'Ground mount', 'Solar pump', 'Solar street light', 'O&M contract', 'Supply only', 'EPC', 'Other'];
const EMD_MODES = ['Online / NEFT', 'Bank guarantee', 'DD', 'FDR', 'Exempt (MSME/NSIC)'];
const oneOf = (values: string[], description?: string) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }], ...(description ? { description } : {}) });

const FIELD_PROPS = {
  reference_no: { type: ['string', 'null'], description: 'Tender / NIT / bid number exactly as published' },
  title: { type: ['string', 'null'] },
  authority: { type: ['string', 'null'], description: 'Short name of the tendering authority, e.g. RVPNL, JJM, PWD, NTPC' },
  portal: oneOf(PORTALS),
  portal_url: { type: ['string', 'null'] },
  tender_type: oneOf(TENDER_TYPES, 'gem = GeM bid, single = single / nomination'),
  work_type: oneOf(WORK_TYPES),
  state: { type: ['string', 'null'] },
  district: { type: ['string', 'null'] },
  location: { type: ['string', 'null'] },
  capacity_kwp: { type: ['number', 'null'], description: 'Total capacity in kWp (1 MW = 1000 kWp)' },
  estimated_value: { type: ['number', 'null'], description: 'Estimated cost in rupees (not lakh/crore)' },
  tender_fee: { type: ['number', 'null'], description: 'Tender / document fee in rupees' },
  emd_amount: { type: ['number', 'null'], description: 'EMD / bid security in rupees' },
  emd_mode: oneOf(EMD_MODES),
  published_on: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  prebid_at: { type: ['string', 'null'], description: 'ISO 8601 with +05:30 offset' },
  clarification_due: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  submission_due_at: { type: ['string', 'null'], description: 'Bid submission end, ISO 8601 with +05:30 offset' },
  technical_opening_at: { type: ['string', 'null'], description: 'ISO 8601 with +05:30 offset' },
  completion_days: { type: ['integer', 'null'] },
} as const;

const FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: FIELD_PROPS,
  required: Object.keys(FIELD_PROPS),
};

const LABELLED = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { label: { type: 'string' }, value: { type: 'string' } },
    required: ['label', 'value'],
  },
};
const STRINGS = { type: 'array', items: { type: 'string' } };

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overview: { type: 'string', description: '3-5 plain sentences: what is being bought, by whom, where, how big' },
    scope: STRINGS,
    eligibility: { ...STRINGS, description: 'Qualification criteria: turnover, experience, registrations, JV/MSE rules' },
    key_dates: LABELLED,
    financials: { ...LABELLED, description: 'Estimated cost, EMD, fee, performance security, payment terms' },
    documents_required: STRINGS,
    risks: { ...STRINGS, description: 'Clauses a solar EPC bidder should watch: penalties, LD, warranties, O&M years, tight timelines' },
    recommendation: { type: 'string', description: 'One short paragraph on whether a mid-size solar EPC firm in Rajasthan should consider bidding, and what to check first' },
  },
  required: ['overview', 'scope', 'eligibility', 'key_dates', 'financials', 'documents_required', 'risks', 'recommendation'],
};

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { fields: FIELDS_SCHEMA, summary: SUMMARY_SCHEMA },
  required: ['fields', 'summary'],
};

// ------------------------------------------------------------------ Gemini
async function callGemini(params: { system: string; parts: Part[]; tools?: boolean; schema?: unknown }): Promise<GenerateContentResponse> {
  if (!Deno.env.get('GEMINI_API_KEY')) throw new HttpError(500, 'The AI service is not set up. Ask the administrator to set GEMINI_API_KEY.');
  let res: GenerateContentResponse;
  try {
    res = await gemini.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: params.parts }],
      config: {
        systemInstruction: params.system,
        ...(params.tools ? { tools: [{ googleSearch: {} }, { urlContext: {} }] } : {}),
        ...(params.schema ? { responseMimeType: 'application/json', responseJsonSchema: params.schema } : {}),
        maxOutputTokens: 16000,
        abortSignal: AbortSignal.timeout(140_000),
      },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) {
        console.error(`Gemini 429 on ${MODEL}: ${e.message}`);
        // "limit: 0" means this model has no free quota at all for the key,
        // which waiting will not fix; another model will.
        if (/limit:\s*0\b/.test(e.message)) {
          const metric = e.message.match(/quotaMetric"?:\s*"([^"]+)"/)?.[1] ?? e.message.match(/Quota exceeded for metric: ([^\s,]+)/)?.[1];
          throw new HttpError(429, `The AI model "${MODEL}" has no free quota on this Google key${metric ? ` (${metric})` : ''}. Ask the administrator to set GEMINI_MODEL to another model.`);
        }
        throw new HttpError(429, 'The free AI quota is used up for now. Try again in a minute, or tomorrow if the daily limit is reached.');
      }
      if (e.status === 400 && /api key/i.test(e.message)) throw new HttpError(500, 'The AI key is invalid. Ask the administrator to check GEMINI_API_KEY.');
      if (e.status === 401 || e.status === 403) throw new HttpError(500, 'The AI key is invalid or not allowed. Ask the administrator to check GEMINI_API_KEY.');
      if (e.status === 404) throw new HttpError(500, `The AI model "${MODEL}" is not available. Ask the administrator to set GEMINI_MODEL.`);
      throw new HttpError(502, `AI service error (${e.status}): ${e.message}`);
    }
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new HttpError(504, 'The AI took too long. Try again with the tender number.');
    throw e;
  }
  if (res.promptFeedback?.blockReason) throw new HttpError(422, 'The AI declined this request. Try a clearer screenshot or type the tender number.');
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === FinishReason.MAX_TOKENS) throw new HttpError(502, 'The answer was cut off. Please try again.');
  if (finish && finish !== FinishReason.STOP) throw new HttpError(422, 'The AI could not answer this one. Try a clearer screenshot or type the tender number.');
  return res;
}

/** Pages Google Search actually returned, for when the answer lists none. */
function groundingSources(res: GenerateContentResponse): { url: string; title: string }[] {
  return (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .flatMap((c) => (c.web?.uri ? [{ url: c.web.uri, title: c.web.title ?? c.web.uri }] : []))
    .slice(0, 8);
}

function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new HttpError(502, 'The AI did not return a usable answer. Please try again.');
  return JSON.parse(body.slice(start, end + 1)) as T;
}

// ------------------------------------------------------------------ lookup
interface LookupResult {
  found: boolean;
  fields: Record<string, unknown>;
  document_urls: { url: string; title: string }[];
  sources: { url: string; title: string }[];
  summary: unknown;
  notes: string;
}

const LOOKUP_SYSTEM = `You help the bid team of Diwakar Solar, a solar EPC company in Rajasthan, India, find government tenders.
The user gives you a screenshot (often a WhatsApp forward or a tender-alert listing) and/or some text about a tender.

1. Read every detail you can from the input: tender/NIT/bid number, authority, title, dates, portal.
2. Use Google Search to find the tender on OFFICIAL sources: GeM (bidplus.gem.gov.in), CPPP (eprocure.gov.in), state e-procurement portals (eproc.rajasthan.gov.in, sppp.rajasthan.gov.in, etc.), or the authority's own website (.gov.in / .nic.in / PSU sites such as seci.co.in, ntpc.co.in).
   Aggregator sites (tendertiger, tender247, bidassist …) may be used to find the number, but always try to reach the official page.
3. Look for a direct link to the official notice / NIT / bid document as a PDF. Open the official page (URL context) to confirm a link when useful; only list links you actually saw. Many portals put documents behind a captcha — if so, say so in notes and give the portal page instead.
4. For portal, tender_type, work_type and emd_mode use exactly one of these values or null:
   portal: ${PORTALS.join(' | ')}
   tender_type: ${TENDER_TYPES.join(' | ')} (gem = GeM bid)
   work_type: ${WORK_TYPES.join(' | ')}
   emd_mode: ${EMD_MODES.join(' | ')}
5. Never invent numbers, dates or links. Use null when unknown. Amounts in rupees (convert lakh/crore). Dates in India time.

Finish with ONLY a JSON object (no prose) of this shape:
{"found": boolean,
 "fields": { ${Object.keys(FIELD_PROPS).map((k) => `"${k}": …`).join(', ')} },
 "document_urls": [{"url": "direct PDF link on an official site", "title": "…"}],
 "sources": [{"url": "…", "title": "…"}],
 "summary": {"overview": "…", "scope": [], "eligibility": [], "key_dates": [{"label": "…", "value": "…"}], "financials": [], "documents_required": [], "risks": [], "recommendation": "…"},
 "notes": "what you could not confirm, captcha-protected downloads, corrigenda, etc."}
The summary is from the web pages you read; it will be replaced if the PDF can be downloaded.`;

async function lookup(body: { images?: unknown; text?: unknown }) {
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (!text && images.length === 0) throw new HttpError(400, 'Add a screenshot or type something about the tender.');

  const parts: Part[] = [];
  for (const img of images) {
    const { media_type, data } = (img ?? {}) as { media_type?: string; data?: string };
    if (!media_type || !IMAGE_TYPES.includes(media_type) || typeof data !== 'string' || !data) {
      throw new HttpError(400, 'Screenshots must be PNG, JPEG, WEBP or GIF images.');
    }
    parts.push({ inlineData: { mimeType: media_type, data } });
  }
  parts.push({ text: text ? `About the tender:\n${text}` : 'Find the tender shown in the screenshot.' });

  // Search grounding and a response schema can't be combined on every
  // model, so this call returns JSON as text and is parsed leniently.
  const res = await callGemini({ system: LOOKUP_SYSTEM, parts, tools: true });
  const found = parseJson<LookupResult>(res.text ?? '');
  if (!found.sources?.length) found.sources = groundingSources(res);
  const documentUrls = (found.document_urls ?? []).filter((d) => d && typeof d.url === 'string');

  // Try each candidate until one is a real PDF.
  let pdf: { name: string; data: string; url: string; size: number } | null = null;
  const failures: string[] = [];
  for (const d of documentUrls.slice(0, 4)) {
    try {
      const bytes = await downloadPdf(d.url);
      pdf = { name: pdfName(d.url, found.fields?.reference_no), data: toBase64(bytes), url: d.url, size: bytes.byteLength };
      break;
    } catch (e) {
      failures.push(`${d.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let fields = found.fields ?? {};
  let summary: unknown = found.summary ?? null;
  let summarySource: 'pdf' | 'web' = 'web';
  if (pdf) {
    const read = await readPdf(pdf.data, text);
    fields = mergeFields(fields, read.fields);
    summary = read.summary;
    summarySource = 'pdf';
  }

  return {
    found: Boolean(found.found),
    fields,
    summary,
    summary_source: summarySource,
    sources: (found.sources ?? []).filter((s) => s && typeof s.url === 'string'),
    documents: documentUrls,
    pdf,
    download_failures: failures,
    notes: found.notes ?? '',
  };
}

// ------------------------------------------------------------------ PDF
function isPublicHttps(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('not a valid link');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('not a web link');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':')) {
    throw new Error('address not allowed');
  }
  return u;
}

async function downloadPdf(raw: string): Promise<Uint8Array> {
  const url = isPublicHttps(raw);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (DiwakarSolarSuite tender lookup)', Accept: 'application/pdf,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  isPublicHttps(res.url || raw); // the redirect target must be public too
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_PDF_BYTES) throw new Error('file larger than 14 MB');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('file larger than 14 MB');
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new Error('the link did not return a PDF (probably a login or captcha page)');
  }
  return bytes;
}

function pdfName(url: string, ref: unknown): string {
  const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  if (/\.pdf$/i.test(last)) return last.replace(/[^\w.\-() ]+/g, '_').slice(-120);
  const base = typeof ref === 'string' && ref ? ref : 'tender-notice';
  return `${base.replace(/[^\w.\-() ]+/g, '_').slice(0, 100)}.pdf`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const READ_SYSTEM = `You read Indian government tender documents for the bid team of Diwakar Solar, a solar EPC company in Rajasthan.
Extract the tender fields and write a practical summary a bid manager can read in two minutes.
Quote numbers, dates and amounts exactly as the document states them; use null when the document does not say.
Amounts in fields are in rupees (convert lakh/crore). Date-times in fields are ISO 8601 with the +05:30 offset.`;

async function readPdf(data: string, hint = ''): Promise<{ fields: Record<string, unknown>; summary: unknown }> {
  const res = await callGemini({
    system: READ_SYSTEM,
    schema: EXTRACT_SCHEMA,
    parts: [
      { inlineData: { mimeType: 'application/pdf', data } },
      { text: hint ? `The user described this tender as: ${hint}\n\nExtract and summarise.` : 'Extract and summarise this tender.' },
    ],
  });
  return parseJson(res.text ?? '');
}

/** Values read from the PDF win; web values fill whatever the PDF leaves blank. */
function mergeFields(web: Record<string, unknown>, pdf: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...web };
  for (const [k, v] of Object.entries(pdf ?? {})) if (v !== null && v !== '') out[k] = v;
  return out;
}

async function summarize(caller: SupabaseClient, body: { pdf?: { data?: string }; document_id?: unknown; text?: unknown }) {
  let data: string | undefined = body.pdf?.data;
  if (!data && typeof body.document_id === 'string') {
    // Read the attachment as the caller, so RLS decides whether they may.
    const { data: doc, error } = await caller.from('documents').select('storage_path, mime_type, size_bytes').eq('id', body.document_id).single();
    if (error || !doc) throw new HttpError(404, 'Document not found.');
    if ((doc.size_bytes ?? 0) > MAX_PDF_BYTES) throw new HttpError(400, 'The document is larger than 14 MB.');
    const file = await caller.storage.from('documents').download(doc.storage_path);
    if (file.error) throw new HttpError(403, file.error.message);
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50) throw new HttpError(400, 'Only PDF documents can be summarised.');
    data = toBase64(bytes);
  }
  if (!data) throw new HttpError(400, 'Attach the tender PDF to summarise.');
  if (data.length > (MAX_PDF_BYTES * 4) / 3 + 16) throw new HttpError(400, 'The PDF is larger than 14 MB.');
  return await readPdf(data, typeof body.text === 'string' ? body.text.slice(0, 2000) : '');
}

// ------------------------------------------------------------------ server
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'Not signed in.' }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) throw new HttpError(401, 'Session expired. Please sign in again.');

    const [canCreate, canEdit] = await Promise.all([
      caller.rpc('has_permission', { p_module: 'crm.tenders', p_action: 'create' }),
      caller.rpc('has_permission', { p_module: 'crm.tenders', p_action: 'edit' }),
    ]);
    if (!canCreate.data && !canEdit.data) throw new HttpError(403, 'Access denied: Tenders CREATE or EDIT permission required.');

    const body = await req.json().catch(() => ({}));
    switch (String(body.action ?? '')) {
      case 'lookup': {
        const result = await lookup(body);
        await caller.rpc('log_event', { p_action: 'tender.ai_lookup', p_module: 'crm.tenders', p_summary: `AI tender lookup: ${String(result.fields?.reference_no ?? result.fields?.title ?? 'not found')}` });
        return json(req, result);
      }
      case 'summarize':
        return json(req, await summarize(caller, body));
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    console.error(e);
    return json(req, { error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
