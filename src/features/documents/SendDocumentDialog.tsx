// Send a document to anyone by email, as an attachment, from the suite.
// The email goes out through the send-document function; until email is set
// up (or for a quick send from a phone) the document can also be shared with
// the phone's apps, or emailed as a download link that works for 7 days.
import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Link2, Loader2, Mail, Share2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/common';

export interface SendableDoc {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
}

const LINK_DAYS = 7;
const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${fmtNumber(b / 1024 / 1024, 1)} MB` : `${fmtNumber(Math.max(1, b / 1024))} KB`);
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

export function SendDocumentDialog({ doc, onClose }: { doc: SendableDoc | null; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'send' | 'share' | 'link' | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setTo('');
    setCc('');
    setSubject(doc.file_name);
    setMessage('Please find the document attached.');
    setNotSetUp(false);
  }, [doc]);

  if (!doc) return null;
  const d = doc;
  const canShareFiles = typeof navigator !== 'undefined' && 'canShare' in navigator;

  async function send() {
    const list = split(to);
    const bad = [...list, ...split(cc)].filter((e) => !EMAIL_RE.test(e));
    if (!list.length) return toast.error('Add the email address to send it to.');
    if (bad.length) return toast.error(`Check these addresses: ${bad.join(', ')}`);
    if (!subject.trim()) return toast.error('Add a subject.');
    setBusy('send');
    try {
      const { data, error } = await supabase.functions.invoke('send-document', {
        body: { document_ids: [d.id], to: list, cc: split(cc), subject: subject.trim(), message },
      });
      if (error) {
        let payload: { error?: string; code?: string } | null = null;
        if (error instanceof FunctionsHttpError) payload = await error.context.json().catch(() => null);
        if (payload?.code === 'not_configured') {
          setNotSetUp(true);
          return;
        }
        throw new Error(payload?.error ?? error.message);
      }
      toast.success(`Sent to ${(data?.sent_to ?? list).join(', ')}`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** Hand the file itself to the phone's apps (WhatsApp, Gmail, Outlook...). */
  async function share() {
    setBusy('share');
    try {
      const { data, error } = await supabase.storage.from('documents').download(d.storage_path);
      if (error || !data) throw error ?? new Error('Could not read the file.');
      const file = new File([data], d.file_name, { type: d.mime_type || data.type || 'application/octet-stream' });
      if (!navigator.canShare?.({ files: [file] })) {
        throw new Error('This browser cannot share files. Use Email link instead, or open the suite on your phone.');
      }
      await navigator.share({ files: [file], title: subject || d.file_name, text: message || undefined });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** Open the mail app with a download link that works for a week. */
  async function emailLink() {
    setBusy('link');
    try {
      const { data, error } = await supabase.storage.from('documents')
        .createSignedUrl(d.storage_path, LINK_DAYS * 24 * 3600, { download: d.file_name });
      if (error || !data) throw error ?? new Error('Could not make a link.');
      const body = `${message ? `${message}\n\n` : ''}${d.file_name}:\n${data.signedUrl}\n\n(The link works for ${LINK_DAYS} days.)`;
      const params = [
        split(cc).length ? `cc=${encodeURIComponent(split(cc).join(','))}` : '',
        `subject=${encodeURIComponent(subject || d.file_name)}`,
        `body=${encodeURIComponent(body)}`,
      ].filter(Boolean).join('&');
      window.location.href = `mailto:${split(to).map(encodeURIComponent).join(',')}?${params}`;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send document</DialogTitle>
          <DialogDescription>
            {d.file_name}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''} goes as an email attachment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="To" required hint="One or more addresses, separated by commas.">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" inputMode="email" autoFocus />
          </Field>
          <Field label="CC">
            <Input value={cc} onChange={(e) => setCc(e.target.value)} inputMode="email" />
          </Field>
          <Field label="Subject" required>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Message">
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          {notSetUp && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Sending email from the suite is not switched on yet. Use <b>Email link</b> (opens your mail app with a download link) or <b>Share</b> on a phone for now.
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {canShareFiles && (
              <Button variant="outline" disabled={!!busy} onClick={() => void share()} title="Share the file with WhatsApp, Gmail and other apps">
                {busy === 'share' ? <Loader2 className="animate-spin" /> : <Share2 />} Share
              </Button>
            )}
            <Button variant="outline" disabled={!!busy} onClick={() => void emailLink()} title={`Opens your mail app with a download link (works ${LINK_DAYS} days)`}>
              {busy === 'link' ? <Loader2 className="animate-spin" /> : <Link2 />} Email link
            </Button>
          </div>
          <Button disabled={!!busy} onClick={() => void send()}>
            {busy === 'send' ? <Loader2 className="animate-spin" /> : <Mail />} Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
