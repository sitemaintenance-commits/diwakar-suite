import { Skeleton } from '@/components/ui/misc';
import type { ViewMode } from '@/types';

export function LoadingSkeleton({ view, count = 12, square = true }: { view: ViewMode; count?: number; square?: boolean }) {
  if (view === 'list') {
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {Array.from({ length: Math.min(count, 10) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="size-10" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="hidden h-3.5 w-20 md:block" />
            <Skeleton className="hidden h-3.5 w-16 md:block" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" aria-busy="true" aria-label="Loading files">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <Skeleton className={square ? 'aspect-square w-full rounded-none' : 'aspect-[4/3] w-full rounded-none'} />
          <div className="space-y-2 p-3">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
