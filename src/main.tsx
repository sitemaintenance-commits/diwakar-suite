import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@/styles/globals.css';
import { supabaseConfigured } from '@/lib/supabase';
import { AuthProvider } from '@/auth/AuthProvider';
import { AccessProvider } from '@/auth/AccessProvider';
import { SetupRequiredPage } from '@/pages/StatusPages';
import { router } from '@/app/router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => {
        const code = (err as { code?: string })?.code;
        // Never retry permission errors — they will not change on retry.
        if (code === '42501' || code === 'PGRST301') return false;
        return count < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigured ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccessProvider>
            <RouterProvider router={router} />
          </AccessProvider>
        </AuthProvider>
      </QueryClientProvider>
    ) : (
      <SetupRequiredPage />
    )}
    <Toaster position="top-right" richColors closeButton />
  </StrictMode>,
);
