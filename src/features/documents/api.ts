// Work documents: one library per section, plus every record attachment,
// in the private "documents" bucket. list_documents() returns only what
// the section permissions let the caller see, with what they may do.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface LibraryDoc {
  id: string;
  module_key: string;
  module_label: string;
  module_route: string | null;
  entity_type: string;
  entity_id: string | null;
  category: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  valid_until: string | null;
  expiry: 'expired' | 'expiring' | 'valid' | null;
  site_id: string | null;
  site: string | null;
  created_at: string;
  created_by: string | null;
  uploaded_by: string | null;
  mine: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface DocList {
  total: number;
  categories: string[];
  rows: LibraryDoc[];
}

export interface DocFilters {
  module?: string | null;
  scope?: 'all' | 'section' | 'records';
  search?: string;
  category?: string | null;
  mine?: boolean;
  expiring?: boolean;
  limit?: number;
  offset?: number;
}

export const docKeys = {
  all: ['library-documents'] as const,
  list: (f: DocFilters) => ['library-documents', f] as const,
};

export async function fetchDocuments(f: DocFilters): Promise<DocList> {
  const { data, error } = await supabase.rpc('list_documents', {
    p_module: f.module ?? null,
    p_scope: f.scope ?? 'all',
    p_search: f.search?.trim() || null,
    p_category: f.category || null,
    p_mine: f.mine ?? false,
    p_expiring: f.expiring ?? false,
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
  });
  if (error) throw error;
  return data as DocList;
}

export function useDocumentList(f: DocFilters, enabled = true) {
  return useQuery({
    queryKey: docKeys.list(f),
    queryFn: () => fetchDocuments(f),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** The same rule the database applies: programs and anything a browser would run. */
export const BLOCKED_FILE = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|mjs|jar|sh|apk|dll|html?|xhtml|svg|php|asp|aspx|jsp|hta|lnk|reg)$/i;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const DOC_CATEGORIES = [
  'Report',
  'Photo',
  'Invoice / bill',
  'Purchase order',
  'Certificate',
  'Drawing / design',
  'Letter',
  'Agreement / contract',
  'Permit / approval',
  'Insurance',
  'Test report',
  'Other',
];

/** Uploads one file into a section's library. */
export async function uploadSectionDocument(opts: {
  moduleKey: string;
  file: File;
  category?: string | null;
  notes?: string | null;
  validUntil?: string | null;
  siteId?: string | null;
}) {
  if (BLOCKED_FILE.test(opts.file.name)) throw new Error(`${opts.file.name}: programs and web pages cannot be uploaded.`);
  if (opts.file.size > MAX_FILE_BYTES) throw new Error(`${opts.file.name} is larger than 50 MB.`);
  const safeName = opts.file.name.replace(/[^\w.\-() ]+/g, '_').slice(-120);
  const path = `${opts.moduleKey}/section/${crypto.randomUUID()}-${safeName}`;
  const up = await supabase.storage.from('documents').upload(path, opts.file, { contentType: opts.file.type || undefined });
  if (up.error) throw up.error;
  const { error } = await supabase.from('documents').insert({
    module_key: opts.moduleKey,
    entity_type: 'section',
    entity_id: null,
    category: opts.category || null,
    notes: opts.notes || null,
    valid_until: opts.validUntil || null,
    site_id: opts.siteId || null,
    file_name: opts.file.name,
    storage_path: path,
    mime_type: opts.file.type || null,
    size_bytes: opts.file.size,
  });
  if (error) {
    await supabase.storage.from('documents').remove([path]); // keep storage and table in step
    throw error;
  }
}

export async function updateDocument(id: string, patch: { category: string | null; notes: string | null; valid_until: string | null }) {
  const { error } = await supabase.from('documents').update(patch).eq('id', id);
  if (error) throw error;
}

export async function removeDocument(doc: Pick<LibraryDoc, 'id' | 'storage_path'>) {
  const { error } = await supabase.from('documents').delete().eq('id', doc.id);
  if (error) throw error;
  await supabase.storage.from('documents').remove([doc.storage_path]);
}

/** Opens the file: shown in the browser (preview) or saved (download). */
export async function openDocument(doc: Pick<LibraryDoc, 'storage_path' | 'file_name'>, download: boolean) {
  // Open the tab first: a popup opened after an await is often blocked.
  const tab = download ? null : window.open('about:blank', '_blank');
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, 300, download ? { download: doc.file_name } : undefined);
  if (error) {
    tab?.close();
    throw error;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else {
    window.location.assign(data.signedUrl);
  }
}

export const canPreview = (doc: Pick<LibraryDoc, 'mime_type' | 'file_name'>) =>
  /^(image\/|application\/pdf|text\/plain)/.test(doc.mime_type ?? '') || /\.(pdf|png|jpe?g|webp|gif|txt)$/i.test(doc.file_name);
