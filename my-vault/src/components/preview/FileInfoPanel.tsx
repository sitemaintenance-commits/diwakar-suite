import { PencilLine } from 'lucide-react';
import { CATEGORIES } from '@/lib/categories';
import type { VaultFile } from '@/types';
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-[11px] font-medium tracking-wide text-white/45 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-white/90">{children}</dd>
    </div>
  );
}

export function FileInfoPanel({ file, onEdit }: { file: VaultFile; onEdit?: () => void }) {
  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">File information</h3>
        {onEdit && (
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-orange-300 hover:bg-white/10">
            <PencilLine className="size-3.5" /> Edit
          </button>
        )}
      </div>
      <dl className="divide-y divide-white/10">
        <Row label="Name">{file.display_name}</Row>
        {file.original_name !== file.display_name && <Row label="Original file name">{file.original_name}</Row>}
        <Row label="Category">{CATEGORIES[file.category].label}</Row>
        <Row label="Type">
          .{file.extension || '—'} <span className="text-white/50">({file.mime_type})</span>
        </Row>
        <Row label="Size">{formatBytes(file.size_bytes, 2)}</Row>
        {file.width && file.height ? (
          <Row label="Dimensions">
            {file.width} × {file.height} px
          </Row>
        ) : null}
        {file.page_count ? <Row label="Pages">{file.page_count}</Row> : null}
        {file.duration_seconds ? <Row label="Duration">{formatDuration(file.duration_seconds)}</Row> : null}
        <Row label="Uploaded">{formatDateTime(file.created_at)}</Row>
        <Row label="Modified">{formatDateTime(file.updated_at)}</Row>
        {file.last_accessed_at && <Row label="Last opened">{formatDateTime(file.last_accessed_at)}</Row>}
        {file.deleted_at && <Row label="Moved to trash">{formatDateTime(file.deleted_at)}</Row>}
        <Row label="Tags">
          {file.tags.length ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {file.tags.map((t) => (
                <span key={t} className="rounded-md bg-white/10 px-2 py-0.5 text-xs">
                  #{t}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-white/40">No tags</span>
          )}
        </Row>
        <Row label="Description">
          {file.description ? <span className="whitespace-pre-wrap">{file.description}</span> : <span className="text-white/40">No description</span>}
        </Row>
      </dl>
    </div>
  );
}
