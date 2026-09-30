import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { FileImage, FileText, FileType2, MonitorSmartphone, Search, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/ui/misc';
import { FullPageLoader } from '@/components/layout/FullPageLoader';
import { useAuth } from '@/context/AuthContext';

const FEATURES = [
  { icon: FileImage, label: 'Images' },
  { icon: MonitorSmartphone, label: 'Screenshots' },
  { icon: FileType2, label: 'PDF Library' },
  { icon: FileText, label: 'Documents' },
  { icon: ShieldCheck, label: 'Secure Storage' },
  { icon: Search, label: 'Fast Search' },
];

/** Split-screen auth layout: brand panel left, form right. */
export function AuthLayout({ children, redirectIfSignedIn = true }: { children: ReactNode; redirectIfSignedIn?: boolean }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (redirectIfSignedIn && session) {
    const from = (location.state as { from?: string } | null)?.from;
    // Only allow internal redirects.
    return <Navigate to={from && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-500 via-orange-500 to-orange-600 px-6 py-8 text-white sm:px-10 lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <Logo inverted />
          <div>
            <p className="text-lg leading-tight font-bold">My Vault</p>
            <p className="text-sm text-white/80">Private Digital Library</p>
          </div>
        </div>
        <div className="relative mt-8 hidden max-w-xl sm:block lg:mt-0">
          <h1 className="text-3xl leading-tight font-bold tracking-tight lg:text-[2.75rem]">
            Everything important.
            <br />
            One secure place.
          </h1>
          <p className="mt-4 max-w-md text-base text-white/85 lg:text-lg">
            Store your photos, screenshots, PDFs, documents and videos in a private library accessible only to you.
          </p>
          <div className="mt-8 hidden grid-cols-3 gap-3 lg:grid">
            {FEATURES.map((f) => (
              <div key={f.label} className="rounded-2xl bg-white/12 p-4 ring-1 ring-white/20 backdrop-blur-sm">
                <f.icon className="size-5" />
                <p className="mt-3 text-sm font-medium">{f.label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative mt-8 hidden text-sm text-white/70 lg:block">Private per-user storage · Signed, expiring file links</p>
      </section>
      <section className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center sm:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </div>
  );
}
