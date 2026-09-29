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
  notes: string;
}

async function callTenderAi<T>(body: Record<string, unknown>): Promise<T> {
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
