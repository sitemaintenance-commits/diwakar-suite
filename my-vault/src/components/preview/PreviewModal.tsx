import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Info, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSignedUrl, markAccessed } from '@/services/files';
import { getPreviewKind } from '@/lib/preview';
import { getErrorMessage } from '@/lib/errors';
import { useFileActions } from '@/context/FileActionsContext';
import { Spinner } from '@/components/ui/misc';
import type { VaultFile } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';
import { ImageViewer } from './ImageViewer';
import { PdfViewer } from './PdfViewer';
import { DocxViewer, MediaViewer, TextViewer } from './DocumentViewers';
import { FileInfoPanel } from './FileInfoPanel';
import { NoPreview, PreviewError } from './PreviewFallback';

interface Props {
  files: VaultFile[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
  /** Called near the end of the list so the gallery can page in more files. */
  onNeedMore?: () => void;
  /** Total matching files on the server (may exceed the loaded list). */
  total?: number | null;
}

export function PreviewModal({ files, index, onIndexChange, onNeedMore, total }: Props) {
  const file = index !== null ? files[index] : undefined;
  const open = Boolean(file);
  const actions = useFileActions();
  const [showInfo, setShowInfo] = useState(() => window.innerWidth >= 1280);
  const kind = file ? getPreviewKind(file) : 'none';

  const signed = useQuery({
    queryKey: ['signed-url', file?.storage_path],
    queryFn: () => getSignedUrl(file!.storage_path),
    enabled: Boolean(file) && kind !== 'none',
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    retry: 1,
  });

  // Record access for the Recent page.
  useEffect(() => {
    if (file && !file.deleted_at) markAccessed(file.id);
  }, [file?.id]);

  // Page in more results when approaching the end.
  useEffect(() => {
    if (index !== null && index >= files.length - 3) onNeedMore?.();
  }, [index, files.length, onNeedMore]);

  // If the current file disappears (trashed/deleted), close or clamp.
  useEffect(() => {
    if (index !== null && index >= files.length) onIndexChange(files.length ? files.length - 1 : null);
  }, [index, files.length, onIndexChange]);

  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < files.length - 1;
  const prev = () => hasPrev && onIndexChange(index! - 1);
  const next = () => hasNext && onIndexChange(index! + 1);
  const close = () => onIndexChange(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role="dialog"][data-nested]')) return;
      if (document.querySelector('[role="dialog"]:not([data-preview])')) return; // an edit/confirm dialog is on top
      if (e.key === 'Escape') close();
      if (kind === 'pdf') return; // arrows page through the PDF instead
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  });

  if (!file) return null;

  const download = () => void actions.download(file);
  const openTab = async () => {
    try {
      window.open(await getSignedUrl(file.storage_path, { expiresIn: 300 }), '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error('Could not open file', { description: getErrorMessage(err) });
    }
  };

  let body: React.ReactNode;
  if (kind === 'none') body = <NoPreview file={file} onDownload={download} onOpenTab={openTab} />;
  else if (signed.isError) body = <PreviewError message={getErrorMessage(signed.error)} onDownload={download} />;
  else if (!signed.data)
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-7 text-white" />
      </div>
    );
  else if (kind === 'image') body = <ImageViewer key={file.id} file={file} url={signed.data} onError={() => undefined} />;
  else if (kind === 'pdf') body = <PdfViewer key={file.id} url={signed.data} onDownload={download} />;
  else if (kind === 'text') body = <TextViewer key={file.id} url={signed.data} onDownload={download} />;
  else if (kind === 'docx') body = <DocxViewer key={file.id} url={signed.data} onDownload={download} />;
  else body = <MediaViewer key={file.id} url={signed.data} kind={kind} />;

  const hbtn = 'inline-flex size-9 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-neutral-950/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Preview ${file.display_name}`} data-preview>
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{file.display_name}</p>
          <p className="truncate text-xs text-white/50">
            {index! + 1} of {Math.max(total ?? 0, files.length).toLocaleString()} · .{file.extension || 'file'} · {formatBytes(file.size_bytes)}
          </p>
        </div>
        {!file.deleted_at && (
          <button type="button" className={hbtn} onClick={() => void actions.toggleFavorite(file)} aria-label={file.is_favorite ? 'Remove from favorites' : 'Add to favorites'} title="Favorite">
            <Star className={cn('size-[18px]', file.is_favorite && 'text-amber-400')} fill={file.is_favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        <button type="button" className={hbtn} onClick={download} aria-label="Download" title="Download">
          <Download className="size-[18px]" />
        </button>
        <button type="button" className={cn(hbtn, 'hidden sm:inline-flex')} onClick={openTab} aria-label="Open in new tab" title="Open in new tab">
          <ExternalLink className="size-[18px]" />
        </button>
        <button type="button" className={cn(hbtn, showInfo && 'bg-white/10 text-white')} onClick={() => setShowInfo((s) => !s)} aria-label="File information" aria-pressed={showInfo} title="File information">
          <Info className="size-[18px]" />
        </button>
        <button type="button" className={hbtn} onClick={close} aria-label="Close preview" title="Close (Esc)">
          <X className="size-5" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-0 flex-1">
          {body}
          {hasPrev && (
            <button type="button" onClick={prev} aria-label="Previous file" className="absolute top-1/2 left-2 z-20 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 sm:left-4 sm:size-11">
              <ChevronLeft className="size-6" />
            </button>
          )}
          {hasNext && (
            <button type="button" onClick={next} aria-label="Next file" className="absolute top-1/2 right-2 z-20 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 sm:right-4 sm:size-11">
              <ChevronRight className="size-6" />
            </button>
          )}
        </div>
        {showInfo && (
          <aside className="max-h-[45vh] shrink-0 border-t border-white/10 bg-neutral-900/80 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
            <FileInfoPanel file={file} onEdit={file.deleted_at ? undefined : () => actions.edit(file, 'tags')} />
          </aside>
        )}
      </div>
    </div>,
    document.body,
  );
}
