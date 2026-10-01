// "Find with AI": a screenshot or a few words -> the official tender notice
// (PDF) and a summary, then a pre-filled tender. Also the AI summary card on
// the tender page.
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, FileText, ImagePlus, Loader2, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { TenderAnalysisDialog } from './TenderAnalysisDialog';
import { fmtDateTime, fmtINR } from '@/lib/format';
import type { Tender, TenderAiSummary, TenderBrief } from '@/lib/types';
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
  briefToText,
  fetchAnalysisJob,
  fieldsToForm,
  jobExpired,
  jobProgressText,
  linkAnalysis,
  lookupTender,
  prepareImage,
  saveTenderBrief,
  saveTenderSummary,
  summarizeDocument,
  startAnalysisJob,
  uploadAnalysisPdf,
  writeBrief,
  type AiFields,
  type LookupResult,
} from '@/features/crm/tenders/ai';

const MAX_IMAGES = 4;
const MAX_PDF = 50_000_000;

// ---------------------------------------------------------------- summary view
/** Saved AI output is data: show anything that is not text as text rather than let one odd item break the page. */
const asText = (v: unknown): string =>
  typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' && 'text' in v ? asText((v as { text: unknown }).text) : String(v);

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        {items.map((x, i) => (
          <li key={i}>{asText(x)}</li>
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
            <dt className="text-slate-500">{asText(x.label)}</dt>
            <dd className="font-medium text-slate-800">{asText(x.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A saved tender's details in the shape the analysis uses, for the report. */
function tenderFields(t: Tender): AiFields {
  return {
    reference_no: t.reference_no, title: t.title, authority: t.authority, portal: t.portal, tender_type: t.tender_type,
    work_type: t.work_type, state: t.state, district: t.district, location: t.location,
    capacity_kwp: t.capacity_kwp as number | null, estimated_value: t.estimated_value as number, tender_fee: t.tender_fee as number,
    emd_amount: t.emd_amount as number, emd_mode: t.emd_mode, published_on: t.published_on, prebid_at: t.prebid_at,
    submission_due_at: t.submission_due_at, technical_opening_at: t.technical_opening_at, completion_days: t.completion_days,
  };
}

// ---------------------------------------------------------------- one-page brief
function BriefPanel({ summary, fields, tenderId, onBrief }: {
  summary: TenderAiSummary; fields?: AiFields | null; tenderId?: string; onBrief?: (brief: TenderBrief) => void;
}) {
  const qc = useQueryClient();
  const [brief, setBrief] = useState<TenderBrief | undefined>(summary.brief);
  const [busy, setBusy] = useState(false);
  useEffect(() => setBrief(summary.brief), [summary.brief]);

  async function run() {
    setBusy(true);
    try {
      const b = await writeBrief(summary, fields);
      setBrief(b);
      onBrief?.(b);
      if (tenderId) {
        await saveTenderBrief(tenderId, summary, b);
        await qc.invalidateQueries({ queryKey: ['tender', tenderId] });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(briefToText(brief));
      toast.success('Summary copied — paste it into WhatsApp or an e-mail');
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  }

  if (!brief) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
        <div className="text-sm text-violet-900">
          <div className="font-semibold">Need the short version?</div>
          <div className="text-violet-800/80">A one-page summary of this analysis: key numbers, top risks, the decision and next steps.</div>
        </div>
        <Button type="button" disabled={busy} onClick={() => void run()}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? 'Summarising…' : 'Summarise'}
        </Button>
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4" aria-label="Summary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-violet-950"><Sparkles className="h-4 w-4 text-violet-500" /> Summary</h3>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}><Copy /> Copy</Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Redo
          </Button>
        </div>
      </div>
      <p className="font-medium leading-relaxed text-slate-900">{brief.headline}</p>
      {brief.at_a_glance.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg bg-white/70 p-3 text-sm sm:grid-cols-2">
          {brief.at_a_glance.map((x, i) => (
            <div key={i} className="flex gap-2"><dt className="text-slate-500">{x.label}:</dt><dd className="font-semibold text-slate-800">{x.value}</dd></div>
          ))}
        </dl>
      )}
      <List title="Key points" items={brief.key_points} />
      {brief.top_risks.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><List title="Top risks" items={brief.top_risks} /></div>}
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"><span className="font-semibold">Decision: </span>{brief.decision}</div>
      <List title="Next steps" items={brief.next_steps} />
      <p className="text-xs text-slate-500">Written from the analysis below. Verify against the tender document before bidding.</p>
    </section>
  );
}

function DownloadReportButton({ summary, fields, title }: { summary: TenderAiSummary; fields?: AiFields | null; title: string }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      // Loaded on click: the PDF library is large and most visits never need it.
      const { downloadAnalysisPdf } = await import('@/features/crm/tenders/analysisPdf');
      await downloadAnalysisPdf(summary, fields, title);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
    </Button>
  );
}

export function AiSummaryView({ summary, fields, tenderId, onBrief, title }: {
  summary: TenderAiSummary; fields?: AiFields | null; tenderId?: string; onBrief?: (brief: TenderBrief) => void;
  /** Shown on the downloaded report; defaults to the tender title in the fields. */
  title?: string;
}) {
  return (
    <div className="space-y-4">
      {/* The report works for any analysis (sections it lacks are left out);
          the short version needs the full five-step analysis. */}
      <div className="flex justify-end">
        <DownloadReportButton summary={summary} fields={fields} title={title || String(fields?.title ?? '') || 'Tender'} />
      </div>
      {summary.go_no_go && <BriefPanel summary={summary} fields={fields} tenderId={tenderId} onBrief={onBrief} />}
      <p className="text-sm leading-relaxed text-slate-700">{summary.overview}</p>
      <List title="1. Document reading / OCR coverage" items={summary.processing ?? []} />
      <h3 className="font-semibold">{summary.processing ? '2. Tender synopsis' : 'Tender synopsis'}</h3>
      <Pairs title="Key dates" items={summary.key_dates} />
      <Pairs title="Money" items={summary.financials} />
      <List title="Scope of work" items={summary.scope} />
      <List title="Eligibility" items={summary.eligibility} />
      <List title="Documents to submit" items={summary.documents_required} />
      <List title="BOQ highlights" items={summary.boq_highlights ?? []} />
      <List title="Submission requirements" items={summary.submission_requirements ?? []} />
      {summary.risk_analysis && <section className="space-y-2"><h3 className="font-semibold">3. Risk analysis</h3>{summary.risk_analysis.map((r, i) => <div key={i} className="rounded-lg border border-amber-200 p-3 text-sm"><b>{r.category} · {r.severity}</b><p>{r.finding}</p><p className="mt-1 whitespace-pre-wrap text-slate-500">{r.evidence}</p><p className="mt-1">Action: {r.action}</p></div>)}</section>}
      {summary.go_no_go && <section className="space-y-2 rounded-lg border p-3 text-sm"><h3 className="font-semibold">4. Go / no-go: {summary.go_no_go.decision}</h3><List title="Reasons" items={summary.go_no_go.reasons} />{summary.go_no_go.checks.map((c, i) => <div key={i}><b>{c.criterion} · {c.status}</b><p className="whitespace-pre-wrap text-slate-600">{c.evidence}</p></div>)}</section>}
      {summary.contradictions && <section className="space-y-2 text-sm"><h3 className="font-semibold">5. Contradiction check</h3>{summary.contradictions.length === 0 && <p>No conflicts identified in the supplied files. Check the coverage and missing information below.</p>}{summary.contradictions.map((c, i) => <div key={i} className="rounded-lg border p-3"><b>{c.finding}</b><p className="whitespace-pre-wrap text-slate-500">{c.evidence}</p><p>Action: {c.action}</p></div>)}<List title="Missing information / limits" items={summary.missing_information ?? []} /></section>}
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
  const [busy, setBusy] = useState<null | 'lookup' | 'pdf' | 'analyse'>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // The five-step analysis of the RfS runs as a background job; follow it here.
  const jobId = result?.analysis_job_id ?? null;
  const jobQuery = useQuery({
    queryKey: ['tender-analysis-job', jobId],
    enabled: open && Boolean(jobId),
    queryFn: () => fetchAnalysisJob(jobId!),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 4000 : false),
  });
  const job = jobQuery.data ?? null;
  const jobRunning = job?.status === 'processing' && !jobExpired(job);
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
  // When the analysis finishes, its fields and summary replace the web ones.
  useEffect(() => {
    if (job?.status !== 'completed' || !job.result) return;
    const done = job.result;
    setResult((cur) => {
      if (!cur || cur.analysis_job_id !== job.id || cur.summary_source === 'pdf') return cur;
      const fields = { ...cur.fields };
      for (const [k, v] of Object.entries(done.fields ?? {})) if (v !== null && v !== '') (fields as Record<string, unknown>)[k] = v;
      return { ...cur, fields, summary: done.summary, summary_source: 'pdf' };
    });
  }, [job]);

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
    if (file.size > MAX_PDF) return toast.error('The PDF is larger than 50 MB.');
    setBusy('pdf');
    try {
      const stored = await uploadAnalysisPdf(file);
      setResult({ ...result, pdf: { name: file.name, data: '', storage_path: stored.path, size: file.size }, analysis_job_id: null });
      toast.success('PDF added. Run the full analysis if you want it.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Offered until an analysis is running or done; again after one fails.
  const canRunAnalysis = !job || job.status === 'failed' || jobExpired(job);

  async function onRunAnalysis() {
    if (!result?.pdf?.storage_path) return;
    setBusy('analyse');
    try {
      const started = await startAnalysisJob([{ path: result.pdf.storage_path, name: result.pdf.name }]);
      setResult({ ...result, analysis_job_id: started.id });
      toast.success('Analysis started — a 300-page RfS usually takes 2–5 minutes.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onDownloadPdf() {
    if (!result?.pdf?.storage_path) return;
    const { data, error } = await supabase.storage.from('tender-analysis').createSignedUrl(result.pdf.storage_path, 120, { download: result.pdf.name });
    if (error) return toast.error(errorMessage(error));
    window.open(data.signedUrl, '_blank', 'noopener');
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
      const stored = result.pdf.storage_path ? await supabase.storage.from('tender-analysis').download(result.pdf.storage_path) : null;
      if (stored?.error) throw stored.error;
      const file = stored?.data ? new File([stored.data], result.pdf.name, { type: 'application/pdf' }) : base64ToFile(result.pdf.data, result.pdf.name);
      await uploadDocument({ moduleKey: 'crm.tenders', entityType: 'tender', entityId: id, file, category: 'NIT / tender document' });
    }
    // A summary of the screenshot alone adds nothing the tender fields don't
    // already hold; only keep ones backed by the PDF or the portal pages.
    if (result.summary && result.summary_source !== 'input') {
      await saveTenderSummary(id, result.summary, result.summary_source, [...result.documents, ...result.sources]);
    }
    // Analysis still running: link it, and its summary lands on the tender when done.
    if (result.analysis_job_id && result.summary_source !== 'pdf') await linkAnalysis(result.analysis_job_id, id);
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
              Paste or upload a screenshot, or type the tender number. AI looks for the full official RfS / RFP and checks that it matches this tender.
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching official portals and verifying the full tender document…
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
                  {(f.district || f.state) && <div>Location: <b className="text-slate-800">{[f.location, f.district, f.state].filter((v, i, all) => v && !all.slice(0, i).some((p) => p && String(p).includes(String(v)))).join(', ')}</b></div>}
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
                  <div className="space-y-2">
                    <p className="text-sm text-emerald-700">
                      <CheckCircle2 className="mr-1 inline h-4 w-4" />
                      {result.pdf.name} ({(result.pdf.size / 1024 / 1024).toFixed(1)} MB) — will be attached to the tender.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {result.pdf.storage_path && (
                        <Button type="button" variant="outline" size="sm" onClick={() => void onDownloadPdf()}>
                          <Download /> Download PDF
                        </Button>
                      )}
                      {result.pdf.storage_path && canRunAnalysis && (
                        <Button type="button" size="sm" disabled={busy !== null} onClick={() => void onRunAnalysis()}>
                          {busy === 'analyse' ? <Loader2 className="animate-spin" /> : <Sparkles />} {job ? 'Run the analysis again' : 'Run full analysis'}
                        </Button>
                      )}
                    </div>
                    {result.pdf.storage_path && canRunAnalysis && (
                      <p className="text-xs text-slate-500">
                        Full analysis: synopsis, risk clauses, go/no-go against your company profile and contradiction check — about 2–5 minutes for a 300-page RfS.
                      </p>
                    )}
                    {job && jobRunning && (
                      <p role="status" className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
                        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                        {jobProgressText(job)} You can create the tender now; the full analysis is added to it when done.
                      </p>
                    )}
                    {job && (job.status === 'failed' || jobExpired(job)) && (
                      <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        The full analysis did not finish ({jobExpired(job) ? 'it stopped making progress' : job.error}). Try again with Run full analysis, or create the tender and use Analyse tender PDF on it.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-amber-700">
                    A full matching tender PDF could not be confirmed or downloaded. Open the official portal, download the RfS / RFP, then use Analyse tender PDF for packages up to 50 MB.
                  </p>
                )}
                <div className="mt-3 space-y-3">
                  <Links title="Document links" links={result.documents} />
                  <Links title="Sources" links={result.sources} />
                </div>
                {result.searched_for && result.searched_for.length > 0 && (
                  <p className="mt-3 text-xs text-slate-500">
                    <span className="font-medium">Searched the web for:</span> {result.searched_for.map((q) => `“${q}”`).join(' · ')}
                  </p>
                )}
                {result.notes && <p className="mt-2 text-xs text-slate-500">{result.notes}</p>}
                {!!result.download_failures?.length && <List title="Download checks" items={result.download_failures} />}
              </div>

              {result.summary && (
                <div className="rounded-xl border p-4">
                  <h4 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                    <Sparkles className="h-4 w-4 text-violet-500" /> Summary
                    <Badge variant="secondary">{result.summary_source === 'pdf' ? 'from the PDF' : result.summary_source === 'web' ? 'from web search results' : 'from your screenshot only'}</Badge>
                  </h4>
                  <AiSummaryView summary={result.summary} fields={result.fields}
                    onBrief={(brief) => setResult((cur) => (cur?.summary ? { ...cur, summary: { ...cur.summary, brief } } : cur))} />
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
  const [analysisOpen, setAnalysisOpen] = useState(false);
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
      toast.success('Tender analysis updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canRun = can.edit && pdfs.length > 0;
  if (!tender.ai_summary && !can.edit) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-violet-500" /> Tender analysis
          {tender.ai_summary_from && <Badge variant="secondary">{tender.ai_summary_from === 'pdf' ? 'from the PDF' : 'from web search results'}</Badge>}
        </CardTitle>
        {can.edit && <Button size="sm" onClick={() => setAnalysisOpen(true)}><Upload /> Analyse tender PDF</Button>}
        {canRun && (
          <div className="flex items-center gap-2">
            {pdfs.length > 1 && (
              <FilterSelect value={chosen} onChange={setDocId} options={pdfs.map((d) => [d.id, d.file_name] as [string, string])} />
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={run}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Analyse attached PDF
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <TenderAnalysisDialog open={analysisOpen} onOpenChange={setAnalysisOpen} tenderId={tender.id} />
        {busy && <p className="text-sm text-violet-700">Reading the attached PDF and running all five checks. Keep this page open until it finishes.</p>}
        {tender.ai_summary ? (
          <>
            <AiSummaryView summary={tender.ai_summary} tenderId={can.edit ? tender.id : undefined} title={tender.title} fields={tenderFields(tender)} />
            <Links title="Sources" links={tender.ai_sources ?? []} />
            {tender.ai_summary_at && <p className="text-xs text-slate-400">Generated {fmtDateTime(tender.ai_summary_at)}. AI can make mistakes — check against the document.</p>}
          </>
        ) : (
          <p className="text-sm text-slate-500">Upload the full tender package for document reading, synopsis, clause risks, company eligibility and contradiction checks.</p>
        )}
      </CardContent>
    </Card>
  );
}
