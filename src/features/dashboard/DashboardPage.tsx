// Central dashboard. Every section is permission-aware:
//  * KPI sections come from get_dashboard_summary(), which only returns a
//    section when the user may view that module, with counts already limited
//    to the user's sites by RLS.
//  * Lists (sites, activity) are plain RLS-filtered queries.
// Numbers pass through safeNum/fmtNumber, so nothing renders as null/NaN.
import { Link } from 'react-router';
import {
  Activity, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Circle, FileText, Gavel, IndianRupee,
  MapPin, MailPlus, ShieldCheck, Sun, Target, Ticket, Trophy, UserCheck, Users, Wallet, Wrench, Zap,
} from 'lucide-react';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { BUILT_MODULES, iconFor } from '@/app/registry';
import { fmtCapacity, fmtDateTime, fmtINR, fmtNumber, safeNum, titleCase } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, RecordStatusBadge, StatCard } from '@/components/common';
import { errorMessage } from '@/lib/errors';
import { useDashboardSummary } from '@/features/dashboard/api';
import { useAudit, useSites } from '@/features/admin/api';
import { fmtKwh } from '@/features/om/shared';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const { access } = useAccess();
  const summary = useDashboardSummary();
  const sites = useSites();
  const auditPerm = useCan('admin.audit');
  const modulesPerm = useCan('admin.modules');
  const sitesPerm = useCan('admin.sites');
  const recent = useAudit(
    { search: '', actorId: 'all', module: 'all', action: 'all', from: '', to: '', page: 0, pageSize: 8 },
    auditPerm.view,
  );
  const s = summary.data;
  const firstName = access?.profile?.full_name?.split(' ')[0] || 'there';
  const loading = summary.isLoading;

  const siteRows = (sites.data ?? []).filter((x) => x.status === 'active').slice(0, 8);

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

      {/* KPI cards — only sections the user is permitted to see */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(loading || s?.sites) && (
          <>
            <StatCard
              label={access?.is_super_admin || access?.profile?.all_sites ? 'Solar sites' : 'My sites'}
              value={safeNum(s?.sites?.active)}
              hint={`${fmtNumber(s?.sites?.total)} total incl. inactive`}
              icon={MapPin}
              loading={loading}
            />
            <StatCard label="Total solar capacity" value={fmtCapacity(s?.sites?.capacity_kwp)} hint="Active sites" icon={Zap} tone="amber" loading={loading} />
          </>
        )}
        {s?.users && (
          <>
            <StatCard label="Active users" value={safeNum(s.users.active)} hint={`${fmtNumber(s.users.total)} accounts`} icon={UserCheck} tone="green" />
            <StatCard label="Pending invitations" value={safeNum(s.users.invited)} icon={MailPlus} tone="blue" />
          </>
        )}
        {s?.employees && !s.users && (
          <StatCard label="Employees" value={safeNum(s.employees.active)} hint={`${fmtNumber(s.employees.total)} on record`} icon={Users} tone="violet" />
        )}
        {s?.tenders && (
          <>
            <StatCard
              label="Live tenders"
              value={safeNum(s.tenders.live)}
              hint={`${fmtNumber(s.tenders.closing_7_days)} closing in 7 days`}
              icon={Gavel}
              tone="orange"
            />
            <StatCard label="Bids submitted" value={safeNum(s.tenders.submitted)} hint={`${fmtNumber(s.tenders.won)} won`} icon={Trophy} tone="violet" />
            <StatCard label="Tender pipeline" value={fmtINR(s.tenders.pipeline_value, true)} hint={`Won ${fmtINR(s.tenders.won_value, true)}`} icon={IndianRupee} tone="green" />
            <StatCard label="EMD blocked" value={fmtINR(s.tenders.emd_blocked, true)} hint={`${fmtNumber(s.tenders.emd_refund_due)} refund(s) due`} icon={Wallet} tone="amber" />
          </>
        )}
        {s?.leads && <StatCard label="Open leads" value={safeNum(s.leads.open)} hint={fmtINR(s.leads.value, true)} icon={Target} tone="blue" />}
        {s?.quotations && (
          <StatCard label="Quotations out" value={safeNum(s.quotations.sent)} hint={`${fmtINR(s.quotations.value, true)} open value`} icon={FileText} tone="slate" />
        )}
        {s?.followups && (
          <StatCard label="Follow-ups today" value={safeNum(s.followups.today)} hint={`${fmtNumber(s.followups.overdue)} overdue`} icon={CalendarClock} tone="blue" />
        )}
        {s?.generation && (
          <StatCard
            label="Generation today"
            value={fmtKwh(s.generation.today)}
            hint={s.generation.has_data ? `Month ${fmtKwh(s.generation.month)}` : 'No readings recorded yet'}
            icon={Zap}
            tone="amber"
          />
        )}
        {s?.tickets && (
          <StatCard
            label="Open O&M tickets"
            value={safeNum(s.tickets.open)}
            hint={`${fmtNumber(s.tickets.critical)} critical · ${fmtNumber(s.tickets.unassigned)} unassigned`}
            icon={Ticket}
            tone={safeNum(s.tickets.critical) > 0 ? 'red' : 'slate'}
          />
        )}
        {s?.maintenance && (
          <StatCard
            label="Maintenance due"
            value={safeNum(s.maintenance.pending)}
            hint={`${fmtNumber(s.maintenance.overdue)} overdue`}
            icon={Wrench}
            tone="blue"
          />
        )}
        {s?.roles && <StatCard label="Roles" value={safeNum(s.roles.total)} hint={`${fmtNumber(s.roles.custom)} custom`} icon={ShieldCheck} tone="violet" />}
        {s?.audit && (
          <StatCard label="Sign-ins today" value={safeNum(s.audit.logins_today)} hint={`${fmtNumber(s.audit.today)} audit events today`} icon={Activity} tone="slate" />
        )}
      </div>

      {(safeNum(s?.tenders?.overdue) > 0 || safeNum(s?.followups?.overdue) > 0) && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {safeNum(s?.tenders?.overdue) > 0 && `${fmtNumber(s?.tenders?.overdue)} tender deadline(s) passed without submission. `}
            {safeNum(s?.followups?.overdue) > 0 && `${fmtNumber(s?.followups?.overdue)} follow-up(s) overdue.`}
          </span>
          <span className="ml-auto flex gap-3">
            {safeNum(s?.tenders?.overdue) > 0 && (
              <Link to="/crm/tenders" className="font-medium underline">
                Tenders
              </Link>
            )}
            {safeNum(s?.followups?.overdue) > 0 && (
              <Link to="/crm/follow-ups" className="font-medium underline">
                Follow-ups
              </Link>
            )}
          </span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Sites */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Sites</CardTitle>
              <CardDescription>Active sites you have access to</CardDescription>
            </div>
            {sitesPerm.view && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/sites">
                  Manage <ArrowRight />
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {sites.isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : sites.error ? (
              <ErrorState message={errorMessage(sites.error)} onRetry={() => sites.refetch()} />
            ) : siteRows.length === 0 ? (
              <EmptyState icon={Sun} title="No sites assigned" description="Ask your administrator to assign sites to your account." />
            ) : (
              <ul className="divide-y border-t">
                {siteRows.map((site) => (
                  <li key={site.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <Sun className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{site.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[site.location, site.district].filter(Boolean).join(', ') || 'Location not set'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular text-sm font-medium">{safeNum(site.capacity_kwp) ? fmtCapacity(site.capacity_kwp) : '—'}</span>
                      <RecordStatusBadge status={site.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              Live generation, CUF, PR and availability appear here once the O&amp;M module and data sources are connected.
            </p>
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="grid content-start gap-6">
          <YourAccessCard />
          {modulesPerm.view && <RolloutCard />}
        </div>

        {auditPerm.view && (
          <Card className="lg:col-span-3">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>Latest entries from the audit log</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/audit-log">
                  View all <ArrowRight />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {recent.isLoading ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : !recent.data?.rows.length ? (
                <EmptyState icon={Activity} title="No activity yet" />
              ) : (
                <ul className="divide-y border-t">
                  {recent.data.rows.map((a) => (
                    <li key={a.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.summary ?? titleCase(a.action)}</p>
                        <p className="text-xs text-muted-foreground">{a.actor_name ?? 'System'}</p>
                      </div>
                      <span className="tabular shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function YourAccessCard() {
  const { access, can } = useAccess();
  const mods = (access?.modules ?? []).filter((m) => m.show_in_nav && m.route && m.key !== 'dashboard' && BUILT_MODULES.has(m.key) && can(m.key));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your workspace</CardTitle>
        <CardDescription>Modules available to you</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1.5">
        {mods.length === 0 ? (
          <p className="text-sm text-muted-foreground">More modules will appear here as they are released and assigned to your role.</p>
        ) : (
          mods.map((m) => {
            const Icon = iconFor(m.icon);
            return (
              <Link key={m.key} to={m.route!} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium hover:bg-muted">
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

function RolloutCard() {
  const { access } = useAccess();
  const phases = [
    { phase: 1, label: 'Foundation & administration' },
    { phase: 2, label: 'CRM' },
    { phase: 3, label: 'Projects & tasks' },
    { phase: 4, label: 'O&M & solar monitoring' },
    { phase: 5, label: 'HR / PMS' },
    { phase: 6, label: 'Daily Review' },
    { phase: 7, label: 'Reports & analytics' },
  ];
  const released = (p: number) => {
    const mods = (access?.modules ?? []).filter((m) => m.phase === p);
    return mods.length > 0 && mods.some((m) => BUILT_MODULES.has(m.key));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suite rollout</CardTitle>
        <CardDescription>Replacing the four legacy applications</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2">
          {phases.map((p) => {
            const done = released(p.phase);
            return (
              <li key={p.phase} className="flex items-center gap-2.5 text-sm">
                {done ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
                <span className={done ? 'font-medium' : 'text-muted-foreground'}>
                  Phase {p.phase} · {p.label}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
