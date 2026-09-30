import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { EditFileDialog, type EditFocus } from '@/components/files/EditFileDialog';
import * as svc from '@/services/files';
import { invalidateLibrary, patchCachedFiles, removeCachedFiles } from '@/lib/queryClient';
import { getErrorMessage } from '@/lib/errors';
import { CATEGORIES } from '@/lib/categories';
import type { Category, VaultFileRow } from '@/types';
import { pluralize } from '@/utils/format';

interface FileActions {
  download: (file: VaultFileRow) => Promise<void>;
  downloadMany: (files: VaultFileRow[]) => Promise<void>;
  setFavorite: (files: VaultFileRow[], value: boolean) => Promise<boolean>;
  toggleFavorite: (file: VaultFileRow) => Promise<boolean>;
  edit: (file: VaultFileRow, focus?: EditFocus) => void;
  trash: (files: VaultFileRow[]) => Promise<boolean>;
  restore: (files: VaultFileRow[]) => Promise<boolean>;
  deleteForever: (files: VaultFileRow[]) => Promise<boolean>;
  emptyTrash: () => Promise<boolean>;
  moveCategory: (files: VaultFileRow[], category: Category) => Promise<boolean>;
}

const Ctx = createContext<FileActions | null>(null);

export function FileActionsProvider({ children }: { children: ReactNode }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ file: VaultFileRow; focus: EditFocus } | null>(null);

  const download = useCallback(async (file: VaultFileRow) => {
    try {
      await svc.downloadFile(file);
    } catch (err) {
      toast.error('Download failed', { description: getErrorMessage(err) });
    }
  }, []);

  const downloadMany = useCallback(
    async (files: VaultFileRow[]) => {
      if (files.length === 1) return download(files[0]);
      const id = toast.loading(`Preparing ${pluralize(files.length, 'file')}…`);
      try {
        await svc.downloadAsZip(files, (done) => toast.loading(`Packing ${done} of ${files.length}…`, { id }));
        toast.success('ZIP download started', { id });
      } catch (err) {
        toast.error('Bulk download failed', { id, description: getErrorMessage(err) });
      }
    },
    [download],
  );

  const setFavorite = useCallback(async (files: VaultFileRow[], value: boolean) => {
    const ids = files.map((f) => f.id);
    patchCachedFiles(ids, { is_favorite: value });
    try {
      await svc.setFavorite(ids, value);
      invalidateLibrary();
      if (files.length > 1) toast.success(value ? `Added ${files.length} files to favorites` : `Removed ${files.length} files from favorites`);
      return true;
    } catch (err) {
      patchCachedFiles(ids, { is_favorite: !value });
      toast.error('Could not update favorites', { description: getErrorMessage(err) });
      return false;
    }
  }, []);

  const toggleFavorite = useCallback((file: VaultFileRow) => setFavorite([file], !file.is_favorite), [setFavorite]);

  const restore = useCallback(async (files: VaultFileRow[]) => {
    const ids = files.map((f) => f.id);
    removeCachedFiles(ids);
    try {
      await svc.restoreFromTrash(ids);
      toast.success(files.length === 1 ? `Restored “${files[0].display_name}”` : `Restored ${files.length} files`);
      return true;
    } catch (err) {
      toast.error('Restore failed', { description: getErrorMessage(err) });
      return false;
    } finally {
      invalidateLibrary();
    }
  }, []);

  const trash = useCallback(
    async (files: VaultFileRow[]) => {
      const ids = files.map((f) => f.id);
      removeCachedFiles(ids);
      try {
        await svc.moveToTrash(ids);
        toast.success(files.length === 1 ? `Moved “${files[0].display_name}” to trash` : `Moved ${files.length} files to trash`, {
          action: { label: 'Undo', onClick: () => void restore(files) },
        });
        return true;
      } catch (err) {
        toast.error('Could not move to trash', { description: getErrorMessage(err) });
        return false;
      } finally {
        invalidateLibrary();
      }
    },
    [restore],
  );

  const deleteForever = useCallback(
    async (files: VaultFileRow[]) => {
      const ok = await confirm({
        title: files.length === 1 ? 'Delete file permanently?' : `Delete ${files.length} files permanently?`,
        message: (
          <>
            {files.length === 1 ? (
              <>
                <strong className="text-ink">{files[0].display_name}</strong> will be erased from your vault.
              </>
            ) : (
              <>These files will be erased from your vault.</>
            )}{' '}
            This cannot be undone.
          </>
        ),
        confirmLabel: 'Delete permanently',
        danger: true,
      });
      if (!ok) return false;
      const id = toast.loading('Deleting…');
      try {
        const n = await svc.deletePermanently(files);
        removeCachedFiles(files.map((f) => f.id));
        toast.success(`Permanently deleted ${pluralize(n, 'file')}`, { id });
        return true;
      } catch (err) {
        toast.error('Delete failed', { id, description: getErrorMessage(err) });
        return false;
      } finally {
        invalidateLibrary();
      }
    },
    [confirm],
  );

  const emptyTrash = useCallback(async () => {
    const ok = await confirm({
      title: 'Empty trash?',
      message: 'Every file in the trash will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (!ok) return false;
    const id = toast.loading('Emptying trash…');
    try {
      const n = await svc.emptyTrash();
      toast.success(n ? `Permanently deleted ${pluralize(n, 'file')}` : 'Trash is already empty', { id });
      return true;
    } catch (err) {
      toast.error('Could not empty trash', { id, description: getErrorMessage(err) });
      return false;
    } finally {
      invalidateLibrary();
    }
  }, [confirm]);

  const moveCategory = useCallback(async (files: VaultFileRow[], category: Category) => {
    try {
      for (const f of files) await svc.updateFile(f.id, { category });
      removeCachedFiles(files.map((f) => f.id));
      toast.success(`Moved to ${CATEGORIES[category].plural}`);
      return true;
    } catch (err) {
      toast.error('Could not move file', { description: getErrorMessage(err) });
      return false;
    } finally {
      invalidateLibrary();
    }
  }, []);

  const edit = useCallback((file: VaultFileRow, focus: EditFocus = 'name') => setEditing({ file, focus }), []);

  const value = useMemo<FileActions>(
    () => ({ download, downloadMany, setFavorite, toggleFavorite, edit, trash, restore, deleteForever, emptyTrash, moveCategory }),
    [download, downloadMany, setFavorite, toggleFavorite, edit, trash, restore, deleteForever, emptyTrash, moveCategory],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <EditFileDialog
        file={editing?.file ?? null}
        focus={editing?.focus ?? 'name'}
        onClose={() => setEditing(null)}
      />
    </Ctx.Provider>
  );
}

export function useFileActions() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFileActions must be used inside FileActionsProvider');
  return ctx;
}
