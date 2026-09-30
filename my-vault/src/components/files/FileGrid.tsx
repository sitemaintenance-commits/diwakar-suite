import type { VaultFile } from '@/types';
import { FileCard, ImageCard, type CardProps } from './FileCard';

interface Props extends Omit<CardProps, 'file' | 'selected'> {
  files: VaultFile[];
  selected: Set<string>;
}

/** Responsive grid: 2 cols on phones → 3-4 on tablets → 5-6+ on desktop. */
export function FileGrid({ files, selected, ...rest }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {files.map((f) =>
        f.category === 'image' || f.category === 'screenshot' ? (
          <ImageCard key={f.id} file={f} selected={selected.has(f.id)} {...rest} />
        ) : (
          <FileCard key={f.id} file={f} selected={selected.has(f.id)} {...rest} />
        ),
      )}
    </div>
  );
}
