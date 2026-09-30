import { useState } from 'react';
import { Download, RotateCcw, Star, StarOff, Trash2, X, XCircle } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { useFileActions } from '@/context/FileActionsContext';
import type { VaultFile } from '@/types';

export function BulkActionBar({
  files,
  isTrash,
  onClear,
}: {
  files: VaultFile[];
  isTrash: boolean;
  onClear: () => void;
}) {
  const a = useFileActions();
  const [busy, setBusy] = useState(false);
  if (!files.length) return null;

  const run = async (fn: () => Promise<boolean | void>) => {
    setBusy(true);
    try {
      const ok = await fn();
      if (ok !== false) onClear();
    } finally {
      setBusy(false);
    }
  };

  const allFav = files.every((f) => f.is_favorite);

  return (
    <div className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-pop sm:inset-x-6">
      <IconButton label="Clear selection" size="sm" onClick={onClear}>
        <X className="size-4" />
      </IconButton>
      <span className="mr-auto text-sm font-medium text-ink">{files.length} selected</span>
      {isTrash ? (
        <>
          <Button size="sm" variant="secondary" disabled={busy} icon={<RotateCcw className="size-4" />} onClick={() => run(() => a.restore(files))}>
            Restore
          </Button>
          <Button size="sm" variant="danger" disabled={busy} icon={<XCircle className="size-4" />} onClick={() => run(() => a.deleteForever(files))}>
            Delete forever
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={busy} icon={<Download className="size-4" />} onClick={() => run(() => a.downloadMany(files))}>
            <span className="hidden sm:inline">Download</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            icon={allFav ? <StarOff className="size-4" /> : <Star className="size-4" />}
            onClick={() => run(() => a.setFavorite(files, !allFav))}
          >
            <span className="hidden sm:inline">{allFav ? 'Unfavorite' : 'Favorite'}</span>
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} icon={<Trash2 className="size-4" />} onClick={() => run(() => a.trash(files))}>
            <span className="hidden sm:inline">Trash</span>
          </Button>
          <Button size="sm" variant="danger-ghost" disabled={busy} icon={<XCircle className="size-4" />} onClick={() => run(() => a.deleteForever(files))}>
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </>
      )}
    </div>
  );
}
