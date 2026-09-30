import { useState } from 'react';
import { AlertCircle, Ban, CheckCircle2, ChevronDown, ChevronUp, Loader2, RotateCw, X } from 'lucide-react';
import { useUploads } from '@/context/UploadContext';
import { IconButton } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/misc';
import { CATEGORIES } from '@/lib/categories';
import type { UploadItem } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';

function StatusIcon({ item }: { item: UploadItem }) {
  switch (item.status) {
    case 'done':
      return <CheckCircle2 className="size-4 text-success" />;
    case 'error':
      return <AlertCircle className="size-4 text-danger" />;
    case 'canceled':
      return <Ban className="size-4 text-faint" />;
    case 'queued':
      return <span className="size-4 rounded-full border-2 border-line-strong" />;
    default:
      return <Loader2 className="size-4 animate-spin text-brand" />;
  }
}

function statusText(item: UploadItem) {
  switch (item.status) {
    case 'queued':
      return 'Waiting';
    case 'uploading':
      return `${item.progress}%`;
    case 'processing':
      return 'Finishing…';
    case 'done':
      return 'Done';
    case 'canceled':
      return 'Canceled';
    case 'error':
      return 'Failed';
  }
}

/** Floating, non-blocking panel showing per-file and overall progress. */
export function UploadProgress() {
  const { items, retry, retryAllFailed, cancel, cancelAll, clearFinished, isUploading } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;

  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const totalBytes = items.filter((i) => i.status !== 'error' && i.status !== 'canceled').reduce((s, i) => s + i.file.size, 0) || 1;
  const sentBytes = items
    .filter((i) => i.status !== 'error' && i.status !== 'canceled')
    .reduce((s, i) => s + (i.file.size * i.progress) / 100, 0);
  const overall = Math.round((sentBytes / totalBytes) * 100);

  const title = isUploading
    ? `Uploading ${items.filter((i) => i.status !== 'canceled' && i.status !== 'error').length} files`
    : failed
      ? `${failed} upload${failed > 1 ? 's' : ''} failed`
      : `${done} upload${done === 1 ? '' : 's'} complete`;

  return (
    <div className="fixed right-3 bottom-3 left-3 z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop sm:left-auto sm:w-[380px]" role="status" aria-live="polite">
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs text-muted">
            {done} of {items.length} done{isUploading ? ` · ${overall}%` : ''}
          </p>
        </div>
        {!isUploading && failed > 0 && (
          <button type="button" onClick={retryAllFailed} className="rounded-lg px-2 py-1 text-xs font-medium text-brand-ink hover:bg-brand-soft">
            Retry all
          </button>
        )}
        {isUploading && (
          <button type="button" onClick={cancelAll} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-subtle hover:text-ink">
            Cancel all
          </button>
        )}
        <IconButton label={collapsed ? 'Expand' : 'Collapse'} size="sm" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </IconButton>
        {!isUploading && (
          <IconButton label="Close" size="sm" onClick={clearFinished}>
            <X className="size-4" />
          </IconButton>
        )}
      </div>
      {isUploading && <ProgressBar value={overall} className="h-1 rounded-none" />}
      {!collapsed && (
        <ul className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto border-t border-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <StatusIcon item={item} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-[13px] text-ink" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <span className={cn('shrink-0 text-xs tabular-nums', item.status === 'error' ? 'text-danger' : 'text-muted')}>{statusText(item)}</span>
                </div>
                {item.status === 'uploading' || item.status === 'processing' ? (
                  <ProgressBar value={item.progress} className="mt-1.5" />
                ) : (
                  <p className={cn('truncate text-xs', item.status === 'error' ? 'text-danger' : 'text-faint')} title={item.error}>
                    {item.error ?? `${formatBytes(item.file.size)} · ${CATEGORIES[item.category].plural}`}
                  </p>
                )}
              </div>
              {(item.status === 'error' || item.status === 'canceled') && (
                <IconButton label={`Retry ${item.file.name}`} size="sm" onClick={() => retry(item.id)}>
                  <RotateCw className="size-4" />
                </IconButton>
              )}
              {(item.status === 'queued' || item.status === 'uploading') && (
                <IconButton label={`Cancel ${item.file.name}`} size="sm" onClick={() => cancel(item.id)}>
                  <X className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
