import { supabase } from '@/lib/supabase';
import { BUCKET, env } from '@/lib/env';
import { BLOCKED_EXTENSIONS, CATEGORIES, getExtension, isImageFile } from '@/lib/categories';
import { createThumbnail } from '@/lib/thumbnails';
import type { Category, VaultFileRow } from '@/types';
import { formatBytes } from '@/utils/format';

export class UploadError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Client-side validation. The bucket size limit, storage policies and table
 *  constraints enforce the same rules on the server. */
export function validateFile(file: File, requested: Category | 'auto'): string | null {
  const ext = getExtension(file.name);
  if (file.size === 0) return 'File is empty.';
  if (file.size > env.maxUploadBytes) return `File is too large (max ${formatBytes(env.maxUploadBytes, 0)}).`;
  if (BLOCKED_EXTENSIONS.includes(ext)) return 'Executable files are not allowed.';
  if (file.name.length > 255) return 'File name is too long.';
  if (requested === 'screenshot' && !isImageFile(file)) return 'Only images can be added to Screenshots.';
  return null;
}

/**
 * Upload via XHR (instead of supabase-js fetch) to get real progress events
 * and cancellation. Authorisation is the user's JWT; storage policies verify
 * that the first path segment equals auth.uid().
 */
export async function uploadObject(
  path: string,
  body: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UploadError('Your session has expired. Please sign in again.', 401);

  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const url = `${env.supabaseUrl}/storage/v1/object/${BUCKET}/${encoded}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', env.supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('Cache-Control', 'max-age=3600');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status}).`;
      let status = xhr.status;
      try {
        const res = JSON.parse(xhr.responseText) as { message?: string; error?: string; statusCode?: string };
        message = res.message || res.error || message;
        if (res.statusCode) status = Number(res.statusCode) || status;
      } catch {
        /* non-JSON body */
      }
      if (status === 413) message = 'File is too large for the storage bucket limit.';
      reject(new UploadError(message, status));
    };
    xhr.onerror = () => reject(new UploadError('Network error during upload.'));
    xhr.onabort = () => reject(new DOMException('Upload canceled', 'AbortError'));
    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

/**
 * Full pipeline for one file:
 * object upload → thumbnail upload → metadata row. If the row cannot be
 * written the uploaded objects are removed so nothing is orphaned.
 */
export async function uploadVaultFile(
  file: File,
  category: Category,
  userId: string,
  onProgress: (percent: number, phase: 'uploading' | 'processing') => void,
  signal: AbortSignal,
): Promise<VaultFileRow> {
  const id = crypto.randomUUID();
  const ext = getExtension(file.name);
  const folder = CATEGORIES[category].folder;
  const storagePath = `${userId}/${folder}/${id}${ext ? `.${ext}` : ''}`;
  const contentType = file.type || 'application/octet-stream';

  // Thumbnail work runs in parallel with the network upload.
  const thumbPromise = createThumbnail(file, category, ext);

  await uploadObject(storagePath, file, contentType, (f) => onProgress(Math.round(f * 95), 'uploading'), signal);
  onProgress(96, 'processing');

  let thumbnailPath: string | null = null;
  const thumb = await thumbPromise;
  if (thumb.blob && !signal.aborted) {
    const thumbExt = thumb.blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}/thumbs/${id}.${thumbExt}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, thumb.blob, { contentType: thumb.blob.type, upsert: false });
    if (!error) thumbnailPath = path;
    else console.warn('Thumbnail upload failed', error);
  }

  const cleanup = () =>
    supabase.storage.from(BUCKET).remove([storagePath, ...(thumbnailPath ? [thumbnailPath] : [])]);

  if (signal.aborted) {
    await cleanup();
    throw new DOMException('Upload canceled', 'AbortError');
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || file.name;
  const { data, error } = await supabase
    .from('files')
    .insert({
      id,
      user_id: userId,
      original_name: file.name.slice(0, 255),
      display_name: baseName.slice(0, 255),
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      mime_type: contentType,
      extension: ext,
      category,
      size_bytes: file.size,
      width: thumb.width ?? null,
      height: thumb.height ?? null,
      page_count: thumb.pageCount ?? null,
    })
    .select('*')
    .single();

  if (error) {
    await cleanup();
    throw error;
  }
  onProgress(100, 'processing');
  return data as VaultFileRow;
}
