import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getLargestFiles, getStats, listFiles } from '@/services/files';
import { qk } from '@/lib/queryClient';
import type { FileQuery } from '@/types';

export function useFiles(query: FileQuery, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: [...qk.files, query],
    queryFn: ({ pageParam }) => listFiles(query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    // Signed thumbnail URLs live 2h; refresh lists well before that.
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
    // Keep showing current results while a new search/sort loads (no flashing).
    placeholderData: keepPreviousData,
    enabled,
  });
  const files = result.data?.pages.flatMap((p) => p.items) ?? [];
  const total = result.data?.pages[0]?.total ?? null;
  return { ...result, files, total };
}

export function useStats() {
  return useQuery({ queryKey: qk.stats, queryFn: getStats, staleTime: 60_000 });
}

export function useLargestFiles(limit = 8) {
  return useQuery({ queryKey: [...qk.largest, limit], queryFn: () => getLargestFiles(limit) });
}

/** Calls `onVisible` when the sentinel element scrolls near the viewport. */
export function useInfiniteScroll(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && cb.current(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
