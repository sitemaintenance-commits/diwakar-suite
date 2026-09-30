import { useRef, useState, type DragEvent } from 'react';
import { CloudUpload, FolderOpen, FolderUp, Images, MonitorSmartphone, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useUploads } from '@/context/UploadContext';
import { env } from '@/lib/env';
import type { Category } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';

/**
 * Folder picking is an optional desktop extra. Phones don't support it in a
 * useful way, so it's offered only with a mouse/trackpad and when the browser
 * has the (non-standard but widely supported) webkitdirectory attribute.
 */
const canPickFolder =
  typeof window !== 'undefined' &&
  'webkitdirectory' in document.createElement('input') &&
  (window.matchMedia?.('(pointer: fine)').matches ?? false);

/** OS clutter that comes along when a whole folder is picked. */
const isJunkFile = (f: File) => f.name.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(f.name);

export function UploadModal() {
  const { modal, closeUpload, addFiles } = useUploads();
  const [target, setTarget] = useState<'auto' | 'screenshot'>('auto');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [lastModal, setLastModal] = useState(modal);

  // Sync target with where the modal was opened from (e.g. Screenshots page).
  if (modal !== lastModal) {
    setLastModal(modal);
    if (modal.open) setTarget(modal.category === 'screenshot' ? 'screenshot' : 'auto');
  }

  const submit = (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    addFiles(files, target as Category | 'auto');
    closeUpload();
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>, fromFolder = false) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    submit(fromFolder ? files.filter((f) => !isJunkFile(f)) : files);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    submit(e.dataTransfer.files);
  };

  return (
    <Modal open={modal.open} onClose={closeUpload} title="Upload files" description="Files are stored privately and are only accessible to you." size="lg">
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Upload destination" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              { v: 'auto', icon: Sparkles, title: 'Auto-detect', desc: 'Sort into Images, PDFs, Documents, Videos or Other' },
              { v: 'screenshot', icon: MonitorSmartphone, title: 'Screenshots', desc: 'Keep images separate from your photos' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={target === o.v}
              onClick={() => setTarget(o.v)}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                target === o.v ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line hover:border-line-strong',
              )}
            >
              <o.icon className={cn('mt-0.5 size-5 shrink-0', target === o.v ? 'text-brand' : 'text-muted')} />
              <span>
                <span className="block text-sm font-medium text-ink">{o.title}</span>
                <span className="block text-xs text-muted">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={(e) => e.target === e.currentTarget && inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:cursor-pointer sm:px-6 sm:py-12',
            dragging ? 'border-brand bg-brand-soft' : 'border-line-strong sm:hover:border-brand/60 sm:hover:bg-subtle/60',
          )}
        >
          <div className="pointer-events-none mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <CloudUpload className="size-7" />
          </div>
          <p className="pointer-events-none text-sm font-semibold text-ink">
            <span className="hidden sm:inline">Drag & drop files here, or choose them below</span>
            <span className="sm:hidden">Choose files from your phone</span>
          </p>
          <p className="pointer-events-none mt-1 text-xs text-muted">
            Photos, videos, PDFs and documents · as many as you like · up to {formatBytes(env.maxUploadBytes, 0)} each
          </p>
          <div className="mt-4 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
            <Button icon={<FolderOpen className="size-4" />} onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
            <Button variant="secondary" icon={<Images className="size-4" />} onClick={() => mediaRef.current?.click()}>
              {target === 'screenshot' ? 'From photo library' : 'Photos & videos'}
            </Button>
            {canPickFolder && (
              <Button variant="secondary" icon={<FolderUp className="size-4" />} onClick={() => folderRef.current?.click()}>
                Choose folder
              </Button>
            )}
          </div>
        </div>
        {/* All files: on phones this opens the OS picker (Photos, Camera, Files / Drive). */}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={target === 'screenshot' ? 'image/*' : undefined}
          onChange={(e) => onPicked(e)}
        />
        {/* Media only: jumps straight to the photo/video gallery on most phones. */}
        <input
          ref={mediaRef}
          type="file"
          multiple
          hidden
          accept={target === 'screenshot' ? 'image/*' : 'image/*,video/*'}
          onChange={(e) => onPicked(e)}
        />
        {canPickFolder && (
          <input
            ref={(el) => {
              folderRef.current = el;
              el?.setAttribute('webkitdirectory', '');
            }}
            type="file"
            multiple
            hidden
            onChange={(e) => onPicked(e, true)}
          />
        )}
        <p className="text-xs text-faint">
          Uploads continue in the background — you can keep browsing while they finish. Large videos upload in resumable chunks, so a
          dropped connection can be resumed. Keep this tab open until they finish. Executable files (.exe, .bat, …) are blocked.
        </p>
      </div>
    </Modal>
  );
}
