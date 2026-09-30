import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useUser } from './AuthContext';
import { detectCategory } from '@/lib/categories';
import { getErrorMessage } from '@/lib/errors';
import { invalidateLibrary, qk, queryClient } from '@/lib/queryClient';
import { uploadVaultFile, validateFile } from '@/services/upload';
import type { Category, UploadItem, VaultStats } from '@/types';

/** Parallel uploads. Higher values rarely help and can starve the UI thread. */
const CONCURRENCY = 3;

interface UploadContextValue {
  items: UploadItem[];
  addFiles: (files: FileList | File[], requested: Category | 'auto') => void;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  cancel: (id: string) => void;
  cancelAll: () => void;
  clearFinished: () => void;
  isUploading: boolean;
  modal: { open: boolean; category: Category | 'auto' };
  openUpload: (category?: Category | 'auto') => void;
  closeUpload: () => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

const isActive = (i: UploadItem) => i.status === 'uploading' || i.status === 'processing';

export function UploadProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [modal, setModal] = useState<{ open: boolean; category: Category | 'auto' }>({ open: false, category: 'auto' });
  const controllers = useRef(new Map<string, AbortController>());
  const started = useRef(new Set<string>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  // Refresh lists at most every 1.5s while a batch is finishing.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      invalidateLibrary();
    }, 1500);
  }, []);

  const run = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      update(item.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        await uploadVaultFile(
          item.file,
          item.category,
          user.id,
          (progress, phase) => update(item.id, { progress, status: phase }),
          controller.signal,
        );
        update(item.id, { status: 'done', progress: 100 });
        scheduleRefresh();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          update(item.id, { status: 'canceled' });
        } else {
          update(item.id, { status: 'error', error: getErrorMessage(err, 'Upload failed.') });
        }
      } finally {
        controllers.current.delete(item.id);
        started.current.delete(item.id);
      }
    },
    [update, user.id, scheduleRefresh],
  );

  // Queue pump: start queued items while there are free slots.
  useEffect(() => {
    const running = items.filter(isActive).length + [...started.current].filter((id) => items.find((i) => i.id === id)?.status === 'queued').length;
    let slots = CONCURRENCY - running;
    for (const item of items) {
      if (slots <= 0) break;
      if (item.status === 'queued' && !started.current.has(item.id)) {
        started.current.add(item.id);
        slots--;
        void run(item);
      }
    }
  }, [items, run]);

  const isUploading = items.some((i) => i.status === 'queued' || isActive(i));

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (!isUploading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isUploading]);

  // Batch complete summary.
  const wasUploading = useRef(false);
  useEffect(() => {
    if (wasUploading.current && !isUploading) {
      const done = items.filter((i) => i.status === 'done').length;
      const failed = items.filter((i) => i.status === 'error').length;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      invalidateLibrary();
      if (failed) toast.error(`${failed} upload${failed > 1 ? 's' : ''} failed`, { description: 'Open the upload panel to retry.' });
      else if (done) toast.success(`Upload complete`, { description: `${done} file${done > 1 ? 's' : ''} added to your vault.` });
    }
    wasUploading.current = isUploading;
  }, [isUploading, items]);

  const addFiles = useCallback((list: FileList | File[], requested: Category | 'auto') => {
    const files = Array.from(list);
    if (!files.length) return;

    // Soft quota pre-check using cached stats; the DB trigger is authoritative.
    const stats = queryClient.getQueryData<VaultStats>(qk.stats);
    let remaining = stats?.quota_bytes != null ? stats.quota_bytes - stats.total_bytes : Infinity;
    remaining -= itemsRef.current.filter((i) => i.status === 'queued' || isActive(i)).reduce((s, i) => s + i.file.size, 0);

    const next: UploadItem[] = files.map((file) => {
      const invalid = validateFile(file, requested);
      const category = detectCategory(file, requested);
      let error = invalid ?? undefined;
      if (!error && file.size > remaining) error = 'Storage limit reached. Free up space or raise your quota.';
      if (!error) remaining -= file.size;
      return { id: crypto.randomUUID(), file, category, status: error ? 'error' : 'queued', progress: 0, error };
    });
    const rejected = next.filter((i) => i.status === 'error');
    if (rejected.length) {
      toast.error(`${rejected.length} file${rejected.length > 1 ? 's' : ''} could not be queued`, {
        description: rejected[0].error,
      });
    }
    setItems((prev) => [...prev.filter((i) => i.status !== 'done' && i.status !== 'canceled'), ...next]);
  }, []);

  const retry = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const invalid = validateFile(i.file, i.category === 'screenshot' ? 'screenshot' : 'auto');
        return invalid ? { ...i, error: invalid } : { ...i, status: 'queued', progress: 0, error: undefined };
      }),
    );
  }, []);

  const retryAllFailed = useCallback(() => {
    setItems((prev) =>
      prev.map((i) =>
        (i.status === 'error' || i.status === 'canceled') && !validateFile(i.file, i.category === 'screenshot' ? 'screenshot' : 'auto')
          ? { ...i, status: 'queued', progress: 0, error: undefined }
          : i,
      ),
    );
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const c = controllers.current.get(id);
      if (c) c.abort();
      else update(id, { status: 'canceled' });
    },
    [update],
  );

  const cancelAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    setItems((prev) => prev.map((i) => (i.status === 'queued' ? { ...i, status: 'canceled' } : i)));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status === 'queued' || isActive(i)));
  }, []);

  const openUpload = useCallback((category: Category | 'auto' = 'auto') => setModal({ open: true, category }), []);
  const closeUpload = useCallback(() => setModal((m) => ({ ...m, open: false })), []);

  const value = useMemo(
    () => ({ items, addFiles, retry, retryAllFailed, cancel, cancelAll, clearFinished, isUploading, modal, openUpload, closeUpload }),
    [items, addFiles, retry, retryAllFailed, cancel, cancelAll, clearFinished, isUploading, modal, openUpload, closeUpload],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUploads() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploads must be used inside UploadProvider');
  return ctx;
}
