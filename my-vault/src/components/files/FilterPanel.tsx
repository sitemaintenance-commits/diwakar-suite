import { useState } from 'react';
import { CheckSquare, LayoutGrid, List, SlidersHorizontal, Star, X } from 'lucide-react';
import { Select } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/Button';
import { CATEGORIES, CATEGORY_ORDER } from '@/lib/categories';
import type { FileFilters, ViewMode } from '@/types';
import { cn } from '@/utils/cn';

interface Props {
  filters: FileFilters;
  setFilter: <K extends keyof FileFilters>(key: K, value: FileFilters[K]) => void;
  reset: () => void;
  activeCount: number;
  showTypeFilter: boolean;
  showFavoritesFilter: boolean;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
}

export function FilterPanel({
  filters,
  setFilter,
  reset,
  activeCount,
  showTypeFilter,
  showFavoritesFilter,
  view,
  onViewChange,
  selectionMode,
  onToggleSelectionMode,
}: Props) {
  const [open, setOpen] = useState(activeCount > 0);

  const controls = (
    <>
      {showTypeFilter && (
        <Select aria-label="File type" value={filters.type} onChange={(e) => setFilter('type', e.target.value as FileFilters['type'])} className="sm:w-40">
          <option value="any">All types</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORIES[c].plural}
            </option>
          ))}
        </Select>
      )}
      <Select aria-label="Date uploaded" value={filters.date} onChange={(e) => setFilter('date', e.target.value as FileFilters['date'])} className="sm:w-40">
        <option value="any">Any date</option>
        <option value="today">Today</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="365d">Last 12 months</option>
      </Select>
      <Select aria-label="File size" value={filters.size} onChange={(e) => setFilter('size', e.target.value as FileFilters['size'])} className="sm:w-40">
        <option value="any">Any size</option>
        <option value="small">Under 1 MB</option>
        <option value="medium">1 – 10 MB</option>
        <option value="large">10 – 100 MB</option>
        <option value="huge">Over 100 MB</option>
      </Select>
      {showFavoritesFilter && (
        <button
          type="button"
          aria-pressed={filters.favoritesOnly}
          onClick={() => setFilter('favoritesOnly', !filters.favoritesOnly)}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors',
            filters.favoritesOnly ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300' : 'border-line bg-surface text-muted hover:text-ink',
          )}
        >
          <Star className="size-4" fill={filters.favoritesOnly ? 'currentColor' : 'none'} />
          Favorites
        </button>
      )}
      {activeCount > 0 && (
        <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-1.5 px-2 text-sm font-medium text-brand-ink hover:underline">
          <X className="size-4" /> Clear filters
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors lg:hidden',
            open || activeCount ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:text-ink',
          )}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{activeCount}</span>}
        </button>
        <div className="hidden flex-wrap items-center gap-2 lg:flex">{controls}</div>

        <div className="ml-auto flex items-center gap-2">
          <Select aria-label="Sort by" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as FileFilters['sort'])} className="w-36 sm:w-40">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
            <option value="largest">Largest</option>
            <option value="smallest">Smallest</option>
          </Select>
          <IconButton label={selectionMode ? 'Exit selection' : 'Select files'} active={selectionMode} onClick={onToggleSelectionMode}>
            <CheckSquare className="size-[18px]" />
          </IconButton>
          <div className="flex rounded-xl border border-line bg-surface p-0.5" role="radiogroup" aria-label="View mode">
            <IconButton label="Grid view" size="sm" active={view === 'grid'} onClick={() => onViewChange('grid')} role="radio" aria-checked={view === 'grid'}>
              <LayoutGrid className="size-4" />
            </IconButton>
            <IconButton label="List view" size="sm" active={view === 'list'} onClick={() => onViewChange('list')} role="radio" aria-checked={view === 'list'}>
              <List className="size-4" />
            </IconButton>
          </div>
        </div>
      </div>
      {open && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden [&>*]:w-full">{controls}</div>}
    </div>
  );
}
