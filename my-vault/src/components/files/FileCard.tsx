import { memo } from 'react';
import { Star } from 'lucide-react';
import { Checkbox } from '@/components/ui/misc';
import { useFileActions } from '@/context/FileActionsContext';
import type { VaultFile } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes, formatDate } from '@/utils/format';
import { FileThumb } from './FileThumb';
import { FileActionsMenu } from './FileActionsMenu';

export interface CardProps {
  file: VaultFile;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (file: VaultFile, shiftKey: boolean) => void;
  onOpen: (file: VaultFile) => void;
}

export function FavoriteButton({ file, className }: { file: VaultFile; className?: string }) {
  const { toggleFavorite } = useFileActions();
  if (file.deleted_at) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggleFavorite(file);
      }}
      aria-pressed={file.is_favorite}
      aria-label={file.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
      title={file.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg transition-colors',
        file.is_favorite ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-faint hover:bg-subtle hover:text-ink',
        className,
      )}
    >
      <Star className="size-4" fill={file.is_favorite ? 'currentColor' : 'none'} />
    </button>
  );
}

function SelectBox({ file, selected, selectionMode, onToggleSelect }: Omit<CardProps, 'onOpen'>) {
  return (
    <label
      className={cn(
        'absolute top-2.5 left-2.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-lg bg-surface/95 shadow-card transition-opacity',
        selected || selectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
      )}
      onClick={(e) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).tagName !== 'INPUT') {
          e.preventDefault();
          onToggleSelect(file, e.shiftKey);
        }
      }}
    >
      <Checkbox checked={selected} onChange={() => onToggleSelect(file, false)} label={`Select ${file.display_name}`} />
    </label>
  );
}

/** Gallery tile for images and screenshots. */
export const ImageCard = memo(function ImageCard({ file, selected, selectionMode, onToggleSelect, onOpen }: CardProps) {
  return (
    <div
      className={cn(
        'group cv-auto relative overflow-hidden rounded-2xl border bg-surface shadow-card transition-all',
        selected ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-line-strong hover:shadow-pop',
      )}
    >
      <SelectBox file={file} selected={selected} selectionMode={selectionMode} onToggleSelect={onToggleSelect} />
      {file.is_favorite && (
        <span className="absolute top-2.5 right-2.5 z-10 flex size-7 items-center justify-center rounded-lg bg-surface/95 text-amber-500 shadow-card">
          <Star className="size-3.5" fill="currentColor" />
        </span>
      )}
      <button
        type="button"
        className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        onClick={(e) => (selectionMode ? onToggleSelect(file, e.shiftKey) : onOpen(file))}
        aria-label={`Open ${file.display_name}`}
      >
        <FileThumb file={file} className="aspect-square w-full" />
      </button>
      <div className="flex items-center gap-1 py-2 pr-1.5 pl-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink" title={file.display_name}>
            {file.display_name}
          </p>
          <p className="truncate text-[11.5px] text-faint">
            {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
          </p>
        </div>
        <FavoriteButton file={file} className="hidden sm:inline-flex" />
        <FileActionsMenu file={file} onPreview={() => onOpen(file)} />
      </div>
    </div>
  );
});

/** Card for PDFs, documents and other files. */
export const FileCard = memo(function FileCard({ file, selected, selectionMode, onToggleSelect, onOpen }: CardProps) {
  return (
    <div
      className={cn(
        'group cv-auto relative flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-card transition-all',
        selected ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:border-line-strong hover:shadow-pop',
      )}
    >
      <SelectBox file={file} selected={selected} selectionMode={selectionMode} onToggleSelect={onToggleSelect} />
      <button
        type="button"
        className="block w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        onClick={(e) => (selectionMode ? onToggleSelect(file, e.shiftKey) : onOpen(file))}
        aria-label={`Open ${file.display_name}`}
      >
        <FileThumb file={file} className="aspect-[4/3] w-full border-b border-line" />
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3 pb-2">
        <p className="line-clamp-2 text-[13px] leading-snug font-medium break-words text-ink" title={file.display_name}>
          {file.display_name}
        </p>
        <div className="mt-auto flex items-center gap-1 pt-1">
          <div className="min-w-0 flex-1 text-[11.5px] text-faint">
            <span className="mr-1.5 rounded bg-subtle px-1.5 py-0.5 font-semibold text-muted uppercase">{file.extension || 'file'}</span>
            {formatBytes(file.size_bytes)}
            {file.page_count ? ` · ${file.page_count} pg` : ''}
            <span className="block truncate pt-0.5">{formatDate(file.created_at)}</span>
          </div>
          <FavoriteButton file={file} />
          <FileActionsMenu file={file} onPreview={() => onOpen(file)} />
        </div>
      </div>
    </div>
  );
});
