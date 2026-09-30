import { memo } from 'react';
import { Checkbox } from '@/components/ui/misc';
import { CATEGORIES } from '@/lib/categories';
import type { VaultFile } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes, formatDate } from '@/utils/format';
import { FileThumb } from './FileThumb';
import { FileActionsMenu } from './FileActionsMenu';
import { FavoriteButton, type CardProps } from './FileCard';

interface Props extends Omit<CardProps, 'file' | 'selected'> {
  files: VaultFile[];
  selected: Set<string>;
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  dateLabel?: string;
  dateField?: 'created_at' | 'deleted_at' | 'last_accessed_at';
}

const Row = memo(function Row({
  file,
  selected,
  selectionMode,
  onToggleSelect,
  onOpen,
  dateField,
}: CardProps & { dateField: NonNullable<Props['dateField']> }) {
  return (
    <div
      role="row"
      className={cn(
        'group cv-auto grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line px-3 py-2.5 transition-colors last:border-b-0 sm:px-4',
        'md:grid-cols-[auto_minmax(0,1fr)_110px_90px_120px_auto]',
        selected ? 'bg-brand-soft/60' : 'hover:bg-subtle/60',
      )}
      style={{ containIntrinsicSize: 'auto 60px' }}
    >
      <Checkbox checked={selected} onChange={() => onToggleSelect(file, false)} label={`Select ${file.display_name}`} />
      <button
        type="button"
        onClick={(e) => (selectionMode ? onToggleSelect(file, e.shiftKey) : onOpen(file))}
        className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand"
      >
        <FileThumb file={file} className="size-10 shrink-0 rounded-lg" iconSize="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{file.display_name}</p>
          <p className="truncate text-xs text-faint">
            <span className="md:hidden">
              {formatBytes(file.size_bytes)} · {formatDate(file[dateField])}
            </span>
            <span className="hidden md:inline">
              {file.tags.length ? file.tags.map((t) => `#${t}`).join(' ') : file.original_name}
            </span>
          </p>
        </div>
      </button>
      <div className="hidden text-[13px] text-muted md:block">
        {CATEGORIES[file.category].label}
        <span className="ml-1 text-faint uppercase">.{file.extension || '—'}</span>
      </div>
      <div className="hidden text-[13px] text-muted md:block">{formatBytes(file.size_bytes)}</div>
      <div className="hidden text-[13px] text-muted md:block">{formatDate(file[dateField])}</div>
      <div className="flex items-center">
        <FavoriteButton file={file} className="hidden sm:inline-flex" />
        <FileActionsMenu file={file} onPreview={() => onOpen(file)} />
      </div>
    </div>
  );
});

export function FileList({ files, selected, allSelected, onToggleAll, dateLabel = 'Uploaded', dateField = 'created_at', ...rest }: Props) {
  return (
    <div role="table" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div
        role="row"
        className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line bg-subtle/50 px-3 py-2.5 text-xs font-medium tracking-wide text-faint uppercase sm:px-4 md:grid-cols-[auto_minmax(0,1fr)_110px_90px_120px_auto]"
      >
        <Checkbox checked={allSelected} onChange={onToggleAll} label="Select all loaded files" />
        <span>Name</span>
        <span className="hidden md:block">Type</span>
        <span className="hidden md:block">Size</span>
        <span className="hidden md:block">{dateLabel}</span>
        <span className="w-8 sm:w-16" />
      </div>
      {files.map((f) => (
        <Row key={f.id} file={f} selected={selected.has(f.id)} dateField={dateField} {...rest} />
      ))}
    </div>
  );
}
