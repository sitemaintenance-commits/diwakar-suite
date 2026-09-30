import { useEffect, useRef, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import { useUploads } from '@/context/UploadContext';
import type { Category } from '@/types';

/** Drop files anywhere in the app to upload them. */
export function DropOverlay({ category }: { category: Category | 'auto' }) {
  const { addFiles, modal } = useUploads();
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || modal.open) return;
      depth.current++;
      setActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      if (!modal.open && e.dataTransfer?.files.length) addFiles(e.dataTransfer.files, category);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles, category, modal.open]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-brand/10 p-6 backdrop-blur-[2px]">
      <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-brand bg-surface px-10 py-8 text-center shadow-pop">
        <CloudUpload className="size-10 text-brand" />
        <p className="mt-3 text-base font-semibold text-ink">Drop to upload</p>
        <p className="text-sm text-muted">{category === 'screenshot' ? 'Files will be added to Screenshots' : 'Files will be sorted automatically'}</p>
      </div>
    </div>
  );
}
