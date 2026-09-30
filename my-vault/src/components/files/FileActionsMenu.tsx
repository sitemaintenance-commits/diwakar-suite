import {
  ArrowRightLeft,
  Download,
  Eye,
  MoreHorizontal,
  PencilLine,
  RotateCcw,
  Star,
  StarOff,
  Tags,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { useFileActions } from '@/context/FileActionsContext';
import type { VaultFile } from '@/types';
import { cn } from '@/utils/cn';

export function useFileMenuItems(file: VaultFile, onPreview?: () => void): MenuItem[] {
  const a = useFileActions();
  if (file.deleted_at) {
    return [
      { label: 'Restore', icon: <RotateCcw className="size-4" />, onSelect: () => void a.restore([file]) },
      { label: 'Download', icon: <Download className="size-4" />, onSelect: () => void a.download(file) },
      {
        label: 'Delete permanently',
        icon: <XCircle className="size-4" />,
        danger: true,
        separatorBefore: true,
        onSelect: () => void a.deleteForever([file]),
      },
    ];
  }
  const items: MenuItem[] = [];
  if (onPreview) items.push({ label: 'Preview', icon: <Eye className="size-4" />, onSelect: onPreview });
  items.push(
    { label: 'Download', icon: <Download className="size-4" />, onSelect: () => void a.download(file) },
    { label: 'Rename', icon: <PencilLine className="size-4" />, onSelect: () => a.edit(file, 'name') },
    { label: 'Tags & description', icon: <Tags className="size-4" />, onSelect: () => a.edit(file, 'tags') },
    {
      label: file.is_favorite ? 'Remove from favorites' : 'Add to favorites',
      icon: file.is_favorite ? <StarOff className="size-4" /> : <Star className="size-4" />,
      onSelect: () => void a.toggleFavorite(file),
    },
  );
  if (file.category === 'image') {
    items.push({ label: 'Move to Screenshots', icon: <ArrowRightLeft className="size-4" />, onSelect: () => void a.moveCategory([file], 'screenshot') });
  } else if (file.category === 'screenshot') {
    items.push({ label: 'Move to Images', icon: <ArrowRightLeft className="size-4" />, onSelect: () => void a.moveCategory([file], 'image') });
  }
  items.push(
    { label: 'Move to trash', icon: <Trash2 className="size-4" />, separatorBefore: true, onSelect: () => void a.trash([file]) },
    { label: 'Delete permanently', icon: <XCircle className="size-4" />, danger: true, onSelect: () => void a.deleteForever([file]) },
  );
  return items;
}

export function FileActionsMenu({ file, onPreview, className }: { file: VaultFile; onPreview?: () => void; className?: string }) {
  const items = useFileMenuItems(file, onPreview);
  return (
    <Menu
      items={items}
      width={216}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Actions for ${file.display_name}`}
          title="More actions"
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink',
            'focus-visible:outline-2 focus-visible:outline-brand',
            className,
          )}
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    />
  );
}
