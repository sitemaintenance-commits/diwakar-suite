import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { ImageOff, Minus, Plus, RotateCcw } from 'lucide-react';
import type { VaultFile } from '@/types';
import { Spinner } from '@/components/ui/misc';

const MIN = 1;
const MAX = 6;

export function ImageViewer({ file, url, onError }: { file: VaultFile; url: string; onError: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
    setFailed(false);
  }, [url]);

  const setZoomClamped = (z: number) => {
    const next = Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
    setZoom(next);
    if (next === 1) setOffset({ x: 0, y: 0 });
  };

  const onWheel = (e: WheelEvent) => {
    setZoomClamped(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (zoom === 1) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/80">
        <ImageOff className="size-10" />
        <p className="text-sm">This image format can’t be displayed by your browser{file.extension === 'heic' ? ' (HEIC is supported in Safari)' : ''}.</p>
        <p className="text-xs text-white/50">Use Download to open it with another app.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden select-none" onWheel={onWheel}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          {file.thumbUrl ? (
            <img src={file.thumbUrl} alt="" className="max-h-full max-w-full scale-100 object-contain opacity-60 blur-sm" />
          ) : null}
          <Spinner className="absolute size-7 text-white" />
        </div>
      )}
      <div
        className="flex h-full w-full items-center justify-center p-2 sm:p-6"
        style={{ cursor: zoom > 1 ? (drag.current ? 'grabbing' : 'grab') : 'zoom-in', touchAction: zoom > 1 ? 'none' : 'auto' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setZoomClamped(zoom > 1 ? 1 : 2.5)}
      >
        <img
          src={url}
          alt={file.display_name}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            onError();
          }}
          className="max-h-full max-w-full object-contain transition-transform duration-150 ease-out"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            opacity: loaded ? 1 : 0,
          }}
        />
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-black/60 p-1 text-white backdrop-blur">
        <button type="button" className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-40" onClick={() => setZoomClamped(zoom / 1.25)} disabled={zoom <= MIN} aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-40" onClick={() => setZoomClamped(zoom * 1.25)} disabled={zoom >= MAX} aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button type="button" className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-40" onClick={() => setZoomClamped(1)} disabled={zoom === 1} aria-label="Reset zoom">
          <RotateCcw className="size-4" />
        </button>
      </div>
    </div>
  );
}
