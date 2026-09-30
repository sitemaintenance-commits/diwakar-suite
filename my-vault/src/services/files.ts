import { supabase } from '@/lib/supabase';
import { BUCKET } from '@/lib/env';
import type { Category, FilePage, FileQuery, VaultFile, VaultFileRow, VaultStats } from '@/types';
import { safeFileName } from '@/utils/format';

const COLUMNS =
  'id,user_id,original_name,display_name,storage_path,thumbnail_path,mime_type,extension,category,size_bytes,width,height,page_count,is_favorite,tags,description,created_at,updated_at,last_accessed_at,deleted_at';

/** Thumbnail URLs are short-lived; the query cache refreshes well before expiry. */
export const THUMB_URL_TTL = 60 * 60 * 2;
const PREVIEW_URL_TTL = 60 * 60;
const CHUNK = 100;

function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_*]/g, (c) => (c === '*' ? '' : `\\${c}`));
}

const DAY = 86400_000;
const MB = 1024 * 1024;

/** Which object to use as the gallery thumbnail for a row. */
function thumbSource(row: VaultFileRow): string | null {
  if (row.thumbnail_path) return row.thumbnail_path;
  const isImage = row.category === 'image' || row.category === 'screenshot';
  // SVGs and very small images can be shown directly.
  if (isImage && (row.extension === 'svg' || (row.size_bytes < 400 * 1024 && row.extension !== 'heic' && row.extension !== 'heif')))
    return row.storage_path;
  return null;
}

/** Batch-sign thumbnail URLs for a page of rows in a single request. */
export async function attachThumbUrls(rows: VaultFileRow[]): Promise<VaultFile[]> {
  const paths = [...new Set(rows.map(thumbSource).filter((p): p is string => Boolean(p)))];
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, THUMB_URL_TTL);
    if (error) console.warn('Could not sign thumbnails', error);
    data?.forEach((d) => {
      if (d.path && d.signedUrl) urlByPath.set(d.path, d.signedUrl);
    });
  }
  return rows.map((r) => {
    const src = thumbSource(r);
    return { ...r, thumbUrl: src ? (urlByPath.get(src) ?? null) : null };
  });
}

export async function listFiles(query: FileQuery, offset: number): Promise<FilePage> {
  let q = supabase.from('files').select(COLUMNS, offset === 0 ? { count: 'exact' } : undefined);

  q = query.scope === 'trash' ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);

  switch (query.scope) {
    case 'category':
      if (query.category) q = q.eq('category', query.category);
      break;
    case 'favorites':
      q = q.eq('is_favorite', true);
      break;
    case 'recent_uploaded':
      q = q.gte('created_at', new Date(Date.now() - 30 * DAY).toISOString());
      break;
    case 'recent_accessed':
      q = q.not('last_accessed_at', 'is', null);
      break;
  }

  if (query.type !== 'any' && query.scope !== 'category') q = q.eq('category', query.type);
  if (query.favoritesOnly) q = q.eq('is_favorite', true);

  const since: Record<string, number> = { today: 1, '7d': 7, '30d': 30, '365d': 365 };
  if (query.date !== 'any') {
    const days = since[query.date];
    const from = query.date === 'today' ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - days * DAY);
    q = q.gte('created_at', from.toISOString());
  }

  switch (query.size) {
    case 'small':
      q = q.lt('size_bytes', MB);
      break;
    case 'medium':
      q = q.gte('size_bytes', MB).lt('size_bytes', 10 * MB);
      break;
    case 'large':
      q = q.gte('size_bytes', 10 * MB).lt('size_bytes', 100 * MB);
      break;
    case 'huge':
      q = q.gte('size_bytes', 100 * MB);
      break;
  }

  // Server-side search on the trigram-indexed search_text column.
  // Every word must match (AND), in any field, as a substring.
  const terms = query.search.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const term of terms) {
    const safe = escapeLike(term);
    if (safe) q = q.ilike('search_text', `%${safe}%`);
  }

  const timeCol = query.scope === 'trash' ? 'deleted_at' : query.scope === 'recent_accessed' ? 'last_accessed_at' : 'created_at';
  switch (query.sort) {
    case 'newest':
      q = q.order(timeCol, { ascending: false });
      break;
    case 'oldest':
      q = q.order(timeCol, { ascending: true });
      break;
    case 'name_asc':
      q = q.order('display_name', { ascending: true });
      break;
    case 'name_desc':
      q = q.order('display_name', { ascending: false });
      break;
    case 'largest':
      q = q.order('size_bytes', { ascending: false });
      break;
    case 'smallest':
      q = q.order('size_bytes', { ascending: true });
      break;
  }
  q = q.order('id', { ascending: true }); // stable pagination

  const { data, error, count } = await q.range(offset, offset + query.pageSize - 1);
  if (error) throw error;
  const rows = (data ?? []) as VaultFileRow[];
  const items = await attachThumbUrls(rows);
  return {
    items,
    total: count ?? null,
    nextOffset: rows.length < query.pageSize ? null : offset + rows.length,
  };
}

export async function getStats(): Promise<VaultStats> {
  const { data, error } = await supabase.rpc('vault_stats');
  if (error) throw error;
  return data as VaultStats;
}

export async function getLargestFiles(limit = 8): Promise<VaultFile[]> {
  const { data, error } = await supabase
    .from('files')
    .select(COLUMNS)
    .is('deleted_at', null)
    .order('size_bytes', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return attachThumbUrls((data ?? []) as VaultFileRow[]);
}

export interface FilePatch {
  display_name?: string;
  tags?: string[];
  description?: string;
  is_favorite?: boolean;
  category?: Category;
}

export async function updateFile(id: string, patch: FilePatch): Promise<VaultFileRow> {
  const { data, error } = await supabase.from('files').update(patch).eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return data as VaultFileRow;
}

async function updateMany(ids: string[], patch: Record<string, unknown>) {
  for (const part of chunk(ids)) {
    const { error } = await supabase.from('files').update(patch).in('id', part);
    if (error) throw error;
  }
}

export const setFavorite = (ids: string[], value: boolean) => updateMany(ids, { is_favorite: value });
export const moveToTrash = (ids: string[]) => updateMany(ids, { deleted_at: new Date().toISOString() });
export const restoreFromTrash = (ids: string[]) => updateMany(ids, { deleted_at: null });

export function markAccessed(id: string) {
  void supabase
    .from('files')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', id)
    .then(({ error }) => {
      if (error) console.warn('Could not record access', error);
    });
}

type Deletable = Pick<VaultFileRow, 'id' | 'storage_path' | 'thumbnail_path'>;

/** Remove the stored objects first, then the metadata rows. */
export async function deletePermanently(files: Deletable[]): Promise<number> {
  let deleted = 0;
  for (const part of chunk(files)) {
    const paths = part.flatMap((f) => [f.storage_path, f.thumbnail_path].filter((p): p is string => Boolean(p)));
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) throw storageError;
    const { error } = await supabase.from('files').delete().in('id', part.map((f) => f.id));
    if (error) throw error;
    deleted += part.length;
  }
  return deleted;
}

export async function emptyTrash(): Promise<number> {
  let total = 0;
  // Bounded loop: 500 files per pass, up to 500k files.
  for (let pass = 0; pass < 1000; pass++) {
    const { data, error } = await supabase
      .from('files')
      .select('id,storage_path,thumbnail_path')
      .not('deleted_at', 'is', null)
      .limit(500);
    if (error) throw error;
    if (!data?.length) break;
    total += await deletePermanently(data as Deletable[]);
  }
  return total;
}

export async function getSignedUrl(path: string, opts: { download?: string; expiresIn?: number } = {}): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, opts.expiresIn ?? PREVIEW_URL_TTL, opts.download ? { download: safeFileName(opts.download) } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

function triggerDownload(href: string, filename?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadName(file: Pick<VaultFileRow, 'display_name' | 'extension'>): string {
  const name = file.display_name;
  return file.extension && !name.toLowerCase().endsWith(`.${file.extension}`) ? `${name}.${file.extension}` : name;
}

export async function downloadFile(file: VaultFileRow): Promise<void> {
  const url = await getSignedUrl(file.storage_path, { download: downloadName(file), expiresIn: 60 });
  triggerDownload(url);
  markAccessed(file.id);
}

export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

/** Bulk download as a single ZIP, built in the browser from signed URLs. */
export async function downloadAsZip(files: VaultFileRow[], onProgress?: (done: number) => void): Promise<void> {
  const total = files.reduce((s, f) => s + f.size_bytes, 0);
  if (total > MAX_ZIP_BYTES) throw new Error('Selection is larger than 1 GB. Please download fewer files at once.');
  const { downloadZip } = await import('client-zip');
  const used = new Set<string>();
  const uniqueName = (name: string) => {
    let candidate = safeFileName(name);
    const dot = candidate.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [candidate.slice(0, dot), candidate.slice(dot)] : [candidate, ''];
    for (let i = 1; used.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
  let done = 0;
  async function* entries() {
    for (const f of files) {
      const url = await getSignedUrl(f.storage_path, { expiresIn: 300 });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch ${f.display_name}`);
      yield { name: uniqueName(downloadName(f)), lastModified: new Date(f.created_at), input: res };
      onProgress?.(++done);
    }
  }
  const blob = await downloadZip(entries()).blob();
  const href = URL.createObjectURL(blob);
  triggerDownload(href, `my-vault-${new Date().toISOString().slice(0, 10)}.zip`);
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
