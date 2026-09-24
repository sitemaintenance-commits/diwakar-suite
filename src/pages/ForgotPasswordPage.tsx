import { useState, type FormEvent } from 'react';
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // Do not reveal whether the email exists; only surface rate-limit style errors.
    if (error && error.status === 429) setError('Too many requests. Please wait a minute and try again.');
    else setSent(true);
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
