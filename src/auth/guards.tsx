import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { useAccess } from '@/auth/AccessProvider';
import type { PermAction } from '@/lib/types';
import { FullPageLoader } from '@/components/common/FullPageLoader';
import { AccountInactivePage, ForbiddenPage } from '@/pages/StatusPages';

/** Requires a signed-in, active account. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, passwordSetupPending } = useAuth();
  const { access, loading: accessLoading, error } = useAccess();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (passwordSetupPending) return <Navigate to="/reset-password" replace />;
  if (accessLoading || (!access && !error)) return <FullPageLoader label="Loading your workspace…" />;
  if (error || !access?.profile || access.profile.status !== 'active') return <AccountInactivePage />;
  return <>{children}</>;
}

/**
 * Route-level permission gate. Renders the 403 page in place (the URL is
 * kept) when the user lacks the permission. The database would refuse the
 * data anyway; this is for a clear user experience.
 */
export function RequirePermission({
  module,
  anyOf,
  action = 'view',
  children,
}: {
  module?: string;
  anyOf?: string[];
  action?: PermAction;
  children: ReactNode;
}) {
  const { can, canAny } = useAccess();
  const allowed = module ? can(module, action) : anyOf ? canAny(anyOf, action) : false;
  return allowed ? <>{children}</> : <ForbiddenPage />;
}
