// Client side of the tender-ai Edge Function: find a tender from a
// screenshot or text, fetch its official PDF and summarise it.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { TenderAiSummary } from '@/lib/types';

export type AiFields = Partial<Record<
  | 'reference_no' | 'title' | 'authority' | 'portal' | 'portal_url' | 'tender_type' | 'work_type' | 'state'
  | 'district' | 'location' | 'capacity_kwp' | 'estimated_value' | 'tender_fee' | 'emd_amount' | 'emd_mode'
  | 'published_on' | 'prebid_at' | 'clarification_due' | 'submission_due_at' | 'technical_opening_at' | 'completion_days',
  string | number | null
>>;

export interface AiLink {
  url: string;
  title: string;
}

export interface AiPdf {
  storage_path?: string;
  name: string;
  data: string; // base64
  url?: string;
  size: number;
}

export interface LookupResult {
  found: boolean;
  fields: AiFields;
  summary: TenderAiSummary | null;
  summary_source: 'pdf' | 'web' | 'input';
  sources: AiLink[];
  documents: AiLink[];
  pdf: AiPdf | null;
  download_failures: string[];
  /** The web searches that were run, for the user to see. */
  searched_for?: string[];
  /** Background five-step analysis of the downloaded RfS, when one was found. */
  analysis_job_id?: string | null;
  notes: string;
}

// ---------------------------------------------------------------- analysis jobs
export type StoredFile = { path: string; name: string };
export type AnalysisJob = {
  id: string; tender_id: string | null; files: StoredFile[]; status: 'processing' | 'completed' | 'failed';
  created_at: string; updated_at: string; error: string | null; step: 'preparing' | 'analysing' | null;
  parts: Record<string, unknown> | null; result: { fields: AiFields; summary: TenderAiSummary } | null;
};

// Each step of a job runs for at most ~2.5 minutes and records its progress,
// so a job silent for longer than that plus slack has lost its worker.
export const jobExpired = (job: AnalysisJob) => job.status === 'processing' && Date.now() - Date.parse(job.updated_at ?? job.created_at) > 300_000;

const STEP_LABELS: Record<string, string> = { synopsis: 'Synopsis', risks: 'Risk clauses', decision: 'Go/no-go & contradictions' };
export function jobProgressText(job: AnalysisJob) {
  if (job.step !== 'analysing') return 'Uploading the PDFs to the AI and waiting for Google to read every page…';
  const done = Object.keys(job.parts ?? {});
  const left = Object.keys(STEP_LABELS).filter((k) => !done.includes(k)).map((k) => STEP_LABELS[k]);
  return `Analysing: ${done.length} of 3 steps done${left.length ? ` — still working on ${left.join(', ')}` : ''}…`;
}

export async function fetchAnalysisJob(id: string): Promise<AnalysisJob | null> {
  const { data, error } = await supabase.from('tender_analysis_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as AnalysisJob | null;
}

/** Puts a PDF in the private analysis bucket, under the user's own folder. */
export async function uploadAnalysisPdf(file: File): Promise<StoredFile> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Please sign in again.');
  if (!/\.pdf$/i.test(file.name) || new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== '%PDF-') throw new Error(`${file.name} is not a PDF.`);
  const path = `${auth.user.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-() ]/g, '_').slice(-120)}`;
  const up = await supabase.storage.from('tender-analysis').upload(path, file, { contentType: 'application/pdf' });
  if (up.error) throw up.error;
  return { path, name: file.name };
}

export function startAnalysisJob(files: StoredFile[], tenderId?: string) {
  return callTenderAi<{ id: string }>({ action: 'analyse', files, tender_id: tenderId });
}

/** Links an analysis to the tender created from it; its summary is saved there when done. */
export function linkAnalysis(jobId: string, tenderId: string) {
  return callTenderAi<{ id: string; status: string }>({ action: 'link_analysis', job_id: jobId, tender_id: tenderId });
}

export async function callTenderAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('tender-ai', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.error ?? error.message);
    }
    throw error;
  }
  return data as T;
}

export function lookupTender(images: { media_type: string; data: string }[], text: string) {
  return callTenderAi<LookupResult>({ action: 'lookup', images, text });
}

export function summarizePdf(pdf: AiPdf, text = '') {
  return callTenderAi<{ fields: AiFields; summary: TenderAiSummary }>({ action: 'summarize', pdf, text });
}

export function summarizeDocument(documentId: string) {
  return callTenderAi<{ fields: AiFields; summary: TenderAiSummary }>({ action: 'summarize', document_id: documentId });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function fileToBase64(file: Blob): Promise<string> {
  return arrayBufferToBase64(await file.arrayBuffer());
}

export function base64ToFile(data: string, name: string, type = 'application/pdf'): File {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

/**
 * Screenshots from phones are often 3–8 MB. Claude reads text fine at
 * ~2000px, so large images are scaled down and re-encoded as JPEG.
 */
export async function prepareImage(file: File): Promise<{ media_type: string; data: string }> {
  const MAX_SIDE = 2000;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 3_500_000 && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    bitmap.close();
    return { media_type: file.type, data: await fileToBase64(file) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image.'))), 'image/jpeg', 0.88),
  );
  return { media_type: 'image/jpeg', data: await fileToBase64(blob) };
}

/** AI fields -> the string form TenderFormDialog uses. Times become datetime-local values. */
export function fieldsToForm(fields: AiFields): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

/** Saves the summary on the tender (as the signed-in user; RLS applies). */
export async function saveTenderSummary(tenderId: string, summary: TenderAiSummary, from: 'pdf' | 'web', sources: AiLink[] | null) {
  const patch: Record<string, unknown> = { ai_summary: summary, ai_summary_from: from, ai_summary_at: new Date().toISOString() };
  if (sources) patch.ai_sources = sources;
  const { error } = await supabase.from('tenders').update(patch).eq('id', tenderId);
  if (error) throw error;
}
