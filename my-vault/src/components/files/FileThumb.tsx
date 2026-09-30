import { memo, useState } from 'react';
import { Play } from 'lucide-react';
import { CATEGORIES } from '@/lib/categories';
import type { VaultFile } from '@/types';
import { cn } from '@/utils/cn';
import { formatDuration } from '@/utils/format';

export function FileIcon({ file, className, size = 'md' }: { file: Pick<VaultFile, 'category' | 'extension'>; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const def = CATEGORIES[file.category];
  const Icon = def.icon;
  const box = { sm: 'size-9 rounded-lg', md: 'size-12 rounded-xl', lg: 'size-16 rounded-2xl' }[size];
  const icon = { sm: 'size-4', md: 'size-6', lg: 'size-8' }[size];
  return (
    <div className={cn('flex shrink-0 items-center justify-center', box, def.tone, className)}>
      <Icon className={icon} strokeWidth={1.75} />
    </div>
  );
}

/** Lazy-loaded thumbnail with graceful icon fallback. Never loads originals of large files. */
export const FileThumb = memo(function FileThumb({
  file,
  className,
  fit = 'cover',
  iconSize = 'lg',
}: {
  file: VaultFile;
  className?: string;
  fit?: 'cover' | 'contain';
  iconSize?: 'sm' | 'md' | 'lg';
}) {
  // Track by URL so a refreshed signed URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showImage = file.thumbUrl && failedUrl !== file.thumbUrl;
  const loaded = loadedUrl === file.thumbUrl;
  const duration = file.category === 'video' ? formatDuration(file.duration_seconds) : '';

  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden bg-subtle', className)}>
      {showImage ? (
        <>
          {!loaded && <div className="skeleton absolute inset-0" />}
          <img
            src={file.thumbUrl!}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoadedUrl(file.thumbUrl)}
            onError={() => setFailedUrl(file.thumbUrl)}
            className={cn(
              'h-full w-full transition-opacity duration-300',
              fit === 'cover' ? 'object-cover' : 'object-contain',
              file.category === 'pdf' && 'object-top',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <FileIcon file={file} size={iconSize} />
          {file.extension && iconSize !== 'sm' && (
            <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">{file.extension}</span>
          )}
        </div>
      )}
      {file.category === 'video' && iconSize !== 'sm' && (
        <>
          {showImage && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
              <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                <Play className="ml-0.5 size-5" fill="currentColor" />
              </span>
            </span>
          )}
          {duration && (
            <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
              {duration}
            </span>
          )}
        </>
      )}
    </div>
  );
});
