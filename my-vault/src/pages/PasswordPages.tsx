import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertCircle, ArrowLeft, CheckCircle2, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { clearRecoverySession, isRecoverySession, supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';

export const MIN_PASSWORD = 8;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email address.');
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    // Don't reveal whether an account exists; only surface transport/rate errors.
    if (error && (error.status === 429 || /network|fetch/i.test(error.message))) setError(getErrorMessage(error));
    else setSent(true);
  };

  return (
    <AuthLayout>
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h2 className="text-2xl font-bold tracking-tight text-ink">Reset password</h2>
      <p className="mt-1.5 mb-8 text-sm text-muted">We’ll email you a secure link to choose a new password.</p>
      {sent ? (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-sm text-ink">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <p>If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox and spam folder.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          <Field label="Email" htmlFor="reset-email">
            <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail className="size-4" />} autoFocus />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('Passwords do not match.');
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(getErrorMessage(error));
    clearRecoverySession();
    toast.success('Password updated');
    navigate('/', { replace: true });
  };

  return (
    <AuthLayout redirectIfSignedIn={false}>
      <h2 className="text-2xl font-bold tracking-tight text-ink">Choose a new password</h2>
      {session && !isRecoverySession() ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-muted">You’re already signed in. To change your password, use Settings → Security, which asks for your current password.</p>
          <Button className="w-full" size="lg" onClick={() => navigate('/settings')}>
            Go to Settings
          </Button>
        </div>
      ) : !session ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-muted">This reset link is invalid or has expired. Request a new one to continue.</p>
          <Button className="w-full" size="lg" onClick={() => navigate('/forgot-password')}>
            Request new link
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          <Field label="New password" htmlFor="new-password" hint={`At least ${MIN_PASSWORD} characters.`}>
            <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} leftIcon={<Lock className="size-4" />} autoFocus />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-password">
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} leftIcon={<Lock className="size-4" />} />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
