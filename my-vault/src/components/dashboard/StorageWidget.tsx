import { Link } from 'react-router';
import { Card, Skeleton } from '@/components/ui/misc';
import type { VaultStats } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';

const SEGMENTS = [
  { key: 'image', label: 'Images', color: 'bg-sky-500' },
  { key: 'screenshot', label: 'Screenshots', color: 'bg-violet-500' },
  { key: 'pdf', label: 'PDFs', color: 'bg-red-500' },
  { key: 'document', label: 'Documents', color: 'bg-blue-600' },
  { key: 'video', label: 'Videos', color: 'bg-fuchsia-500' },
  { key: 'other', label: 'Other', color: 'bg-slate-400' },
] as const;

export function StorageWidget({ stats, loading, compact }: { stats?: VaultStats; loading?: boolean; compact?: boolean }) {
  const quota = stats?.quota_bytes ?? 0;
  const used = stats?.total_bytes ?? 0;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const scale = quota || used || 1;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Storage</h3>
        {compact && (
          <Link to="/storage" className="text-xs font-medium text-brand-ink hover:underline">
            Details
          </Link>
        )}
      </div>
      {loading || !stats ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-2.5 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <>
          <p className="mt-3 text-2xl font-bold tracking-tight text-ink">
            {formatBytes(used)} <span className="text-sm font-medium text-muted">used</span>
          </p>
          {quota > 0 && (
            <p className="text-xs text-muted">
              of {formatBytes(quota, 0)} · {pct.toFixed(pct < 10 ? 1 : 0)}%
            </p>
          )}
          <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-subtle" role="img" aria-label={`Storage used: ${formatBytes(used)}`}>
            {SEGMENTS.map((s) => {
              const bytes = stats.bytes_by_category[s.key] ?? 0;
              return bytes ? <div key={s.key} className={cn('h-full', s.color)} style={{ width: `${(bytes / scale) * 100}%` }} /> : null;
            })}
          </div>
          <ul className="mt-4 space-y-2.5">
            {SEGMENTS.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5 text-sm">
                <span className={cn('size-2.5 rounded-full', s.color)} />
                <span className="flex-1 text-muted">{s.label}</span>
                <span className="font-medium text-ink tabular-nums">{formatBytes(stats.bytes_by_category[s.key] ?? 0)}</span>
              </li>
            ))}
            {stats.trash_bytes > 0 && (
              <li className="flex items-center gap-2.5 border-t border-line pt-2.5 text-sm">
                <span className="size-2.5 rounded-full border border-line-strong" />
                <span className="flex-1 text-muted">In trash (included above)</span>
                <span className="font-medium text-ink tabular-nums">{formatBytes(stats.trash_bytes)}</span>
              </li>
            )}
          </ul>
          {pct > 90 && (
            <p className="mt-4 rounded-lg bg-danger-soft p-2.5 text-xs text-danger">
              Storage is almost full. Empty the trash or raise your quota to keep uploading.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
