import { useEffect, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Input';
import { updateFile } from '@/services/files';
import { patchCachedFiles } from '@/lib/queryClient';
import { getErrorMessage } from '@/lib/errors';
import type { VaultFile, VaultFileRow } from '@/types';

export type EditFocus = 'name' | 'tags' | 'description';

export function EditFileDialog({
  file,
  focus,
  onClose,
  onSaved,
}: {
  file: VaultFileRow | null;
  focus: EditFocus;
  onClose: () => void;
  onSaved?: (row: VaultFileRow) => void;
}) {
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setName(file.display_name);
    setTags(file.tags);
    setTagInput('');
    setDescription(file.description);
    setError(null);
  }, [file]);

  const addTag = (raw: string) => {
    const parts = raw
      .split(',')
      .map((t) => t.trim().toLowerCase().slice(0, 40))
      .filter(Boolean);
    if (!parts.length) return;
    setTags((prev) => [...new Set([...prev, ...parts])].slice(0, 30));
    setTagInput('');
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length) {
      setTags((t) => t.slice(0, -1));
    }
  };

  const save = async () => {
    if (!file) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Name cannot be empty.');
    const finalTags = tagInput.trim() ? [...new Set([...tags, ...tagInput.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)])] : tags;
    setSaving(true);
    setError(null);
    try {
      const row = await updateFile(file.id, { display_name: trimmed, tags: finalTags, description: description.trim() });
      patchCachedFiles([file.id], row as Partial<VaultFile>);
      onSaved?.(row);
      toast.success('File updated');
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(file)}
      onClose={onClose}
      dismissible={!saving}
      title="Edit file details"
      description={file?.original_name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" htmlFor="edit-name" error={error}>
          <Input
            id="edit-name"
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
            data-autofocus={focus === 'name' ? true : undefined}
            onFocus={(e) => focus === 'name' && e.currentTarget.select()}
          />
        </Field>
        <Field label="Tags" htmlFor="edit-tags" hint="Press Enter or comma to add. Up to 30 tags.">
          <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-ink">
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags((p) => p.filter((x) => x !== t))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="edit-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKey}
              onBlur={() => addTag(tagInput)}
              placeholder={tags.length ? '' : 'e.g. receipts, 2025, travel'}
              className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-faint"
              data-autofocus={focus === 'tags' ? true : undefined}
            />
          </div>
        </Field>
        <Field label="Description" htmlFor="edit-desc">
          <Textarea
            id="edit-desc"
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add notes to make this file easier to find"
            data-autofocus={focus === 'description' ? true : undefined}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
