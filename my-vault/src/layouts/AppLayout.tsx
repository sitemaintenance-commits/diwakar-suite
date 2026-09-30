import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { UploadModal } from '@/components/upload/UploadModal';
import { UploadProgress } from '@/components/upload/UploadProgress';
import { DropOverlay } from '@/components/upload/DropOverlay';
import { FullPageLoader } from '@/components/layout/FullPageLoader';
import { useAuth } from '@/context/AuthContext';
import { UploadProvider } from '@/context/UploadContext';
import { FileActionsProvider } from '@/context/FileActionsContext';
import { usePreferences, useThemeSync } from '@/hooks/useProfile';
import { findView } from '@/lib/views';

const COLLAPSE_KEY = 'vault.sidebar-collapsed';

function Shell() {
  const location = useLocation();
  const { prefs } = usePreferences();
  useThemeSync(prefs.theme);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const view = findView(location.pathname);

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-5 pb-28 sm:px-6 sm:py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <UploadModal />
      <UploadProgress />
      <DropOverlay category={view?.uploadCategory ?? 'auto'} />
    </div>
  );
}

/** Protected area: redirects to /login without a verified session. */
export function AppLayout() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <UploadProvider>
      <FileActionsProvider>
        <Shell />
      </FileActionsProvider>
    </UploadProvider>
  );
}
