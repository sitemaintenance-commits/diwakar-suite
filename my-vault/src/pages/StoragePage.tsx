import { useState } from 'react';
import { Link } from 'react-router';
import { Info, RefreshCw, Trash2 } from 'lucide-react';
import { StorageWidget } from '@/components/dashboard/StorageWidget';
import { Card, Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/Button';
import { FileThumb } from '@/components/files/FileThumb';
import { FileActionsMenu } from '@/components/files/FileActionsMenu';
import { PreviewModal } from '@/components/preview/PreviewModal';
import { useLargestFiles, useStats } from '@/hooks/useFiles';
import { CATEGORIES, CATEGORY_ORDER, CATEGORY_STAT_KEY } from '@/lib/categories';
import { getErrorMessage } from '@/lib/errors';
import type { VaultStats } from '@/types';
import { formatBytes, formatDate } from '@/utils/format';

export function StorageBreakdown({ stats }: { stats: VaultStats }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-subtle/60 text-left text-xs tracking-wide text-faint uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 text-right font-medium">Files</th>
            <th className="px-4 py-2.5 text-right font-medium">Size</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {CATEGORY_ORDER.map((c) => {
            const Icon = CATEGORIES[c].icon;
            return (
              <tr key={c}>
                <td className="px-4 py-2.5">
                  <Link to={CATEGORIES[c].route} className="inline-flex items-center gap-2 text-ink hover:text-brand-ink">
                    <Icon className="size-4 text-muted" /> {CATEGORIES[c].plural}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right text-muted tabular-nums">{Number(stats[CATEGORY_STAT_KEY[c]] ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right text-ink tabular-nums">{formatBytes(stats.bytes_by_category[c] ?? 0)}</td>
              </tr>
            );
          })}
          <tr className="bg-subtle/40 font-semibold">
            <td className="px-4 py-2.5 text-ink">Total (incl. trash)</td>
            <td className="px-4 py-2.5 text-right text-ink tabular-nums">{(stats.total_files + stats.trash).toLocaleString()}</td>
            <td className="px-4 py-2.5 text-right text-ink tabular-nums">{formatBytes(stats.total_bytes)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function StoragePage() {
  const { data: stats, isLoading, isError, error, refetch } = useStats();
  const largest = useLargestFiles(10);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Storage</h2>
        <p className="mt-1 text-sm text-muted">See what’s using space in your vault.</p>
      </div>

      {isError && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <span className="flex-1">{getErrorMessage(error)}</span>
          <Button size="sm" variant="secondary" onClick={() => refetch()} icon={<RefreshCw className="size-4" />}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <StorageWidget stats={stats} loading={isLoading} />
          {stats && stats.trash > 0 && (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <Trash2 className="mt-0.5 size-5 text-muted" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink">
                    {stats.trash.toLocaleString()} files in trash · {formatBytes(stats.trash_bytes)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">Empty the trash to reclaim this space.</p>
                  <Link to="/trash" className="mt-2 inline-block text-sm font-medium text-brand-ink hover:underline">
                    Review trash
                  </Link>
                </div>
              </div>
            </Card>
          )}
          <Card className="flex gap-3 p-5 text-xs text-muted">
            <Info className="size-4 shrink-0 text-faint" />
            <p>
              Your quota is set in the database (<code>profiles.storage_quota_bytes</code>). The Supabase Free plan includes 1 GB of storage; paid plans
              include more. See the README for how to raise it.
            </p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-semibold text-ink">By category</h3>
            {stats ? <StorageBreakdown stats={stats} /> : <Skeleton className="h-60 w-full" />}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold text-ink">Largest files</h3>
              <p className="text-xs text-muted">Good candidates to review when space runs low.</p>
            </div>
            {largest.isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : largest.isError ? (
              <p className="p-5 text-sm text-danger">{getErrorMessage(largest.error)}</p>
            ) : !largest.data?.length ? (
              <p className="p-5 text-sm text-muted">No files yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {largest.data.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-subtle/60 sm:px-5">
                    <button type="button" onClick={() => setPreviewIndex(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <FileThumb file={f} className="size-10 shrink-0 rounded-lg" iconSize="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{f.display_name}</p>
                        <p className="text-xs text-faint">
                          {CATEGORIES[f.category].label} · {formatDate(f.created_at)}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-ink tabular-nums">{formatBytes(f.size_bytes)}</span>
                    </button>
                    <FileActionsMenu file={f} onPreview={() => setPreviewIndex(i)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <PreviewModal files={largest.data ?? []} index={previewIndex} onIndexChange={setPreviewIndex} />
    </div>
  );
}
