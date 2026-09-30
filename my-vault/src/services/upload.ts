import type { DetailedError, PreviousUpload } from 'tus-js-client';
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
  if (file.size > env.maxUploadBytes)
    return `File is too large (${formatBytes(file.size)}). This vault accepts up to ${formatBytes(env.maxUploadBytes, 0)} per file.`;
  if (BLOCKED_EXTENSIONS.includes(ext)) return 'Executable files are not allowed.';
  if (file.name.length > 255) return 'File name is too long.';
  if (requested === 'screenshot' && !isImageFile(file)) return 'Only images can be added to Screenshots.';
  return null;
}

/**
 * Files above this size use Supabase's resumable (TUS) endpoint, as Supabase
 * recommends for anything over 6 MB. Smaller files use one plain request.
 */
export const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
/** Supabase requires exactly 6 MB chunks for resumable uploads. */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
/** tus-js-client is only needed for large files, so it loads on first use. */
const loadTus = () => import('tus-js-client');

/** Supabase keeps an unfinished resumable upload for 24 hours. */
const TUS_RESUME_WINDOW_MS = 23 * 60 * 60 * 1000;

type ProgressFn = (fraction: number, bytesSent: number) => void;

/** A fresh access token. getSession() refreshes an expired session, which
 *  matters for long video uploads that outlive the 1-hour JWT. */
async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new UploadError('Your session has expired. Please sign in again.', 401);
  return token;
}

/** Turn a Storage error body ({ statusCode, message } JSON) into an UploadError. */
function storageError(status: number, body: string): UploadError {
  let message = `Upload failed (${status}).`;
  try {
    const res = JSON.parse(body) as { message?: string; error?: string; statusCode?: string };
    message = res.message || res.error || message;
    if (res.statusCode) status = Number(res.statusCode) || status;
  } catch {
    /* non-JSON body */
  }
  if (status === 413 || /maximum allowed size|payload too large/i.test(message))
    return new UploadError('File is larger than the storage bucket allows. Raise the bucket size limit to upload it.', 413);
  if (status === 409 || /already exists/i.test(message)) return new UploadError('A file with this storage path already exists.', 409);
  return new UploadError(message, status);
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
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<void> {
  const token = await accessToken();

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
      if (e.lengthComputable) onProgress?.(e.loaded / e.total, e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      reject(storageError(xhr.status, xhr.responseText));
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

/** Object paths of uploads running in this tab. Two identical files queued
 *  together must not resume into the same object. */
const inFlight = new Set<string>();

/** Fingerprint used to find an unfinished upload of the same file. It
 *  includes the user id so accounts on a shared device never mix. */
const fingerprintFor = (userId: string) => async (file: File | Blob) => {
  const f = file as File;
  return ['vault', userId, f.name, f.type, f.size, f.lastModified].join('|');
};

/**
 * An unfinished resumable upload of this exact file (same name, size and
 * modified time) started in this browser within the last 23 hours, e.g. one
 * that failed on a bad connection or whose tab was closed. The returned
 * upload's path is reserved in `inFlight` before this returns; the caller
 * releases it.
 */
async function findResumableUpload(file: File, userId: string, folder: string): Promise<PreviousUpload | null> {
  try {
    const tus = await loadTus();
    if (!tus.canStoreURLs) return null;
    const probe = new tus.Upload(file, { endpoint: '', fingerprint: fingerprintFor(userId) });
    const previous = await probe.findPreviousUploads();
    const fresh = previous
      .filter((p) => {
        const name = p.metadata?.objectName ?? '';
        const age = Date.now() - new Date(p.creationTime).getTime();
        return name.startsWith(`${userId}/${folder}/`) && !inFlight.has(name) && age < TUS_RESUME_WINDOW_MS;
      })
      .sort((a, b) => b.creationTime.localeCompare(a.creationTime));
    // Reserve synchronously (no await since the filter) so a second copy of
    // the same file can't pick this upload too.
    const pick = fresh[0] ?? null;
    if (pick) inFlight.add(pick.metadata.objectName);
    // Forget expired entries so localStorage doesn't grow forever.
    for (const p of previous) {
      if (Date.now() - new Date(p.creationTime).getTime() >= TUS_RESUME_WINDOW_MS)
        void tus.defaultOptions.urlStorage.removeUpload(p.urlStorageKey).catch(() => undefined);
    }
    return pick;
  } catch {
    return null;
  }
}

/**
 * Resumable upload through Supabase Storage's TUS endpoint, in 6 MB chunks.
 * Network drops are retried automatically. A failed or interrupted upload
 * can be continued (Retry, or re-selecting the same file within 24 hours).
 * The same storage RLS policies apply as for a normal upload.
 */
async function uploadObjectResumable(
  path: string,
  file: File,
  contentType: string,
  userId: string,
  previous: PreviousUpload | null,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<void> {
  await accessToken(); // fail fast with a clear message when signed out
  const tus = await loadTus();
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${env.supabaseUrl}/storage/v1/upload/resumable`,
      chunkSize: TUS_CHUNK_SIZE,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: fingerprintFor(userId),
      headers: { apikey: env.supabaseAnonKey, 'x-upsert': 'false' },
      metadata: { bucketName: BUCKET, objectName: path, contentType, cacheControl: '3600' },
      // Fresh token on every chunk so long uploads survive JWT expiry.
      onBeforeRequest: async (req) => {
        req.setHeader('Authorization', `Bearer ${await accessToken()}`);
      },
      onProgress: (sent, total) => onProgress(total ? sent / total : 0, sent),
      onSuccess: () => resolve(),
      onError: (err) => {
        if (signal.aborted) return;
        const res = (err as DetailedError).originalResponse;
        if (res) reject(storageError(res.getStatus(), res.getBody()));
        else reject(new UploadError('Network error during upload. Retry to continue from where it stopped.'));
      },
    });
    if (previous) upload.resumeFromPreviousUpload(previous);
    if (signal.aborted) return reject(new DOMException('Upload canceled', 'AbortError'));
    signal.addEventListener(
      'abort',
      () => {
        // Cancel = discard: terminate the server-side upload and forget it.
        void upload.abort(true).catch(() => undefined);
        reject(new DOMException('Upload canceled', 'AbortError'));
      },
      { once: true },
    );
    upload.start();
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
  onProgress: (percent: number, phase: 'uploading' | 'processing', bytesSent?: number) => void,
  signal: AbortSignal,
): Promise<VaultFileRow> {
  const ext = getExtension(file.name);
  const folder = CATEGORIES[category].folder;
  const contentType = file.type || guessMimeType(ext);
  const resumable = file.size > RESUMABLE_THRESHOLD && (await loadTus()).isSupported;

  // Continue an unfinished upload of the same file under its original path.
  const previous = resumable ? await findResumableUpload(file, userId, folder) : null;
  const previousName = previous?.metadata?.objectName.split('/').pop() ?? '';
  const previousId = previousName.replace(/\.[^.]*$/, '');
  const id = /^[0-9a-f-]{36}$/.test(previousId) ? previousId : crypto.randomUUID();
  const storagePath = `${userId}/${folder}/${id}${ext ? `.${ext}` : ''}`;
  inFlight.add(storagePath);
  if (previous && previous.metadata.objectName !== storagePath) inFlight.delete(previous.metadata.objectName);
  try {
    return await storeFile(file, category, userId, id, ext, storagePath, contentType, resumable, previous, onProgress, signal);
  } finally {
    inFlight.delete(storagePath);
  }
}

async function storeFile(
  file: File,
  category: Category,
  userId: string,
  id: string,
  ext: string,
  storagePath: string,
  contentType: string,
  resumable: boolean,
  previous: PreviousUpload | null,
  onProgress: (percent: number, phase: 'uploading' | 'processing', bytesSent?: number) => void,
  signal: AbortSignal,
): Promise<VaultFileRow> {
  // Thumbnail work runs in parallel with the network upload.
  const thumbPromise = createThumbnail(file, category, ext);

  const progress: ProgressFn = (f, sent) => onProgress(Math.round(f * 95), 'uploading', sent);
  if (resumable) {
    await uploadObjectResumable(storagePath, file, contentType, userId, previous?.metadata.objectName === storagePath ? previous : null, progress, signal);
  } else {
    await uploadObject(storagePath, file, contentType, progress, signal);
  }
  onProgress(96, 'processing', file.size);

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
      duration_seconds: thumb.durationSeconds ?? null,
    })
    .select('*')
    .single();

  if (error) {
    // A unique violation means a row already points at this object (a resumed
    // upload that had in fact finished). Deleting it would break that row.
    if (error.code === '23505') throw new UploadError('This file is already in your vault.', 409);
    await cleanup();
    throw error;
  }
  onProgress(100, 'processing');
  return data as VaultFileRow;
}

/** Some browsers (notably Windows for .mov/.mkv, and Android for some camera
 *  files) report an empty MIME type. Fill in the common ones so previews get
 *  a usable Content-Type from Storage. */
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function guessMimeType(ext: string): string {
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
