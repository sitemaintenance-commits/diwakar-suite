// New request / edit request. A new request can be saved as a draft or
// submitted straight away; a request returned for changes is edited and
// resubmitted. Attachments are uploaded once the request exists.
import { useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Paperclip, Save, Send, X } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { todayIST } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import {
  CATEGORIES, FILE_ACCEPT, PRIORITIES, checkFile, fmtSize, saveRequest, uploadApprovalFile, useFormOptions,
  type ApprovalRequest, type Priority, type RequestInput,
} from '@/features/approvals/api';

const NONE = '__none__';

export function RequestForm({ open, request, onClose, onSaved }: {
  open: boolean;
  /** The request being edited; null for a new one. */
  request: ApprovalRequest | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const options = useFormOptions(open);
  const blank = (): RequestInput => ({
    category: 'purchase', priority: 'normal', title: '', details: '', amount: '', needed_by: '',
    department_id: options.data?.my_department_id ?? '', site_id: '', project_id: '', note: '',
  });
  const [f, setF] = useState<RequestInput>(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Load the form when it opens (and once the caller's department is known).
  const key = open ? (request?.id ?? `new:${options.data ? 'ready' : 'wait'}`) : null;
  if (key && key !== loadedFor) {
    setLoadedFor(key);
    setFiles([]);
    setF(request ? {
      category: request.category, priority: request.priority, title: request.title, details: request.details ?? '',
      amount: request.amount == null ? '' : String(request.amount), needed_by: request.needed_by ?? '',
      department_id: request.department_id ?? '', site_id: request.site_id ?? '', project_id: request.project_id ?? '', note: '',
    } : blank());
  }
  const set = <K extends keyof RequestInput>(k: K, v: RequestInput[K]) => setF((s) => ({ ...s, [k]: v }));
  const close = () => { if (!busy) { setLoadedFor(null); onClose(); } };

  const isNew = !request;
  const returned = request?.status === 'returned';
  const draft = request?.status === 'draft';
  const canSubmit = isNew || draft || returned;
  const submitted = request && request.round > 0;
  const workflow = options.data?.workflows.find((w) => w.category === f.category) ?? options.data?.workflows.find((w) => w.category === null);

  async function save(submit: boolean) {
    if (f.title.trim().length < 3) return toast.error('Give the request a title.');
    if (f.amount && Number.isNaN(Number(f.amount.replace(/[,\s₹]/g, '')))) return toast.error('The amount should be a number.');
    setBusy(submit ? 'submit' : 'draft');
    let id = request?.id ?? null;
    try {
      // Files go up first against a saved draft, so a failed upload never leaves a submitted request without them.
      id = await saveRequest(f, id, false);
      for (const file of files) await uploadApprovalFile(id, file);
      if (submit) await saveRequest(f, id, true);
      toast.success(submit ? (returned ? 'Request resubmitted' : 'Request submitted for approval') : isNew ? 'Saved as draft' : 'Changes saved');
      setLoadedFor(null);
      onClose();
      onSaved(id);
    } catch (e) {
      toast.error(errorMessage(e));
      if (isNew && id) { setLoadedFor(null); onClose(); onSaved(id); } // the draft exists: open it
    } finally {
      setBusy(null);
    }
  }

  const opt = (rows: { id: string; name: string }[] | undefined, none: string): [string, string][] =>
    [[NONE, none], ...(rows ?? []).map((r) => [r.id, r.name] as [string, string])];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New approval request' : returned ? 'Update and resubmit' : `Edit ${request.request_no}`}</DialogTitle>
          <DialogDescription>
            {returned && request.decision_note
              ? `Returned for changes: ${request.decision_note}`
              : workflow?.levels?.length
                ? `Goes through ${workflow.levels.length} level${workflow.levels.length > 1 ? 's' : ''}: ${workflow.levels.join(' → ')}.`
                : 'Fill in the request; it goes through the approval levels set for its type.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Request type" required hint={submitted ? 'The type cannot change after submission.' : undefined}>
            {submitted ? (
              <Input value={CATEGORIES[f.category] ?? f.category} disabled />
            ) : (
              <FilterSelect value={f.category} onChange={(v) => set('category', v)}
                options={Object.entries(CATEGORIES).map(([k, v]) => [k, v] as [string, string])} />
            )}
          </Field>
          <Field label="Priority">
            <FilterSelect value={f.priority} onChange={(v) => set('priority', v as Priority)}
              options={Object.entries(PRIORITIES).map(([k, v]) => [k, v.label] as [string, string])} />
          </Field>
          <Field label="Request title" required className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={200}
              placeholder="e.g. 20 MC4 connectors for the Sadas plant" />
          </Field>
          <Field label="Request details" className="sm:col-span-2" hint="Why it is needed, quantities, vendor, dates.">
            <Textarea rows={4} value={f.details} onChange={(e) => set('details', e.target.value)} />
          </Field>
          <Field label="Amount (₹)">
            <Input inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" />
          </Field>
          <Field label="Needed by">
            <Input type="date" value={f.needed_by} min={isNew ? todayIST() : undefined} onChange={(e) => set('needed_by', e.target.value)} />
          </Field>
          <Field label="Department">
            <FilterSelect value={f.department_id || NONE} onChange={(v) => set('department_id', v === NONE ? '' : v)}
              options={opt(options.data?.departments, 'No department')} />
          </Field>
          <Field label="Project / site">
            <FilterSelect
              value={f.project_id ? `p:${f.project_id}` : f.site_id ? `s:${f.site_id}` : NONE}
              onChange={(v) => setF((s) => ({ ...s, project_id: v.startsWith('p:') ? v.slice(2) : '', site_id: v.startsWith('s:') ? v.slice(2) : '' }))}
              options={[[NONE, 'None'],
                ...(options.data?.projects ?? []).map((p) => [`p:${p.id}`, `Project · ${p.name}`] as [string, string]),
                ...(options.data?.sites ?? []).map((s) => [`s:${s.id}`, `Site · ${s.name}`] as [string, string])]} />
          </Field>
          {returned && (
            <Field label="Note to the approvers" className="sm:col-span-2">
              <Input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Two quotations attached" />
            </Field>
          )}
          <Field label="Attachments" className="sm:col-span-2" hint="PDF, Word, Excel, JPG or PNG — up to 25 MB each.">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground hover:bg-muted/50">
              <Paperclip className="h-4 w-4" /> Choose files…
              <input type="file" multiple accept={FILE_ACCEPT} className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  const problems = picked.map(checkFile).filter(Boolean);
                  problems.forEach((p) => toast.error(p));
                  setFiles((cur) => [...cur, ...picked.filter((x) => !checkFile(x))]);
                  e.target.value = '';
                }} />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 divide-y rounded-lg border text-sm">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{fmtSize(file.size)}</span>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${file.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={!!busy} onClick={close}>Cancel</Button>
          {(isNew || draft || returned || !canSubmit) && (
            <Button variant={canSubmit ? 'outline' : 'default'} disabled={!!busy} onClick={() => void save(false)}>
              {busy === 'draft' ? <Loader2 className="animate-spin" /> : <Save />} {isNew || draft ? 'Save as draft' : 'Save changes'}
            </Button>
          )}
          {canSubmit && (
            <Button disabled={!!busy} onClick={() => void save(true)}>
              {busy === 'submit' ? <Loader2 className="animate-spin" /> : <Send />} {returned ? 'Resubmit' : 'Submit for approval'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
