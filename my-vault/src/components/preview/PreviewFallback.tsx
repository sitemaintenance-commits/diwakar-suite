import { AlertTriangle, Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileIcon } from '@/components/files/FileThumb';
import type { VaultFile } from '@/types';
import { formatBytes } from '@/utils/format';

export function PreviewError({ message, onDownload }: { message: string; onDownload: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
      <AlertTriangle className="size-10 text-orange-400" />
      <p className="font-medium">Preview failed</p>
      <p className="max-w-sm text-sm text-white/70">{message}</p>
      <Button onClick={onDownload} icon={<Download className="size-4" />}>
        Download instead
      </Button>
    </div>
  );
}

/** Honest fallback for formats browsers cannot render (DOC, RTF, ODT, XLSX…). */
export function NoPreview({ file, onDownload, onOpenTab }: { file: VaultFile; onDownload: () => void; onOpenTab: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white">
        <FileIcon file={file} size="lg" className="mx-auto" />
        <p className="mt-4 font-semibold break-words">{file.display_name}</p>
        <p className="mt-1 text-sm text-white/60">
          .{file.extension || 'file'} · {formatBytes(file.size_bytes)}
        </p>
        <p className="mt-4 text-sm text-white/70">
          In-browser preview isn’t available for this file type. Download it or open it in a new tab to view it with your device’s apps.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onDownload} icon={<Download className="size-4" />}>
            Download
          </Button>
          <Button variant="secondary" onClick={onOpenTab} icon={<ExternalLink className="size-4" />}>
            Open in new tab
          </Button>
        </div>
      </div>
    </div>
  );
}
