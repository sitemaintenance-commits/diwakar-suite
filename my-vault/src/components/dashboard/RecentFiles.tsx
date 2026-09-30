import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Inbox, Upload } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, EmptyState, Skeleton } from '@/components/ui/misc';
import { FileThumb } from '@/components/files/FileThumb';
import { FileActionsMenu } from '@/components/files/FileActionsMenu';
import { FavoriteButton } from '@/components/files/FileCard';
import { PreviewModal } from '@/components/preview/PreviewModal';
import { useFileActions } from '@/context/FileActionsContext';
import { useUploads } from '@/context/UploadContext';
import { useFiles } from '@/hooks/useFiles';
import { CATEGORIES } from '@/lib/categories';
import { getErrorMessage } from '@/lib/errors';
import type { FileQuery } from '@/types';
import { formatBytes, formatRelative } from '@/utils/format';

const QUERY: FileQuery = {
  scope: 'all',
  search: '',
  sort: 'newest',
  date: 'any',
  size: 'any',
  favoritesOnly: false,
  type: 'any',
  pageSize: 8,
};

export function RecentFiles() {
  const { files, isLoading, isError, error, refetch } = useFiles(QUERY);
  const { download } = useFileActions();
  const { openUpload } = useUploads();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Recent files</h3>
          <p className="text-xs text-muted">Latest uploads to your vault</p>
        </div>
        <Link to="/recent" className="text-xs font-medium text-brand-ink hover:underline">
          View all
        </Link>
      </div>
      {isLoading ? (
        <div className="divide-y divide-line">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="size-10" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="p-6 text-center text-sm text-danger">
          {getErrorMessage(error)}{' '}
          <button type="button" className="font-medium underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="No files yet"
          description="Upload your first images, PDFs or documents."
          action={
            <Button onClick={() => openUpload()} icon={<Upload className="size-4" />}>
              Upload files
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-subtle/60 sm:px-5">
              <button type="button" onClick={() => setPreviewIndex(i)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand">
                <FileThumb file={f} className="size-10 shrink-0 rounded-lg" iconSize="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{f.display_name}</p>
                  <p className="truncate text-xs text-faint">
                    {CATEGORIES[f.category].label} · {formatBytes(f.size_bytes)} · {formatRelative(f.created_at)}
                  </p>
                </div>
              </button>
              <IconButton label="Download" size="sm" onClick={() => void download(f)} className="hidden sm:inline-flex">
                <Download className="size-4" />
              </IconButton>
              <FavoriteButton file={f} className="hidden sm:inline-flex" />
              <FileActionsMenu file={f} onPreview={() => setPreviewIndex(i)} />
            </li>
          ))}
        </ul>
      )}
      <PreviewModal files={files} index={previewIndex} onIndexChange={setPreviewIndex} />
    </Card>
  );
}
