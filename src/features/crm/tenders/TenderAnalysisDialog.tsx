import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import type { TenderBrief } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { uploadDocument } from '@/features/crm/api';
import { AiSummaryView } from './TenderAi';
import { callTenderAi, fieldsToForm, jobExpired, jobProgressText, saveTenderSummary, type AnalysisJob, type StoredFile } from './ai';
import { TenderFormDialog } from './TenderFormDialog';

type Job = AnalysisJob;
const expired = jobExpired;
const progressText = jobProgressText;

export function TenderAnalysisDialog({ open, onOpenChange, tenderId, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; tenderId?: string; onCreated?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  // A brief written here, kept for this job until the dialog closes (saved on the tender when there is one).
  const [brief, setBrief] = useState<TenderBrief | null>(null);
  const [briefFor, setBriefFor] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: ['tender-analysis', tenderId ?? 'new'], enabled: open,
    queryFn: async () => {
      let query = supabase.from('tender_analysis_jobs').select('*').order('created_at', { ascending: false }).limit(20);
      query = tenderId ? query.eq('tender_id', tenderId) : query.is('tender_id', null);
      const { data, error } = await query;
      if (error) throw error;
      return data as Job[];
    },
    refetchInterval: open ? 4000 : false,
  });
  const job = jobs.data?.find((j) => j.id === selected) ?? jobs.data?.[0];
  const running = job?.status === 'processing' && !expired(job);

  async function start(existing?: StoredFile[]) {
    if (!existing && !files.length) return toast.error('Choose the main RfS / RFP PDF and any related PDFs.');
    if (!existing && (files.length > 8 || files.reduce((sum, f) => sum + f.size, 0) > 50_000_000)) return toast.error('Choose up to 8 PDFs, at most 50 MB combined.');
    setBusy(true);
    const uploaded: StoredFile[] = [];
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error('Please sign in again.');
      if (!existing) for (const file of files) {
        if (!/\.pdf$/i.test(file.name) || new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== '%PDF-') throw new Error(`${file.name} is not a PDF.`);
        const path = `${auth.user.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-() ]/g, '_').slice(-120)}`;
        const up = await supabase.storage.from('tender-analysis').upload(path, file, { contentType: 'application/pdf' });
        if (up.error) throw up.error;
        uploaded.push({ path, name: file.name });
      }
      const result = await callTenderAi<{ id: string }>({ action: 'analyse', files: existing ?? uploaded, tender_id: tenderId });
      setSelected(result.id);
      setFiles([]);
      await jobs.refetch();
      toast.success('Analysis started. You can close this window and return later.');
    } catch (e) {
      // Keep uploads on an ambiguous network failure: a server job may already be reading them.
      toast.error(errorMessage(e));
    } finally { setBusy(false); }
  }

  async function attachToTender(id: string) {
    if (!job?.result) return;
    for (const file of job.files) {
      const downloaded = await supabase.storage.from('tender-analysis').download(file.path);
      if (downloaded.error) throw downloaded.error;
      await uploadDocument({ moduleKey: 'crm.tenders', entityType: 'tender', entityId: id,
        file: new File([downloaded.data], file.name, { type: 'application/pdf' }), category: 'Tender analysis source' });
    }
    // Keep a brief written in this dialog with the analysis.
    await saveTenderSummary(id, briefFor === job.id && brief ? { ...job.result.summary, brief } : job.result.summary, 'pdf', []);
    await qc.invalidateQueries({ queryKey: ['tender', id] });
    await qc.invalidateQueries({ queryKey: ['documents', 'tender', id] });
  }

  return <>
    <Dialog open={open && !formOpen} onOpenChange={(value) => { if (!busy) { onOpenChange(value); if (tenderId) void qc.invalidateQueries({ queryKey: ['tender', tenderId] }); } }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Analyse tender PDF</DialogTitle><DialogDescription>Upload the full RfS / RFP, plus GCC, SCC, BOQ and corrigenda as PDFs. Scanned pages are supported; clear scans give better results. Up to 8 files, 50 MB combined and 1,000 pages total.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <label className="block rounded-lg border-2 border-dashed p-4 text-sm">Choose tender package
            <input className="mt-2 block w-full" aria-label="Tender PDF package" type="file" accept="application/pdf,.pdf" multiple disabled={busy || running} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          {files.length > 0 && <ul className="text-sm">{files.map((f, i) => <li key={i}>{f.name} · {(f.size / 1_000_000).toFixed(1)} MB</li>)}</ul>}
          <p className="text-xs text-slate-500">Go/no-go uses the company profile saved in System Settings. Missing evidence requires review. For captcha or login portals, download the full document from the official site and upload it here.</p>
          <Button disabled={busy || running || !files.length} onClick={() => void start()}>{busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload and run all five steps</Button>
          {jobs.isLoading && <p>Loading saved analyses…</p>}
          {jobs.error && <p role="alert" className="text-red-700">{errorMessage(jobs.error)}</p>}
          {!!jobs.data?.length && <label className="block text-sm">Saved analyses<select className="mt-1 block w-full rounded-md border p-2" value={job?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>{jobs.data.map((j) => <option key={j.id} value={j.id}>{new Date(j.created_at).toLocaleString()} · {j.files.map((f) => f.name).join(', ')} · {expired(j) ? 'timed out' : j.status}</option>)}</select></label>}
          {running && <div role="status" className="rounded-lg bg-violet-50 p-4 text-sm text-violet-800"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{progressText(job)} A 300-page RfS usually takes 2–5 minutes. You can close this window; return here for saved results.</div>}
          {job && (job.status === 'failed' || expired(job)) && <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-4 text-sm"><p>{expired(job) ? 'The analysis stopped making progress. Retry; if it happens again, upload the main RfS on its own.' : job.error}</p><Button variant="outline" disabled={busy} onClick={() => void start(job.files)}>Retry analysis</Button></div>}
          {job?.status === 'completed' && job.result && <div className="space-y-4"><AiSummaryView summary={briefFor === job.id && brief ? { ...job.result.summary, brief } : job.result.summary} fields={job.result.fields} tenderId={job.tender_id ?? undefined} onBrief={(b) => { setBrief(b); setBriefFor(job.id); }} /><p className="text-xs text-slate-500">Verify cited clauses and page numbers in the originals before committing to a bid.</p>{tenderId ? <Button disabled={busy} onClick={async () => { setBusy(true); try { await attachToTender(tenderId); toast.success('Source PDFs attached and analysis saved'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>Attach source PDFs to tender</Button> : <Button onClick={() => setFormOpen(true)}>Create tender from analysis</Button>}</div>}
        </div>
      </DialogContent>
    </Dialog>
    <TenderFormDialog open={formOpen} onOpenChange={setFormOpen} tender={null} prefill={job?.result ? fieldsToForm(job.result.fields) : undefined} afterCreate={attachToTender} onSaved={(id) => { onOpenChange(false); onCreated?.(id); }} />
  </>;
}
