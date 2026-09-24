import type { ReactNode } from 'react';
import { BarChart3, ClipboardList, Handshake, ShieldCheck, Sun, Users } from 'lucide-react';
import { BrandLockup } from '@/components/common/Brand';

const MODULES = [
  { icon: Handshake, label: 'CRM' },
  { icon: Sun, label: 'Projects & O&M' },
  { icon: Users, label: 'HR & Performance' },
  { icon: ClipboardList, label: 'Daily Review' },
  { icon: BarChart3, label: 'Reports' },
  { icon: ShieldCheck, label: 'Role-based access' },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#E8740C] via-[#dd6a08] to-[#b8540a] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <div className="rounded-2xl bg-white/15 p-1.5">
            <svg viewBox="0 0 64 64" className="h-9 w-9" aria-hidden="true">
              <circle cx="32" cy="32" r="10" fill="#fff" />
              <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
                <path d="M32 10v6M32 48v6M10 32h6M48 32h6M16.4 16.4l4.3 4.3M43.3 43.3l4.3 4.3M16.4 47.6l4.3-4.3M43.3 20.7l4.3-4.3" />
              </g>
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-lg font-bold">Diwakar Solar</div>
            <div className="text-sm text-white/80">Management Suite</div>
          </div>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl font-bold leading-tight">One platform for every team.</h2>
          <p className="mt-3 text-white/85">
            Sales, projects, plant operations, people and daily reviews — with one login and access tailored to your role and
            sites.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {MODULES.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
                <Icon className="h-4 w-4" /> {label}
              </div>
            ))}
          </div>
        </div>
        <p className="relative mt-10 text-xs text-white/70">Diwakar Renewable &amp; Infra Pvt. Ltd.</p>
      </div>

      <div className="flex items-center justify-center bg-background px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandLockup />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
