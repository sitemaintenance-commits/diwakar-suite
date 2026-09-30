import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/context/AuthContext';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { AppLayout } from '@/layouts/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/PasswordPages';
import { DashboardPage } from '@/pages/DashboardPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { StoragePage } from '@/pages/StoragePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { LIBRARY_VIEWS } from '@/lib/views';

/** Toasts follow the app's own light/dark class, not just the OS setting. */
function ThemedToaster() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setDark(el.classList.contains('dark')));
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return <Toaster position="top-right" richColors closeButton theme={dark ? 'dark' : 'light'} toastOptions={{ className: 'font-sans' }} />;
}

export default function App() {
  const location = useLocation();
  return (
    <AuthProvider>
      <ConfirmProvider>
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              {LIBRARY_VIEWS.map((v) => (
                <Route key={v.key} path={v.path} element={<LibraryPage key={v.key} view={v} />} />
              ))}
              <Route path="/storage" element={<StoragePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ErrorBoundary>
        <ThemedToaster />
      </ConfirmProvider>
    </AuthProvider>
  );
}
