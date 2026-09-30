import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { RefreshCw, SearchX, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { FilterPanel } from '@/components/files/FilterPanel';
import { FileGrid } from '@/components/files/FileGrid';
import { FileList } from '@/components/files/FileList';
import { LoadingSkeleton } from '@/components/files/LoadingSkeleton';
import { BulkActionBar } from '@/components/files/BulkActionBar';
import { PreviewModal } from '@/components/preview/PreviewModal';
import { useFileActions } from '@/context/FileActionsContext';
import { useUploads } from '@/context/UploadContext';
import { useFileFilters } from '@/hooks/useFileFilters';
import { useFiles, useInfiniteScroll } from '@/hooks/useFiles';
import { usePreferences } from '@/hooks/useProfile';
import { getErrorMessage } from '@/lib/errors';
import type { LibraryView } from '@/lib/views';
import type { FileQuery, VaultFile } from '@/types';
import { cn } from '@/utils/cn';
import { pluralize } from '@/utils/format';

export function LibraryPage({ view }: { view: LibraryView }) {
  const { prefs, setPrefs } = usePreferences();
  const { filters, setFilter, reset, activeCount } = useFileFilters();
  const [params, setParams] = useSearchParams();
  const { openUpload } = useUploads();
  const actions = useFileActions();

  const recentTab = view.key === 'recent' ? (params.get('tab') === 'opened' ? 'opened' : 'uploaded') : null;
  const scope = recentTab === 'opened' ? 'recent_accessed' : view.scope;

  const query: FileQuery = useMemo(
    () => ({ ...filters, scope, category: view.category, pageSize: prefs.pageSize }),
    [filters, scope, view.category, prefs.pageSize],
  );

  const { files, total, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } = useFiles(query);

  // ----- selection -----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const lastIndex = useRef<number | null>(null);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    setSelected(new Set());
    lastIndex.current = null;
  }, [queryKey]);
  // Drop selections for files that left the list (trashed, deleted…)
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(files.map((f) => f.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  const selectionMode = selectMode || selected.size > 0;

  const onToggleSelect = useCallback(
    (file: VaultFile, shiftKey: boolean) => {
      const idx = files.findIndex((f) => f.id === file.id);
      setSelected((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastIndex.current !== null) {
          const [a, b] = [Math.min(lastIndex.current, idx), Math.max(lastIndex.current, idx)];
          for (let i = a; i <= b; i++) next.add(files[i].id);
        } else if (next.has(file.id)) next.delete(file.id);
        else next.add(file.id);
        return next;
      });
      lastIndex.current = idx;
    },
    [files],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectMode(false);
  }, []);

  const selectedFiles = useMemo(() => files.filter((f) => selected.has(f.id)), [files, selected]);

  // ----- preview -----
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const onOpen = useCallback((file: VaultFile) => setPreviewIndex(files.findIndex((f) => f.id === file.id)), [files]);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinel = useInfiniteScroll(loadMore, Boolean(hasNextPage));

  const isTrash = view.scope === 'trash';
  const filtered = activeCount > 0 || Boolean(filters.search);
  const canUpload = view.scope === 'category' || view.scope === 'all';
  const Icon = view.icon;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand sm:flex">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{view.title}</h2>
              {total !== null && <span className="text-sm whitespace-nowrap text-muted">{pluralize(total, 'file')}</span>}
              {isFetching && !isLoading && <Spinner className="size-3.5 text-faint" />}
            </div>
            <p className="mt-0.5 text-sm text-muted">{view.subtitle}</p>
          </div>
        </div>
        {isTrash ? (
          <Button variant="danger-ghost" icon={<Trash2 className="size-4" />} onClick={() => void actions.emptyTrash()} disabled={!files.length}>
            Empty Trash
          </Button>
        ) : canUpload ? (
          <Button variant="secondary" className="hidden sm:inline-flex" icon={<Upload className="size-4" />} onClick={() => openUpload(view.uploadCategory)}>
            {view.category === 'screenshot' ? 'Upload screenshots' : 'Upload'}
          </Button>
        ) : null}
      </div>

      {recentTab && (
        <div className="flex gap-1 border-b border-line" role="tablist">
          {(['uploaded', 'opened'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={recentTab === t}
              onClick={() =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    if (t === 'opened') next.set('tab', 'opened');
                    else next.delete('tab');
                    return next;
                  },
                  { replace: true },
                )
              }
              className={cn(
                '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                recentTab === t ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t === 'uploaded' ? 'Recently uploaded' : 'Recently opened'}
            </button>
          ))}
        </div>
      )}

      {isTrash && (
        <p className="rounded-xl border border-line bg-subtle/60 px-4 py-2.5 text-[13px] text-muted">
          Files in the trash still use storage until they are permanently deleted.
        </p>
      )}

      <FilterPanel
        filters={filters}
        setFilter={setFilter}
        reset={reset}
        activeCount={activeCount}
        showTypeFilter={view.showTypeFilter}
        showFavoritesFilter={view.scope !== 'favorites' && !isTrash}
        view={prefs.view}
        onViewChange={(v) => setPrefs({ view: v })}
        selectionMode={selectionMode}
        onToggleSelectionMode={() => (selectionMode ? clearSelection() : setSelectMode(true))}
      />

      {filters.search && (
        <div className="flex items-center gap-2 text-sm text-muted">
          Results for <span className="font-medium text-ink">“{filters.search}”</span>
          <button type="button" onClick={() => setFilter('search', '')} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-brand-ink hover:bg-brand-soft">
            <X className="size-3.5" /> Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingSkeleton view={prefs.view} square={view.squareSkeleton} />
      ) : isError ? (
        <EmptyState
          icon={<RefreshCw className="size-6" />}
          title="Couldn’t load files"
          description={getErrorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => refetch()} icon={<RefreshCw className="size-4" />}>
              Try again
            </Button>
          }
        />
      ) : files.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="No matching files"
            description="Try a different search term or clear your filters."
            action={
              <Button variant="secondary" onClick={reset}>
                Clear search & filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon className="size-6" />}
            title={recentTab === 'opened' ? 'Nothing opened yet' : view.empty.title}
            description={recentTab === 'opened' ? 'Files you preview or download will appear here.' : view.empty.description}
            action={
              canUpload ? (
                <Button onClick={() => openUpload(view.uploadCategory)} icon={<Upload className="size-4" />}>
                  Upload files
                </Button>
              ) : undefined
            }
          />
        )
      ) : prefs.view === 'grid' ? (
        <FileGrid files={files} selected={selected} selectionMode={selectionMode} onToggleSelect={onToggleSelect} onOpen={onOpen} />
      ) : (
        <FileList
          files={files}
          selected={selected}
          selectionMode={selectionMode}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          allSelected={files.length > 0 && selected.size === files.length}
          onToggleAll={(c) => setSelected(c ? new Set(files.map((f) => f.id)) : new Set())}
          dateLabel={isTrash ? 'Deleted' : recentTab === 'opened' ? 'Opened' : 'Uploaded'}
          dateField={isTrash ? 'deleted_at' : recentTab === 'opened' ? 'last_accessed_at' : 'created_at'}
        />
      )}

      <div ref={sentinel} aria-hidden className="h-1" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
      {!hasNextPage && files.length > prefs.pageSize && <p className="py-4 text-center text-xs text-faint">You’ve reached the end · {pluralize(files.length, 'file')}</p>}

      {selectionMode && selectedFiles.length === 0 && (
        <div className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm shadow-pop">
          <span className="text-muted">Tap files to select them</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(files.map((f) => f.id)))}>
              Select all
            </Button>
            <Button size="sm" variant="secondary" onClick={clearSelection}>
              Done
            </Button>
          </div>
        </div>
      )}
      <BulkActionBar files={selectedFiles} isTrash={isTrash} onClear={clearSelection} />

      <PreviewModal files={files} index={previewIndex} onIndexChange={setPreviewIndex} onNeedMore={loadMore} total={total} />
    </div>
  );
}
