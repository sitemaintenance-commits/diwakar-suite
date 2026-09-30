import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { CATEGORY_ORDER } from '@/lib/categories';
import type { Category, DateFilter, FileFilters, SizeFilter, SortKey } from '@/types';

const SORTS: SortKey[] = ['newest', 'oldest', 'name_asc', 'name_desc', 'largest', 'smallest'];
const DATES: DateFilter[] = ['any', 'today', '7d', '30d', '365d'];
const SIZES: SizeFilter[] = ['any', 'small', 'medium', 'large', 'huge'];

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Filters live in the URL so they survive refresh and can be bookmarked. */
export function useFileFilters() {
  const [params, setParams] = useSearchParams();

  const filters: FileFilters = useMemo(
    () => ({
      search: params.get('q') ?? '',
      sort: pick(params.get('sort'), SORTS, 'newest'),
      date: pick(params.get('date'), DATES, 'any'),
      size: pick(params.get('size'), SIZES, 'any'),
      favoritesOnly: params.get('fav') === '1',
      type: pick<Category | 'any'>(params.get('type'), ['any', ...CATEGORY_ORDER], 'any'),
    }),
    [params],
  );

  const setFilter = useCallback(
    <K extends keyof FileFilters>(key: K, value: FileFilters[K]) => {
      const name = { search: 'q', sort: 'sort', date: 'date', size: 'size', favoritesOnly: 'fav', type: 'type' }[key];
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const isDefault = value === '' || value === false || value === 'any' || (key === 'sort' && value === 'newest');
          if (isDefault) next.delete(name);
          else next.set(name, value === true ? '1' : String(value));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams();
        const tab = prev.get('tab');
        if (tab) next.set('tab', tab);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const activeCount =
    Number(filters.date !== 'any') + Number(filters.size !== 'any') + Number(filters.favoritesOnly) + Number(filters.type !== 'any');

  return { filters, setFilter, reset, activeCount };
}
