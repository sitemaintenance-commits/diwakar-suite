import { canvasToBlob, pdfThumbnail } from './pdf';
import type { Category } from '@/types';

export interface ThumbResult {
  blob: Blob | null;
  width?: number;
  height?: number;
  pageCount?: number;
}

const THUMB_SIZE = 480;
// SVGs are vector and tiny; they are rendered from the original.
const SKIP_EXT = ['svg'];

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

/**
 * Generate a small preview in the browser so galleries never download
 * full-resolution originals. Failures are non-fatal (e.g. HEIC on Chrome):
 * the UI falls back to a file-type icon.
 */
export async function createThumbnail(file: File, category: Category, extension: string): Promise<ThumbResult> {
  try {
    if ((category === 'image' || category === 'screenshot') && !SKIP_EXT.includes(extension)) {
      return await imageThumbnail(file);
    }
    if (category === 'pdf') {
      return await pdfThumbnail(file);
    }
  } catch (e) {
    console.warn('Thumbnail generation failed for', file.name, e);
  }
  return { blob: null };
}
