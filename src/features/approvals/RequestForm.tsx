// New request / edit request. A new request can be saved as a draft or
// submitted straight away; a request returned for changes is edited and
// resubmitted. Attachments are uploaded once the request exists. Before
// the first submission the requester chooses the approvers, in order; the
// Accounts head is always the last level.
//
// What is typed is kept in this browser as it is typed, so closing the
// form, leaving the page or coming back later finds it still filled in.
// The copy is removed once the request is saved or submitted, or when the
// user starts over. (Picked files cannot be kept; they are chosen again.)
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Lock, Paperclip, Plus, RotateCcw, Save, Send, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { todayIST } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import {
  ACCOUNTS_LAST_BY_DEFAULT, CATEGORIES, CONVEYANCE_MODES, FILE_ACCEPT, PRIORITIES, checkFile, fmtSize, linkApprovalSource, saveRequest, setApprovers, uploadApprovalFile, useFormOptions,
  type ApprovalRequest, type ApprovalSource, type Priority, type RequestInput,
} from '@/features/approvals/api';

const NONE = '__none__';
const DRAFT_DAYS = 7;

interface LocalDraft { f: RequestInput; chain: string[]; savedAt: number }
function readDraft(key: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as LocalDraft;
    if (!d?.f || Date.now() - d.savedAt > DRAFT_DAYS * 86_400_000) {
      localStorage.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: LocalDraft | null) {
  try {
    if (d) localStorage.setItem(key, JSON.stringify(d));
    else localStorage.removeItem(key);
  } catch {
    /* storage full or blocked: the form still works, it just is not kept */
  }
}

export function RequestForm({ open, request, onClose, onSaved, prefill, source, context }: {
  open: boolean;
  /** The request being edited; null for a new one. */
  request: ApprovalRequest | null;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** A new request raised from somewhere else starts filled in with this. */
  prefill?: Partial<RequestInput>;
  /** The project approval or vendor bill a new request is about; it is linked once saved. */
  source?: ApprovalSource;
  /** One line saying what the request is linked to, shown at the top. */
  context?: string;
}) {
  const options = useFormOptions(open);
  const blank = (): RequestInput => ({
    category: 'purchase', priority: 'normal', title: '', details: '', amount: '', needed_by: '',
    department_id: options.data?.my_department_id ?? '', site_id: '', project_id: '', note: '',
    include_final: true, post_content: '', conveyance_mode: '',
  });
  const [f, setF] = useState<RequestInput>(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const { session } = useAuth();
  const draftKey = `approval-form:${session?.user.id ?? 'anon'}:${request?.id ?? (source ? `${source.type}:${source.id}` : 'new')}`;

  const fromRequest = (r: ApprovalRequest): RequestInput => ({
    category: r.category, priority: r.priority, title: r.title, details: r.details ?? '',
    amount: r.amount == null ? '' : String(r.amount), needed_by: r.needed_by ?? '',
    department_id: r.department_id ?? '', site_id: r.site_id ?? '', project_id: r.project_id ?? '', note: '',
    include_final: r.include_final ?? true, post_content: r.post_content ?? '', conveyance_mode: r.conveyance_mode ?? '',
  });

  // Load the form when it opens (and once the caller's department is known),
  // picking up whatever was typed last time if it was never saved.
  const key = open ? (request?.id ?? `new:${options.data ? 'ready' : 'wait'}`) : null;
  if (key && key !== loadedFor) {
    setLoadedFor(key);
    setFiles([]);
    const kept = readDraft(draftKey);
    setRestored(kept ? kept.savedAt : null);
    setChain(kept ? (kept.chain.length ? kept.chain : ['']) : request ? request.chosen_approvers ?? [] : ['']);
    setF(kept ? { ...blank(), ...prefill, ...kept.f } : request ? fromRequest(request) : { ...blank(), ...prefill });
  }

  // Keep a copy of what is typed in this browser.
  useEffect(() => {
    if (!open || !loadedFor || busy) return;
    const pristine = request ? JSON.stringify(f) === JSON.stringify(fromRequest(request))
      : !f.title.trim() && !f.details.trim() && !f.amount && !(f.post_content ?? '').trim() && !chain.some(Boolean);
    const t = window.setTimeout(() => writeDraft(draftKey, pristine ? null : { f, chain, savedAt: Date.now() }), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, chain, open, loadedFor]);

  function startOver() {
    writeDraft(draftKey, null);
    setRestored(null);
    setFiles([]);
    setChain(request ? request.chosen_approvers ?? [] : ['']);
    setF(request ? fromRequest(request) : { ...blank(), ...prefill });
  }

  const set = <K extends keyof RequestInput>(k: K, v: RequestInput[K]) => setF((s) => ({ ...s, [k]: v }));
  const close = () => { if (!busy) { setLoadedFor(null); onClose(); } };

  const isNew = !request;
  const returned = request?.status === 'returned';
  const draft = request?.status === 'draft';
  const canSubmit = isNew || draft || returned;
  const submitted = request && request.round > 0;
  const approvers = options.data?.approvers ?? [];
  const marketing = f.category === 'marketing';
  // Marketing ends with its own approver; anything else with the Accounts head when ticked.
  const accounts = options.data?.final_approver ?? null;
  const final = marketing ? options.data?.marketing_approver ?? null : f.include_final ? accounts : null;
  const nameOf = (id: string) => approvers.find((a) => a.employee_id === id)?.name ?? 'Approver';
  const chosenApprovers = chain.filter(Boolean);
  // The final approver approves once, even when also picked in the list.
  const approvalRoute = [...chosenApprovers.map(nameOf), final && !chosenApprovers.includes(final.employee_id) ? final.name : null]
    .filter(Boolean) as string[];

  async function save(submit: boolean) {
    if (f.title.trim().length < 3) return toast.error('Give the request a title.');
    if (f.amount && Number.isNaN(Number(f.amount.replace(/[,\s₹]/g, '')))) return toast.error('The amount should be a number.');
    if (submit && !submitted && approvalRoute.length === 0) return toast.error('Choose at least one approver.');
    if (submit && f.category === 'marketing' && !(f.post_content ?? '').trim()) return toast.error('Write the post content.');
    if (submit && f.category === 'local_conveyance' && !f.conveyance_mode) return toast.error('Choose the mode of conveyance.');
    setBusy(submit ? 'submit' : 'draft');
    let id = request?.id ?? null;
    try {
      // Files go up first against a saved draft, so a failed upload never leaves a submitted request without them.
      id = await saveRequest(f, id, false);
      if (isNew && source) await linkApprovalSource(id, source);
      if (!submitted) await setApprovers(id, chosenApprovers);
      for (const file of files) await uploadApprovalFile(id, file);
      if (submit) await saveRequest(f, id, true);
      writeDraft(draftKey, null);
      toast.success(submit ? (returned ? 'Request resubmitted' : 'Request submitted for approval') : isNew ? 'Saved as draft' : 'Changes saved');
      setLoadedFor(null);
      onClose();
      onSaved(id);
    } catch (e) {
      toast.error(errorMessage(e));
      if (isNew && id) { writeDraft(draftKey, null); setLoadedFor(null); onClose(); onSaved(id); } // the draft exists: open it
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
              : approvalRoute.length
                ? `Goes to ${approvalRoute.join(' → ')}, one after the other.`
                : 'Choose who approves it, in order.'}
          </DialogDescription>
        </DialogHeader>

        {context && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <span className="font-semibold">Linked to</span> <span className="text-muted-foreground">{context}</span>
          </div>
        )}
        {restored && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary-soft/60 px-3 py-2 text-xs">
            <span>
              <span className="font-semibold text-primary">Restored what you typed earlier</span>
              <span className="text-muted-foreground"> · {new Date(restored).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. Attached files need to be chosen again.</span>
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!busy} onClick={startOver}><RotateCcw /> Start over</Button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Request type" required hint={submitted ? 'The type cannot change after submission.' : undefined}>
            {submitted ? (
              <Input value={CATEGORIES[f.category] ?? f.category} disabled />
            ) : (
              <FilterSelect value={f.category} onChange={(v) => setF((s) => ({ ...s, category: v, include_final: ACCOUNTS_LAST_BY_DEFAULT.has(v) }))}
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
          {f.category === 'local_conveyance' && (
            <Field label="Mode of conveyance" required>
              <FilterSelect value={f.conveyance_mode || ''} onChange={(v) => set('conveyance_mode', v as RequestInput['conveyance_mode'])}
                placeholder="Car or bike" options={Object.entries(CONVEYANCE_MODES).map(([k, v]) => [k, v] as [string, string])} />
            </Field>
          )}
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
          {!submitted && (
            <Field label="Approvers, in order" required={!final} className="sm:col-span-2"
              hint={final
                ? `${final.name} can be the only approver. Add others here only if they should approve before ${final.name}.`
                : 'Each one approves after the one before. You can see who has approved and who is left on the request.'}>
              <ol className="grid gap-2">
                {chain.map((id, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-6 text-center text-sm font-semibold text-muted-foreground">{i + 1}</span>
                    <div className="flex-1">
                      <FilterSelect value={id} onChange={(v) => setChain((c) => c.map((x, j) => (j === i ? v : x)))} placeholder="Choose the approver"
                        options={approvers.filter((a) => a.employee_id === id || !chain.includes(a.employee_id))
                          .map((a) => [a.employee_id, a.title ? `${a.name} — ${a.title}` : a.name] as [string, string])} />
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove approver" onClick={() => setChain((c) => c.filter((_, j) => j !== i))}><X /></Button>
                  </li>
                ))}
                {marketing && final && (
                  <li className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-2 text-sm">
                    <span className="w-6 text-center font-semibold text-muted-foreground">{chosenApprovers.length + 1}</span>
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1"><span className="font-medium">{final.name}</span> — {final.title} <span className="text-xs text-muted-foreground">(always last for marketing)</span></span>
                  </li>
                )}
                {!marketing && accounts && (
                  <li>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-2 py-2 text-sm">
                      <span className="w-6 text-center font-semibold text-muted-foreground">{f.include_final ? chosenApprovers.length + 1 : ''}</span>
                      <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary,#ea580c)]" checked={!!f.include_final}
                        onChange={(e) => set('include_final', e.target.checked)} />
                      <span className="flex-1"><span className="font-medium">{accounts.name}</span> — {accounts.title} <span className="text-xs text-muted-foreground">(approves last — optional)</span></span>
                    </label>
                  </li>
                )}
              </ol>
              {chain.length < 6 && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setChain((c) => [...c, ''])}>
                  <Plus /> Add approver
                </Button>
              )}
            </Field>
          )}
          {marketing && (
            <Field label="Post content" required className="sm:col-span-2"
              hint="The caption / text of the post. Attach the post itself as a PDF below; the approvers approve both together.">
              <Textarea rows={6} value={f.post_content ?? ''} onChange={(e) => set('post_content', e.target.value)}
                placeholder={'e.g. Powering Rajasthan with clean energy ☀️\nOur 4.4 MW Bassi plant crossed 1 crore units…'} />
            </Field>
          )}
          {returned && (
            <Field label="Note to the approvers" className="sm:col-span-2">
              <Input value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Two quotations attached" />
            </Field>
          )}
          <Field label={marketing ? 'Post PDF / creatives' : 'Attachments'} className="sm:col-span-2"
            hint={marketing ? 'The post as a PDF (and images if any) — up to 25 MB each.' : 'PDF, Word, Excel, JPG or PNG — up to 25 MB each.'}>
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
