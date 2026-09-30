import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AlertCircle, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { useAuth } from '@/context/AuthContext';
import { getRememberSession } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import { isConfigured } from '@/lib/env';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(getRememberSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password, remember);
      // AuthLayout redirects once the session is set.
    } catch (err) {
      setError(getErrorMessage(err, 'Sign in failed.'));
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Sign in</h2>
        <p className="mt-1.5 text-sm text-muted">Access your private digital library.</p>
      </div>

      {!isConfigured && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and add your project URL and anon key.
        </div>
      )}

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            leftIcon={<Mail className="size-4" />}
            invalid={Boolean(error)}
            autoFocus
            required
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          action={
            <Link to="/forgot-password" className="text-[13px] font-medium text-brand-ink hover:underline">
              Forgot password?
            </Link>
          }
        >
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leftIcon={<Lock className="size-4" />}
            invalid={Boolean(error)}
            required
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="rounded-lg p-2 text-faint hover:text-ink"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm text-muted select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 rounded accent-orange-500" />
          Keep me signed in on this device
        </label>

        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!isConfigured}>
          {loading ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>

      <p className="mt-8 text-center text-xs text-faint">This is a private vault. Access is limited to the account owner.</p>
    </AuthLayout>
  );
}
