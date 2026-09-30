import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { FilePage, VaultFile } from '@/types';
import { isAuthError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !isAuthError(error) && count < 2,
    },
  },
});

export const qk = {
  files: ['files'] as const,
  stats: ['stats'] as const,
  largest: ['largest'] as const,
  profile: (uid?: string) => ['profile', uid] as const,
  avatar: (path?: string | null) => ['avatar', path] as const,
};

type FilesData = InfiniteData<FilePage, number>;

/** Apply a patch to a file wherever it appears in cached lists (instant UI). */
export function patchCachedFiles(ids: string[], patch: Partial<VaultFile>) {
  const set = new Set(ids);
  queryClient.setQueriesData<FilesData>({ queryKey: qk.files }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((f) => (set.has(f.id) ? { ...f, ...patch } : f)),
          })),
        }
      : data,
  );
}

/** Remove files from every cached list (after trash/restore/delete). */
export function removeCachedFiles(ids: string[]) {
  const set = new Set(ids);
  queryClient.setQueriesData<FilesData>({ queryKey: qk.files }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.filter((f) => !set.has(f.id)),
            total: p.total === null ? null : Math.max(0, p.total - p.items.filter((f) => set.has(f.id)).length),
          })),
        }
      : data,
  );
}

export function invalidateLibrary() {
  void queryClient.invalidateQueries({ queryKey: qk.files });
  void queryClient.invalidateQueries({ queryKey: qk.stats });
  void queryClient.invalidateQueries({ queryKey: qk.largest });
}
