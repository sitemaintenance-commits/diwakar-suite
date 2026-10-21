import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Loader2, MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from '@/pages/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // Do not reveal whether the email exists; do say when the mail could not go out.
    if (error && error.status === 429) {
      setSent(false);
      setError('Too many reset emails were sent in a short time. Please wait a few minutes and try again.');
    } else if (error && (error.status ?? 500) >= 500) {
      setSent(false);
      setError('The reset email could not be sent just now. Please try again in a minute, or ask an admin to reset your password.');
    } else {
      setSent(true);
      setWait(60);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a secure link to choose a new password.">
      {sent ? (
        <div className="rounded-xl border bg-card p-6 text-center shadow-card">
          <MailCheck className="mx-auto h-10 w-10 text-primary" />
          <p className="mt-3 font-semibold">Check your inbox</p>
          <p className="mt-1 text-sm text-muted-foreground">
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            It usually arrives within a minute. Check your <strong>Spam</strong> or <strong>Promotions</strong> folder too.
            Only the newest link works.
          </p>
          <Button variant="outline" size="sm" className="mt-4" disabled={busy || wait > 0} onClick={() => void onSubmit()}>
            {busy && <Loader2 className="animate-spin" />} {wait > 0 ? `Send again in ${wait}s` : 'Send the link again'}
          </Button>
          <br />
          <Link to="/login" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-5">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" disabled={busy || !email}>
            {busy && <Loader2 className="animate-spin" />} Send reset link
          </Button>
          <Link to="/login" className="text-center text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
