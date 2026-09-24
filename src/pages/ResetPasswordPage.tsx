// Used for both "forgot password" links and invitation links: the user
// arrives with a temporary session and chooses a password.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/pages/AuthLayout';
import { FullPageLoader } from '@/components/common/FullPageLoader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common';

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use a mix of letters and numbers.';
  return null;
}

export function ResetPasswordPage() {
  const { session, loading, clearPasswordSetup } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <FullPageLoader />;

  if (!session) {
    return (
      <AuthLayout title="Link expired" subtitle="This password link is invalid or has already been used.">
        <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  const problem = password ? passwordProblem(password) : null;
  const mismatch = confirm && confirm !== password ? 'Passwords do not match.' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (passwordProblem(password) || password !== confirm) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    await supabase.rpc('log_event', { p_action: 'password.change', p_module: 'auth', p_summary: 'Password set', p_details: null });
    clearPasswordSetup();
    window.history.replaceState(null, '', '/');
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Choose your password" subtitle={<>Signed in as <strong>{session.user.email}</strong></>}>
      <form onSubmit={onSubmit} className="grid gap-5">
        <Field label="New password" htmlFor="pw" error={problem} hint="At least 8 characters, letters and numbers.">
          <Input id="pw" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="pw2" error={mismatch}>
          <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" size="lg" disabled={busy || !password || Boolean(problem) || password !== confirm}>
          {busy && <Loader2 className="animate-spin" />} Save password
        </Button>
      </form>
    </AuthLayout>
  );
}
