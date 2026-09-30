import { canvasToBlob, pdfThumbnail } from './pdf';
import type { Category } from '@/types';

export interface ThumbResult {
  blob: Blob | null;
  width?: number;
  height?: number;
  pageCount?: number;
  durationSeconds?: number;
}

const THUMB_SIZE = 480;
// SVGs are vector and tiny; they are rendered from the original.
const SKIP_EXT = ['svg'];
// Decoding very large images/PDFs just for a preview can exhaust memory on
// phones, so they get an icon instead. (Videos are never read into memory.)
const MAX_IMAGE_THUMB_BYTES = 60 * 1024 * 1024;
const MAX_PDF_THUMB_BYTES = 80 * 1024 * 1024;
const VIDEO_THUMB_TIMEOUT_MS = 12_000;

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img> decoding
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function imageThumbnail(file: File): Promise<ThumbResult> {
  const img = await decodeImage(file);
  try {
    const scale = Math.min(1, THUMB_SIZE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: null, width: img.width, height: img.height };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, w, h);
    return { blob: await canvasToBlob(canvas), width: img.width, height: img.height };
  } finally {
    img.close();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function once(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      el.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      el.removeEventListener(event, ok);
      reject(new Error(`Video cannot be decoded in this browser (code ${el.error?.code ?? '?'})`));
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

/**
 * Grab one frame of a video for its thumbnail. The <video> element reads the
 * file through a blob: URL, so the browser only loads the bytes it needs for
 * the metadata and that frame; the video is never read into memory. Decoding
 * happens off the main thread. Codecs the browser can't decode (e.g. HEVC in
 * some browsers, AVI/WMV) time out or error and fall back to an icon, while
 * the duration is still kept when the metadata could be read.
 */
async function videoThumbnail(file: File): Promise<ThumbResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.preload = 'metadata';
  let durationSeconds: number | undefined;
  try {
    const metadata = once(video, 'loadedmetadata');
    video.src = url;
    video.load();
    await withTimeout(metadata, VIDEO_THUMB_TIMEOUT_MS, 'Timed out reading video metadata');
    if (Number.isFinite(video.duration) && video.duration > 0) durationSeconds = Math.round(video.duration);
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return { blob: null, durationSeconds };

    // Skip the first instant, which is often a black frame.
    // Seeking (rather than waiting for playback) makes the browser decode a
    // frame even with preload="metadata".
    const frameReady = once(video, 'seeked');
    video.currentTime = durationSeconds ? Math.min(1, video.duration / 4) : 0.1;
    await withTimeout(frameReady, VIDEO_THUMB_TIMEOUT_MS, 'Timed out decoding a video frame');

    const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: null, width, height, durationSeconds };
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { blob: await canvasToBlob(canvas), width, height, durationSeconds };
  } catch (e) {
    console.warn('Video thumbnail failed for', file.name, e);
    return { blob: null, durationSeconds };
  } finally {
    video.removeAttribute('src');
    video.load(); // releases the decoder
    URL.revokeObjectURL(url);
  }
}

/**
 * Generate a small preview in the browser so galleries never download
 * full-resolution originals. Failures are non-fatal (e.g. HEIC on Chrome):
 * the UI falls back to a file-type icon.
 */
export async function createThumbnail(file: File, category: Category, extension: string): Promise<ThumbResult> {
  try {
    if ((category === 'image' || category === 'screenshot') && !SKIP_EXT.includes(extension) && file.size <= MAX_IMAGE_THUMB_BYTES) {
      return await imageThumbnail(file);
    }
    if (category === 'pdf' && file.size <= MAX_PDF_THUMB_BYTES) {
      return await pdfThumbnail(file);
    }
    if (category === 'video') {
      return await videoThumbnail(file);
    }
  } catch (e) {
    console.warn('Thumbnail generation failed for', file.name, e);
  }
  return { blob: null };
}
