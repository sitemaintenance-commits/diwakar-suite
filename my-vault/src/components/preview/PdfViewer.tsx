import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Download, Maximize, Minimize, Minus, Plus } from 'lucide-react';
import { openPdf, type OpenedPdf } from '@/lib/pdf';
import { getErrorMessage } from '@/lib/errors';
import { Spinner } from '@/components/ui/misc';
import { PreviewError } from './PreviewFallback';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function PdfViewer({ url, onDownload }: { url: string; onDownload: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTask = useRef<RenderTask | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoomIdx, setZoomIdx] = useState(2);
  const [rendering, setRendering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [width, setWidth] = useState(0);

  // Load document
  useEffect(() => {
    let cancelled = false;
    let loaded: OpenedPdf | null = null;
    setDoc(null);
    setError(null);
    setPage(1);
    openPdf({ url })
      .then((opened) => {
        if (cancelled) return void opened.destroy();
        loaded = opened;
        setDoc(opened.doc);
      })
      .catch((e) => !cancelled && setError(getErrorMessage(e, 'Could not open this PDF.')));
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [url]);

  // Track available width for fit-to-width rendering
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render current page
  useEffect(() => {
    if (!doc || !canvasRef.current || !width) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      try {
        renderTask.current?.cancel();
        const p = await doc.getPage(page);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const fit = Math.min((width - 32) / base.width, 2);
        const scale = fit * ZOOMS[zoomIdx];
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current!;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = p.render({ canvas, viewport });
        renderTask.current = task;
        await task.promise;
      } catch (e) {
        if ((e as { name?: string })?.name !== 'RenderingCancelledException' && !cancelled) setError(getErrorMessage(e, 'Could not render this page.'));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      renderTask.current?.cancel();
    };
  }, [doc, page, zoomIdx, width]);

  useEffect(() => setPageInput(String(page)), [page]);

  const total = doc?.numPages ?? 0;
  const go = useCallback((p: number) => {
    if (!total) return;
    setPage(Math.min(total, Math.max(1, p)));
    scrollRef.current?.scrollTo({ top: 0 });
  }, [total]);

  // Keyboard: arrows change page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(page + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, page]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch {
      /* Fullscreen not allowed (e.g. iOS Safari) */
    }
  };

  if (error) return <PreviewError message={error} onDownload={onDownload} />;

  const btn = 'inline-flex size-9 items-center justify-center rounded-lg hover:bg-white/10 disabled:opacity-40';

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col bg-neutral-900">
      <div ref={scrollRef} className="scrollbar-thin relative flex-1 overflow-auto">
        {(!doc || rendering) && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <Spinner className="size-7 text-white" />
          </div>
        )}
        <div className="flex min-h-full min-w-fit justify-center p-4">
          <canvas ref={canvasRef} className="h-fit bg-white shadow-2xl" />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t border-white/10 bg-black/60 px-2 py-2 text-white">
        <button type="button" className={btn} onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-5" />
        </button>
        <form
          className="flex items-center gap-1.5 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(pageInput, 10);
            if (Number.isFinite(n)) go(n);
            else setPageInput(String(page));
          }}
        >
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onBlur={() => setPageInput(String(page))}
            inputMode="numeric"
            aria-label="Page number"
            className="h-8 w-12 rounded-md border border-white/20 bg-white/10 text-center tabular-nums outline-none focus:border-orange-400"
          />
          <span className="text-white/70">/ {total || '–'}</span>
        </form>
        <button type="button" className={btn} onClick={() => go(page + 1)} disabled={!total || page >= total} aria-label="Next page">
          <ChevronRight className="size-5" />
        </button>
        <span className="mx-1 h-6 w-px bg-white/15" />
        <button type="button" className={btn} onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(ZOOMS[zoomIdx] * 100)}%</span>
        <button type="button" className={btn} onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIdx === ZOOMS.length - 1} aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <span className="mx-1 h-6 w-px bg-white/15" />
        <button type="button" className={btn} onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </button>
        <button type="button" className={btn} onClick={onDownload} aria-label="Download PDF">
          <Download className="size-4" />
        </button>
      </div>
    </div>
  );
}
