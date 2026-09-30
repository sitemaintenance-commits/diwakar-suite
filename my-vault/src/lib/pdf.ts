import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Lazy-load pdf.js (large) only when a PDF is actually opened or uploaded. */
export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Frees the worker-side document (pdf.js 6: lives on the loading task). */
  destroy: () => Promise<void>;
}

export async function openPdf(source: { url: string } | { data: ArrayBuffer }): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument('url' in source ? { url: source.url } : { data: new Uint8Array(source.data) });
  try {
    return { doc: await task.promise, destroy: () => task.destroy() };
  } catch (e) {
    void task.destroy();
    throw e;
  }
}

/** Render the first page to a small WebP/JPEG blob and return the page count. */
export async function pdfThumbnail(file: File, maxWidth = 360): Promise<{ blob: Blob | null; pageCount: number }> {
  const { doc, destroy } = await openPdf({ data: await file.arrayBuffer() });
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxWidth / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await canvasToBlob(canvas);
    return { blob, pageCount: doc.numPages };
  } finally {
    void destroy();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.8): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') return resolve(webp);
        canvas.toBlob((jpeg) => resolve(jpeg), 'image/jpeg', quality);
      },
      'image/webp',
      quality,
    );
  });
}
