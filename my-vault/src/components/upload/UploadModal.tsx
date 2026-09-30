import { useRef, useState, type DragEvent } from 'react';
import { CloudUpload, FolderOpen, MonitorSmartphone, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useUploads } from '@/context/UploadContext';
import { env } from '@/lib/env';
import type { Category } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';

export function UploadModal() {
  const { modal, closeUpload, addFiles } = useUploads();
  const [target, setTarget] = useState<'auto' | 'screenshot'>('auto');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
              { v: 'auto', icon: Sparkles, title: 'Auto-detect', desc: 'Sort into Images, PDFs, Documents or Other' },
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
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-14',
            dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand/60 hover:bg-subtle/60',
          )}
        >
          <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <CloudUpload className="size-7" />
          </div>
          <p className="text-sm font-semibold text-ink">
            <span className="hidden sm:inline">Drag & drop files here, or </span>
            <span className="text-brand-ink">browse your device</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Select as many files as you like · up to {formatBytes(env.maxUploadBytes, 0)} each
          </p>
          <Button variant="secondary" size="sm" className="mt-4" icon={<FolderOpen className="size-4" />} tabIndex={-1}>
            Choose files
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={target === 'screenshot' ? 'image/*' : undefined}
          onChange={(e) => {
            submit(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-faint">
          Uploads continue in the background — you can keep browsing while they finish. Executable files (.exe, .bat, …) are blocked.
        </p>
      </div>
    </Modal>
  );
}
