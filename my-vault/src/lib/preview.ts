import type { VaultFileRow } from '@/types';

export type PreviewKind = 'image' | 'pdf' | 'text' | 'docx' | 'video' | 'audio' | 'none';

const BROWSER_IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'heic', 'heif'];
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml'];
/**
 * Containers no mainstream browser plays. These go straight to the
 * download fallback. Everything else in the Videos category is tried in a
 * <video> element; if the codec isn't supported (e.g. HEVC outside Safari),
 * the player shows a download fallback instead (see MediaViewer).
 */
const UNPLAYABLE_VIDEO_EXT = ['avi', 'wmv', 'flv', 'mpg', 'mpeg', 'mts', 'm2ts', '3g2'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'qt', 'm4v', 'ogv', 'mkv', '3gp'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'];

/** Largest text file rendered inline (bigger files are offered as download). */
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
export const MAX_DOCX_PREVIEW_BYTES = 25 * 1024 * 1024;

/**
 * Decide how (and whether) a file can be previewed in the browser.
 * DOC, RTF, ODT, XLS(X), PPT(X) have no reliable in-browser renderer, so they
 * get a details panel with download/open instead of a fake preview.
 */
export function getPreviewKind(file: Pick<VaultFileRow, 'extension' | 'mime_type' | 'category' | 'size_bytes'>): PreviewKind {
  const ext = file.extension;
  if (file.category === 'pdf' || ext === 'pdf') return 'pdf';
  if ((file.category === 'image' || file.category === 'screenshot') && BROWSER_IMAGES.includes(ext)) return 'image';
  if (TEXT_EXT.includes(ext) && file.size_bytes <= MAX_TEXT_PREVIEW_BYTES) return 'text';
  if (ext === 'docx' && file.size_bytes <= MAX_DOCX_PREVIEW_BYTES) return 'docx';
  if (UNPLAYABLE_VIDEO_EXT.includes(ext)) return 'none';
  if (file.category === 'video' || VIDEO_EXT.includes(ext) || file.mime_type.startsWith('video/')) return 'video';
  if (AUDIO_EXT.includes(ext) || file.mime_type.startsWith('audio/')) return 'audio';
  return 'none';
}
