// tender-ai — finds a government tender from a screenshot or a few words,
// fetches its official notice (PDF) and summarises it with Google Gemini.
//
// Actions:
//   lookup    { images?: [{ media_type, data }], text? }
//             -> { found, fields, sources, documents, pdf, summary, searched_for, notes }
//             Gemini reads the input and writes search queries, Tavily
//             searches the web (official sites first), Gemini matches the
//             results to the tender, the function downloads the official PDF
//             when a result links to one, and Gemini summarises it.
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
//          TAVILY_API_KEY free key from tavily.com (web search)
import { tavily } from 'npm:@tavily/core@0.7.13';
import { ApiError, FinishReason, GoogleGenAI, type GenerateContentResponse, type Part } from 'npm:@google/genai@2.24.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// "-latest" follows Google's newest Flash, so a model retirement doesn't
// break the feature. Set GEMINI_MODEL to pin one (e.g. gemini-flash-lite-latest
// for a larger free daily quota).
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
// Tried in order when the model above is overloaded, has no quota or is gone.
const MODELS = [...new Set([MODEL, ...(Deno.env.get('GEMINI_FALLBACK_MODELS') ?? 'gemini-flash-latest,gemini-flash-lite-latest').split(',').map((m) => m.trim()).filter(Boolean)])];
// Supabase stops a function at 150 s; leave room to answer.
const REQUEST_BUDGET_MS = 135_000;
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
/** Google's own explanation from an ApiError, which wraps a JSON body. */
function googleReason(e: ApiError): string {
  let msg = e.message;
  const start = msg.indexOf('{');
  if (start >= 0) {
    try {
      msg = JSON.parse(msg.slice(start))?.error?.message ?? msg;
    } catch { /* keep the raw text */ }
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** An ApiError from `model` as the message the user sees. */
function toHttpError(e: unknown, model: string): unknown {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      // "limit: 0" means this model has no free quota at all for the key,
      // which waiting will not fix; another model will.
      if (/limit:\s*0\b/.test(e.message)) {
        const metric = e.message.match(/quotaMetric"?:\s*"([^"]+)"/)?.[1] ?? e.message.match(/Quota exceeded for metric: ([^\s,]+)/)?.[1];
        return new HttpError(429, `The AI model "${model}" has no free quota on this Google key${metric ? ` (${metric})` : ''}. Ask the administrator to set GEMINI_MODEL to another model.`);
      }
      return new HttpError(429, `The free AI quota is used up for now. Try again in a minute, or tomorrow if the daily limit is reached. (Google: ${googleReason(e)})`);
    }
    if (e.status >= 500) return new HttpError(503, "Google's free AI is overloaded right now. Please try again in a few minutes.");
    if (e.status === 400 && /api key/i.test(e.message)) return new HttpError(500, 'The AI key is invalid. Ask the administrator to check GEMINI_API_KEY.');
    if (e.status === 401 || e.status === 403) return new HttpError(500, 'The AI key is invalid or not allowed. Ask the administrator to check GEMINI_API_KEY.');
    if (e.status === 404) return new HttpError(500, `The AI model "${model}" is not available. Ask the administrator to set GEMINI_MODEL.`);
    return new HttpError(502, `AI service error (${e.status}): ${googleReason(e)}`);
  }
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return new HttpError(504, 'The AI took too long. Try again with the tender number.');
  }
  return e;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Free-tier requests are the first Google turns away when a model is busy
 * (503) and each model has its own quota (429), so a busy model is retried
 * briefly and then the next model in MODELS is tried, all within `deadline`.
 */
async function callGemini(params: { system: string; parts: Part[]; schema?: unknown; deadline: number }): Promise<GenerateContentResponse> {
  if (!Deno.env.get('GEMINI_API_KEY')) throw new HttpError(500, 'The AI service is not set up. Ask the administrator to set GEMINI_API_KEY.');
  let res: GenerateContentResponse | undefined;
  let lastError: unknown = new HttpError(504, 'The AI took too long. Try again with the tender number.');
  let lastModel = MODEL;
  models: for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const left = params.deadline - Date.now();
      if (left < 10_000) break models;
      try {
        res = await gemini.models.generateContent({
          model,
          contents: [{ role: 'user', parts: params.parts }],
          config: {
            systemInstruction: params.system,
            ...(params.schema ? { responseMimeType: 'application/json', responseJsonSchema: params.schema } : {}),
            maxOutputTokens: 16000,
            abortSignal: AbortSignal.timeout(left),
          },
        });
        break models;
      } catch (e) {
        lastError = e;
        lastModel = model;
        if (!(e instanceof ApiError)) break models; // network / timeout: no point switching
        console.error(`Gemini ${e.status} on ${model} (attempt ${attempt + 1}): ${googleReason(e)}`);
        if (e.status >= 500) {
          await sleep(attempt === 0 ? 2_000 : 5_000);
          continue;
        }
        if (e.status === 429 || e.status === 404) continue models;
        break models; // bad key, bad request: another model won't help
      }
    }
  }
  if (!res) throw toHttpError(lastError, lastModel);
  if (res.promptFeedback?.blockReason) throw new HttpError(422, 'The AI declined this request. Try a clearer screenshot or type the tender number.');
  const finish = res.candidates?.[0]?.finishReason;
  if (finish === FinishReason.MAX_TOKENS) throw new HttpError(502, 'The answer was cut off. Please try again.');
  if (finish && finish !== FinishReason.STOP) throw new HttpError(422, 'The AI could not answer this one. Try a clearer screenshot or type the tender number.');
  return res;
}


function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new HttpError(502, 'The AI did not return a usable answer. Please try again.');
  return JSON.parse(body.slice(start, end + 1)) as T;
}

// ------------------------------------------------------------------ search
// Tavily (free: ~1,000 searches a month, no card) finds the tender; Gemini
// only reads. Two searches per lookup: one on official sites only, one open
// (news and alert sites often carry the tender number the portal needs).
const OFFICIAL_DOMAINS = [
  'gov.in', 'nic.in', 'gem.gov.in', 'eprocure.gov.in', 'coalindia.in', 'seci.co.in', 'ntpc.co.in',
  'nhpcindia.com', 'sjvn.co.in', 'powergrid.in', 'ireps.gov.in', 'railtel.in', 'nlcindia.in',
];

interface Hit {
  url: string;
  title: string;
  content: string;
  official: boolean;
}

function isOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

async function searchWeb(queries: string[]): Promise<{ hits: Hit[]; error: string | null }> {
  const key = Deno.env.get('TAVILY_API_KEY');
  if (!key) return { hits: [], error: 'web search is not set up (TAVILY_API_KEY missing)' };
  const client = tavily({ apiKey: key });
  const q = queries.map((x) => x.trim()).filter(Boolean).slice(0, 2);
  const plans = [
    { query: q[0], includeDomains: OFFICIAL_DOMAINS },
    { query: q[1] ?? q[0] },
  ].filter((p) => p.query);
  const settled = await Promise.allSettled(
    plans.map((p) =>
      client.search(p.query, {
        searchDepth: 'basic', // 1 credit each
        maxResults: 6,
        country: 'india',
        timeout: 30,
        ...(p.includeDomains ? { includeDomains: p.includeDomains } : {}),
      }),
    ),
  );
  const seen = new Set<string>();
  const hits: Hit[] = [];
  const errors: string[] = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      continue;
    }
    for (const x of r.value.results ?? []) {
      if (!x.url || seen.has(x.url)) continue;
      seen.add(x.url);
      hits.push({ url: x.url, title: x.title ?? x.url, content: (x.content ?? '').slice(0, 1500), official: isOfficial(x.url) });
    }
  }
  if (errors.length) console.error('Tavily search failed:', errors.join(' | '));
  const error = hits.length === 0 && errors.length ? `web search failed (${errors[0].slice(0, 160)})` : null;
  return { hits, error };
}

// ------------------------------------------------------------------ lookup
const PICK_LISTS = `For portal, tender_type, work_type and emd_mode use exactly one of these values or null:
   portal: ${PORTALS.join(' | ')}
   tender_type: ${TENDER_TYPES.join(' | ')} (gem = GeM bid)
   work_type: ${WORK_TYPES.join(' | ')}
   emd_mode: ${EMD_MODES.join(' | ')}
Never invent numbers or dates; use null when unknown. Amounts in rupees (convert lakh/crore). Date-times ISO 8601 with +05:30.`;

const READ_INPUT_SYSTEM = `You help the bid team of Diwakar Solar, a solar EPC company in Rajasthan, India, find government tenders.
The user gives you a screenshot (often a WhatsApp forward, LinkedIn post or tender-alert listing) and/or some text about a tender.
Read every detail you can from it, and write two web search queries that would find this exact tender:
the first aimed at the official notice (tender/NIT/bid number if known, authority, key words such as capacity and location),
the second broader (authority + subject + "tender" + year).
${PICK_LISTS}`;

const READ_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fields: FIELDS_SCHEMA,
    queries: { type: 'array', items: { type: 'string' }, description: 'Exactly two search queries' },
  },
  required: ['fields', 'queries'],
};

const MATCH_SYSTEM = `You help the bid team of Diwakar Solar, a solar EPC company in Rajasthan, India.
You get what the user told us about a tender, and web search results (numbered, with URL, title and an excerpt).
1. Decide whether the results show THIS tender (same authority and subject; same number if known). found = true only then.
2. Complete the tender fields from the results that match. Prefer official sites over news or aggregator sites.
3. document_urls: links from the results that are the official notice / NIT / bid document itself (usually ending in .pdf or a GeM showbidDocument link). Copy URLs exactly; never make one up.
4. sources: the result links that describe this tender, official ones first.
5. Write the summary from what the matching results say. Say plainly in notes what is not confirmed, and where the full document is (portal name), since many portals need a captcha to download.
${PICK_LISTS}`;

const LINK = {
  type: 'object',
  additionalProperties: false,
  properties: { url: { type: 'string' }, title: { type: 'string' } },
  required: ['url', 'title'],
};

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    fields: FIELDS_SCHEMA,
    document_urls: { type: 'array', items: LINK },
    sources: { type: 'array', items: LINK },
    summary: SUMMARY_SCHEMA,
    notes: { type: 'string' },
  },
  required: ['found', 'fields', 'document_urls', 'sources', 'summary', 'notes'],
};

interface MatchResult {
  found: boolean;
  fields: Record<string, unknown>;
  document_urls: { url: string; title: string }[];
  sources: { url: string; title: string }[];
  summary: unknown;
  notes: string;
}

/** Gemini decides which search results are this tender and reads them. */
async function matchResults(given: Record<string, unknown>, text: string, hits: Hit[], deadline: number): Promise<MatchResult> {
  const listing = hits
    .map((h, i) => `[${i + 1}] ${h.official ? '(official) ' : ''}${h.title}\nURL: ${h.url}\n${h.content}`)
    .join('\n\n');
  const matchRes = await callGemini({
    system: MATCH_SYSTEM,
    schema: MATCH_SCHEMA,
    deadline,
    parts: [{
      text: `What the user gave us (read from their screenshot / text):\n${JSON.stringify(given)}\n${text ? `User's words: ${text}\n` : ''}\nSearch results:\n\n${listing}`,
    }],
  });
  const found = parseJson<MatchResult>(matchRes.text ?? '');
  // Keep only links that really came back from the search.
  const known = new Map(hits.map((h) => [h.url, h]));
  found.document_urls = (found.document_urls ?? []).filter((d) => d && known.has(d.url));
  found.sources = (found.sources ?? []).filter((d) => d && known.has(d.url));
  if (found.sources.length === 0) {
    found.sources = hits.filter((h) => h.official).concat(hits.filter((h) => !h.official)).slice(0, 5).map((h) => ({ url: h.url, title: h.title }));
  }
  // Direct PDF links in the results are worth trying even if not picked.
  for (const h of hits) {
    if (/\.pdf($|\?)/i.test(h.url) && h.official && !found.document_urls.some((d) => d.url === h.url)) {
      found.document_urls.push({ url: h.url, title: h.title });
    }
  }
  found.fields = mergeFields(given, found.fields ?? {});
  return found;
}

async function lookup(body: { images?: unknown; text?: unknown }) {
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (!text && images.length === 0) throw new HttpError(400, 'Add a screenshot or type something about the tender.');
  const deadline = Date.now() + REQUEST_BUDGET_MS;

  const parts: Part[] = [];
  for (const img of images) {
    const { media_type, data } = (img ?? {}) as { media_type?: string; data?: string };
    if (!media_type || !IMAGE_TYPES.includes(media_type) || typeof data !== 'string' || !data) {
      throw new HttpError(400, 'Screenshots must be PNG, JPEG, WEBP or GIF images.');
    }
    parts.push({ inlineData: { mimeType: media_type, data } });
  }
  parts.push({ text: text ? `About the tender:\n${text}` : 'Read the tender shown in the screenshot.' });

  // 1. Read the screenshot / text.
  const readRes = await callGemini({ system: READ_INPUT_SYSTEM, schema: READ_INPUT_SCHEMA, parts, deadline });
  const input = parseJson<{ fields: Record<string, unknown>; queries: string[] }>(readRes.text ?? '');
  const queries = (input.queries ?? []).filter((q) => typeof q === 'string' && q.trim());
  if (queries.length === 0) {
    const f = input.fields ?? {};
    queries.push([f.reference_no, f.authority, f.title].filter(Boolean).join(' ') || text.slice(0, 200));
  }

  // 2. Search the web.
  const { hits, error: searchError } = await searchWeb(queries);

  // 3. Match the results to the tender. Without results, what the input said is all we have.
  let found: MatchResult | null = null;
  let summarySource: 'pdf' | 'web' | 'input' = 'web';
  let matchError: string | null = null;
  if (hits.length > 0) {
    try {
      found = await matchResults(input.fields ?? {}, text, hits, deadline);
    } catch (e) {
      // Gemini busy: still hand back what was read and what was found.
      if (!(e instanceof HttpError)) throw e;
      matchError = e.message;
    }
  }
  if (!found) {
    summarySource = 'input';
    found = {
      found: false,
      fields: input.fields ?? {},
      document_urls: [],
      sources: hits.slice(0, 5).map((h) => ({ url: h.url, title: h.title })),
      summary: null,
      notes: matchError
        ? `The web search found ${hits.length} result(s) but the AI could not check them just now (${matchError}). Open the links below.`
        : searchError
        ? `Could not search the web (${searchError}), so this was read from your input only.`
        : 'The web search found nothing for this tender, so this was read from your input only. Try adding the tender number.',
    };
  }
  const documentUrls = found.document_urls;

  // 4. Download the official PDF, trying each candidate until one is a real PDF.
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
  let notes = found.notes ?? '';
  if (pdf) {
    // The PDF is the valuable part; if reading it fails, keep it anyway and
    // let the user summarise it from the tender page.
    try {
      const read = await readPdf(pdf.data, text, deadline);
      fields = mergeFields(fields, read.fields);
      summary = read.summary;
      summarySource = 'pdf';
    } catch (e) {
      console.error('PDF summary failed during lookup', e);
      notes = `The PDF was downloaded but could not be summarised just now — use "Summarise PDF" on the tender page after creating it. ${notes}`.trim();
    }
  }
  console.log(`lookup: queries=${JSON.stringify(queries)} hits=${hits.length} found=${found.found} pdf=${pdf ? pdf.url : 'none'}`);

  return {
    found: Boolean(found.found),
    fields,
    summary,
    summary_source: summarySource,
    sources: found.sources,
    documents: documentUrls,
    pdf,
    download_failures: failures,
    searched_for: hits.length || !searchError ? queries.slice(0, 2) : [],
    notes,
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

async function readPdf(data: string, hint = '', deadline = Date.now() + REQUEST_BUDGET_MS): Promise<{ fields: Record<string, unknown>; summary: unknown }> {
  const res = await callGemini({
    deadline,
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
