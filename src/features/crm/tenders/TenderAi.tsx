// "Find with AI": a screenshot or a few words -> the official tender notice
// (PDF) and a summary, then a pre-filled tender. Also the AI summary card on
// the tender page.
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, ImagePlus, Loader2, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDateTime, fmtINR } from '@/lib/format';
import type { Tender, TenderAiSummary } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { uploadDocument, useDocuments } from '@/features/crm/api';
import { TENDER_TYPE_LABEL } from '@/features/crm/shared';
import { TenderFormDialog } from '@/features/crm/tenders/TenderFormDialog';
import {
  base64ToFile,
  fieldsToForm,
  fileToBase64,
  lookupTender,
  prepareImage,
  saveTenderSummary,
  summarizeDocument,
  summarizePdf,
  type AiPdf,
  type LookupResult,
} from '@/features/crm/tenders/ai';

const MAX_IMAGES = 4;
const MAX_PDF = 14 * 1024 * 1024;

// ---------------------------------------------------------------- summary view
function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Pairs({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
        {items.map((x, i) => (
          <div key={i} className="contents">
            <dt className="text-slate-500">{x.label}</dt>
            <dd className="font-medium text-slate-800">{x.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AiSummaryView({ summary }: { summary: TenderAiSummary }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-700">{summary.overview}</p>
      <Pairs title="Key dates" items={summary.key_dates} />
      <Pairs title="Money" items={summary.financials} />
      <List title="Scope of work" items={summary.scope} />
      <List title="Eligibility" items={summary.eligibility} />
      <List title="Documents to submit" items={summary.documents_required} />
      {summary.risks?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <List title="Watch out for" items={summary.risks} />
        </div>
      )}
      {summary.recommendation && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <span className="font-semibold">Recommendation: </span>
          {summary.recommendation}
        </div>
      )}
    </div>
  );
}

function Links({ title, links }: { title: string; links: { url: string; title: string }[] }) {
  if (!links?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <ul className="space-y-1 text-sm">
        {links.map((l) => (
          <li key={l.url} className="truncate">
            <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
              {l.title || l.url} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- lookup dialog
type Shot = { file: File; url: string };

export function TenderAiDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [shots, setShots] = useState<Shot[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'lookup' | 'pdf'>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  // Start clean each time the dialog opens.
  useEffect(() => {
    if (open) {
      setShots([]);
      setText('');
      setResult(null);
      setBusy(null);
    }
  }, [open]);
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  function addImages(files: FileList | File[]) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setShots((cur) => [...cur, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_IMAGES));
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      addImages(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    addImages(e.dataTransfer.files);
  };

  async function onFind() {
    if (!shots.length && !text.trim()) return toast.error('Add a screenshot or type the tender number / details.');
    setBusy('lookup');
    try {
      const images = await Promise.all(shots.map((s) => prepareImage(s.file)));
      const r = await lookupTender(images, text.trim());
      setResult(r);
      if (!r.found) toast.warning('Could not confirm this tender on an official site. Check the details below.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onOwnPdf(file: File | undefined) {
    if (!file || !result) return;
    if (file.type !== 'application/pdf') return toast.error('Choose a PDF file.');
    if (file.size > MAX_PDF) return toast.error('The PDF is larger than 14 MB.');
    setBusy('pdf');
    try {
      const pdf: AiPdf = { name: file.name, data: await fileToBase64(file), size: file.size };
      const read = await summarizePdf(pdf, text.trim());
      const fields = { ...result.fields };
      for (const [k, v] of Object.entries(read.fields)) if (v !== null && v !== '') (fields as Record<string, unknown>)[k] = v;
      setResult({ ...result, fields, summary: read.summary, summary_source: 'pdf', pdf });
      toast.success('PDF summarised');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const prefill = useMemo(() => {
    if (!result) return undefined;
    const f = fieldsToForm(result.fields);
    if (!f.title) f.title = text.trim().split('\n')[0].slice(0, 200);
    const links = [...result.documents, ...result.sources].map((l) => l.url);
    if (!f.portal_url && links[0]) f.portal_url = links[0];
    if (result.notes) f.notes = `AI lookup: ${result.notes}`;
    return f;
  }, [result, text]);

  async function afterCreate(id: string) {
    if (!result) return;
    if (result.pdf) {
      const file = base64ToFile(result.pdf.data, result.pdf.name);
      await uploadDocument({ moduleKey: 'crm.tenders', entityType: 'tender', entityId: id, file, category: 'NIT / tender document' });
    }
    if (result.summary) {
      await saveTenderSummary(id, result.summary, result.summary_source, [...result.documents, ...result.sources]);
    }
    await qc.invalidateQueries({ queryKey: ['documents', 'tender', id] });
  }

  const f = result?.fields ?? {};

  return (
    <>
      <Dialog open={open && !formOpen} onOpenChange={(o) => busy === null && onOpenChange(o)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" onPaste={onPaste}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" /> Find tender with AI
            </DialogTitle>
            <DialogDescription>
              Paste or upload a screenshot of the tender (WhatsApp forward, alert e-mail, newspaper), or type the tender number. AI finds the official notice and summarises it.
            </DialogDescription>
          </DialogHeader>

          {!result && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="rounded-xl border-2 border-dashed border-slate-200 p-4 text-center"
              >
                {shots.length > 0 ? (
                  <div className="flex flex-wrap gap-3">
                    {shots.map((s, i) => (
                      <div key={s.url} className="relative">
                        <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-28 w-auto rounded-lg border object-contain" />
                        <button
                          type="button"
                          aria-label="Remove screenshot"
                          className="absolute -top-2 -right-2 cursor-pointer rounded-full bg-slate-800 p-0.5 text-white"
                          onClick={() => setShots((cur) => cur.filter((x) => x !== s))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {shots.length < MAX_IMAGES && (
                      <button type="button" onClick={() => imageInput.current?.click()} className="flex h-28 w-24 cursor-pointer items-center justify-center rounded-lg border text-slate-400 hover:text-slate-600">
                        <ImagePlus />
                      </button>
                    )}
                  </div>
                ) : (
                  <button type="button" onClick={() => imageInput.current?.click()} className="flex w-full cursor-pointer flex-col items-center gap-2 py-6 text-sm text-slate-500">
                    <ImagePlus className="h-8 w-8 text-slate-400" />
                    <span>
                      <span className="font-medium text-primary">Upload screenshots</span>, drag them here, or press Ctrl+V to paste
                    </span>
                  </button>
                )}
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) addImages(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
              <Field label="Or describe the tender" hint="Tender / bid number, authority, title — anything you know.">
                <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. GEM/2026/B/5873210 — 500 kW rooftop solar, AVVNL Ajmer" />
              </Field>
              {busy === 'lookup' && (
                <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching official portals and reading the notice — this usually takes 30–90 seconds…
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-5">
              <div className="rounded-xl border p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {result.found ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> Found
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      <AlertTriangle className="h-3 w-3" /> Not confirmed
                    </Badge>
                  )}
                  {f.reference_no && <span className="font-mono text-xs text-slate-500">{f.reference_no}</span>}
                </div>
                <h3 className="font-semibold text-slate-900">{f.title ?? 'Untitled tender'}</h3>
                <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                  {f.authority && <div>Authority: <b className="text-slate-800">{f.authority}</b></div>}
                  {f.portal && <div>Portal: <b className="text-slate-800">{f.portal}</b></div>}
                  {f.tender_type && <div>Type: <b className="text-slate-800">{TENDER_TYPE_LABEL[String(f.tender_type)] ?? f.tender_type}</b></div>}
                  {f.submission_due_at && <div>Bid due: <b className="text-slate-800">{fmtDateTime(String(f.submission_due_at))}</b></div>}
                  {f.estimated_value != null && <div>Estimated value: <b className="text-slate-800">{fmtINR(f.estimated_value)}</b></div>}
                  {f.emd_amount != null && <div>EMD: <b className="text-slate-800">{fmtINR(f.emd_amount)}</b></div>}
                  {(f.district || f.state) && <div>Location: <b className="text-slate-800">{[f.location, f.district, f.state].filter(Boolean).join(', ')}</b></div>}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 font-semibold text-slate-900">
                    <FileText className="h-4 w-4" /> Official document
                  </h4>
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => pdfInput.current?.click()}>
                    {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <Upload />} {result.pdf ? 'Use a different PDF' : 'Upload the PDF myself'}
                  </Button>
                  <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { void onOwnPdf(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                {result.pdf ? (
                  <p className="text-sm text-emerald-700">
                    <CheckCircle2 className="mr-1 inline h-4 w-4" />
                    {result.pdf.name} ({(result.pdf.size / 1024 / 1024).toFixed(1)} MB) — will be attached to the tender.
                  </p>
                ) : (
                  <p className="text-sm text-amber-700">
                    The PDF could not be downloaded automatically (most portals put it behind a captcha or login). Open the portal link below, download the NIT and upload it here to get a summary from the document itself.
                  </p>
                )}
                <div className="mt-3 space-y-3">
                  <Links title="Document links" links={result.documents} />
                  <Links title="Sources" links={result.sources} />
                </div>
                {result.notes && <p className="mt-3 text-xs text-slate-500">{result.notes}</p>}
              </div>

              {result.summary && (
                <div className="rounded-xl border p-4">
                  <h4 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                    <Sparkles className="h-4 w-4 text-violet-500" /> Summary
                    <Badge variant="secondary">{result.summary_source === 'pdf' ? 'from the PDF' : 'from portal pages'}</Badge>
                  </h4>
                  <AiSummaryView summary={result.summary} />
                </div>
              )}
              <p className="text-xs text-slate-400">AI can make mistakes. Check dates, EMD and eligibility against the official document before bidding.</p>
            </div>
          )}

          <DialogFooter>
            {result ? (
              <>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setResult(null)}>
                  <RotateCcw /> Search again
                </Button>
                <Button type="button" disabled={busy !== null} onClick={() => setFormOpen(true)}>
                  Create tender
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={busy !== null} onClick={onFind}>
                  {busy === 'lookup' ? <Loader2 className="animate-spin" /> : <Sparkles />} Find tender
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TenderFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        tender={null}
        prefill={prefill}
        afterCreate={afterCreate}
        onSaved={(id) => {
          onOpenChange(false);
          onCreated(id);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- tender page card
export function TenderAiSummaryCard({ tender }: { tender: Tender }) {
  const can = useCan('crm.tenders');
  const qc = useQueryClient();
  const docs = useDocuments('tender', tender.id);
  const pdfs = (docs.data ?? []).filter((d) => d.mime_type === 'application/pdf' || /\.pdf$/i.test(d.file_name));
  const [docId, setDocId] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = docId || pdfs[0]?.id || '';

  async function run() {
    if (!chosen) return;
    setBusy(true);
    try {
      const read = await summarizeDocument(chosen);
      await saveTenderSummary(tender.id, read.summary, 'pdf', null);
      await qc.invalidateQueries({ queryKey: ['tender', tender.id] });
      toast.success('Summary updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canRun = can.edit && pdfs.length > 0;
  if (!tender.ai_summary && !canRun) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-violet-500" /> AI summary
          {tender.ai_summary_from && <Badge variant="secondary">{tender.ai_summary_from === 'pdf' ? 'from the PDF' : 'from portal pages'}</Badge>}
        </CardTitle>
        {canRun && (
          <div className="flex items-center gap-2">
            {pdfs.length > 1 && (
              <FilterSelect value={chosen} onChange={setDocId} options={pdfs.map((d) => [d.id, d.file_name] as [string, string])} />
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={run}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {tender.ai_summary ? 'Re-summarise PDF' : 'Summarise PDF'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {busy && <p className="text-sm text-violet-700">Reading the document — this can take up to a minute…</p>}
        {tender.ai_summary ? (
          <>
            <AiSummaryView summary={tender.ai_summary} />
            <Links title="Sources" links={tender.ai_sources ?? []} />
            {tender.ai_summary_at && <p className="text-xs text-slate-400">Generated {fmtDateTime(tender.ai_summary_at)}. AI can make mistakes — check against the document.</p>}
          </>
        ) : (
          <p className="text-sm text-slate-500">Get a two-minute summary of the attached tender PDF: scope, eligibility, dates, money and risks.</p>
        )}
      </CardContent>
    </Card>
  );
}
