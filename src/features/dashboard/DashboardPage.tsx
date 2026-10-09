// The dashboard: what is happening in the company today, section by
// section (see CompanyToday). Someone who sees no whole section -- an
// employee, a technician -- gets their own modules as quick links instead.
import { Link } from 'react-router';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useAccess } from '@/auth/AccessProvider';
import { BUILT_MODULES, iconFor } from '@/app/registry';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CompanyToday } from '@/features/dashboard/CompanyToday';
import { SiteRanking } from '@/features/dashboard/SiteRanking';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { access } = useAccess();
  const firstName = access?.profile?.full_name?.split(' ')[0] || 'there';

  return (
    <>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here is what is happening across {access?.settings?.brand_name ? String(access.settings.brand_name) : 'Diwakar Solar'} today.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {access?.roles.map((r) => (
            <Badge key={r.id} variant="secondary">
              <ShieldCheck className="h-3 w-3" /> {r.name}
            </Badge>
          ))}
        </div>
      </div>

      <CompanyToday fallback={<YourWorkspace />} />
      <SiteRanking />
    </>
  );
}

/** The modules this person can open, as quick links. */
function YourWorkspace() {
  const { access, can } = useAccess();
  const mods = (access?.modules ?? []).filter((m) => m.show_in_nav && m.route && m.key !== 'dashboard' && BUILT_MODULES.has(m.key) && can(m.key));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your workspace</CardTitle>
        <CardDescription>What you can open</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {mods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is assigned to your role yet. Ask your administrator.</p>
        ) : (
          mods.map((m) => {
            const Icon = iconFor(m.icon);
            return (
              <Link key={m.key} to={m.route!} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-muted">
                <Icon className="h-4 w-4 text-primary" />
                <span className="flex-1">{m.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
