import { Link, useLocation } from 'react-router';
import { Clock, Compass, LogOut, ShieldAlert, UserX, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BrandLockup } from '@/components/common/Brand';
import { useAuth } from '@/auth/AuthProvider';
import { useAccess } from '@/auth/AccessProvider';

function StatusCard({
  icon: Icon,
  code,
  title,
  children,
  actions,
  tone = 'orange',
}: {
  icon: typeof ShieldAlert;
  code?: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  tone?: 'orange' | 'red' | 'slate';
}) {
  const toneCls = tone === 'red' ? 'bg-red-50 text-red-600' : tone === 'slate' ? 'bg-slate-100 text-slate-600' : 'bg-primary-soft text-primary';
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <Card className="w-full max-w-md p-8 text-center">
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${toneCls}`}>
          <Icon className="h-7 w-7" />
        </div>
        {code && <p className="mt-5 text-sm font-semibold tracking-widest text-muted-foreground">{code}</p>}
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <div className="mt-2 text-sm text-muted-foreground">{children}</div>
        {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
      </Card>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <StatusCard
      icon={ShieldAlert}
      code="403"
      title="Access Denied"
      tone="red"
      actions={
        <Button asChild>
          <Link to="/">Back to Dashboard</Link>
        </Button>
      }
    >
      You do not have permission to view this page. If you need access, ask your administrator to update your role.
    </StatusCard>
  );
}

export function NotFoundPage() {
  const location = useLocation();
  return (
    <StatusCard
      icon={Compass}
      code="404"
      title="Page not found"
      tone="slate"
      actions={
        <Button asChild>
          <Link to="/">Back to Dashboard</Link>
        </Button>
      }
    >
      <code className="rounded bg-muted px-1.5 py-0.5">{location.pathname}</code> does not exist.
    </StatusCard>
  );
}

/**
 * Catch-all for app routes: a path that belongs to a catalogue module is
 * either forbidden (no permission) or not yet released (later phase);
 * anything else is a 404.
 */
export function ModuleFallbackPage() {
  const location = useLocation();
  const { access, can } = useAccess();
  const mod = access?.modules.find((m) => m.route && m.route !== '/' && location.pathname.startsWith(m.route));
  if (!mod) return <NotFoundPage />;
  if (!access?.is_super_admin && !(access?.permissions[mod.key]?.actions.includes('view') ?? false) && !can(mod.key)) {
    return <ForbiddenPage />;
  }
  return (
    <StatusCard
      icon={Wrench}
      title={`${mod.label} is on the way`}
      actions={
        <Button asChild variant="outline">
          <Link to="/">Back to Dashboard</Link>
        </Button>
      }
    >
      This module is scheduled for Phase {mod.phase} of the Management Suite and will appear in the menu automatically once
      it is released.
    </StatusCard>
  );
}

export function AccountInactivePage() {
  const { signOut, session } = useAuth();
  const { access, error } = useAccess();
  const invited = access?.profile?.status === 'invited';
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8">
        <BrandLockup />
      </div>
      <StatusCard
        icon={error ? Clock : UserX}
        title={error ? 'Could not load your account' : invited ? 'Account not yet active' : 'Account deactivated'}
        tone="slate"
        actions={
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        }
      >
        {error
          ? `${error.message}. Please try again in a moment.`
          : `The account ${session?.user.email ?? ''} is not active. Please contact your administrator.`}
      </StatusCard>
    </div>
  );
}

export function SetupRequiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-lg p-8">
        <BrandLockup />
        <h1 className="mt-6 text-xl font-bold">Configuration required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This deployment is not connected to its Supabase project. Set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> in the Netlify environment (or a local <code>.env</code> file) and redeploy.
        </p>
      </Card>
    </div>
  );
}
