// Site Teams — the O&M contact register: who is posted at each plant, how
// to reach them, and how completely that site has been filing its daily
// register over the last month.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Phone, Users } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtNumber, safeNum } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from '@/components/common';
import { useOmTeams } from '@/features/om/opsApi';

export function SiteTeamsPage() {
  const can = useCan('om.team');
  const teams = useOmTeams();
  const [search, setSearch] = useState('');
  const t = teams.data;

  const rows = useMemo(() => {
    const flat = (t?.sites ?? []).flatMap((s) =>
      s.members.map((m) => ({ site: s.site, location: s.location, readiness: s.readiness, ...m })),
    );
    const q = search.trim().toLowerCase();
    return q ? flat.filter((r) => `${r.name} ${r.site} ${r.mobile ?? ''}`.toLowerCase().includes(q)) : flat;
  }, [t, search]);

  const covered = (t?.sites ?? []).filter((s) => s.member_count > 0).length;
  const avgTeam = t?.sites.length ? (t.member_count / t.sites.length) : 0;

  async function onExport() {
    try {
      await exportCsv('om.team', 'om-site-teams', rows, [
        { header: 'Site', value: (r) => r.site },
        { header: 'Location', value: (r) => r.location ?? '' },
        { header: 'Team member', value: (r) => r.name },
        { header: 'Role', value: (r) => r.role },
        { header: 'Mobile', value: (r) => r.mobile ?? '' },
        { header: 'Site lead', value: (r) => (r.is_lead ? 'Yes' : 'No') },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={Users}
        title="Site Teams"
        description="The O&M team posted at each plant, with the numbers to call from the field."
        actions={
          can.export ? (
            <Button variant="outline" size="sm" onClick={onExport} disabled={!rows.length}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          ) : undefined
        }
      />

      {teams.isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : teams.error ? (
        <Card>
          <ErrorState message={errorMessage(teams.error)} onRetry={() => teams.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Sites" value={fmtNumber(t?.site_count)} hint="Sites you can see" icon={Users} />
            <StatCard label="Team members" value={fmtNumber(t?.member_count)} hint="Technicians and site leads" icon={Users} tone="green" />
            <StatCard label="Average team size" value={fmtNumber(avgTeam, 1)} hint="Members per site" icon={Users} tone="violet" />
            <StatCard
              label="Sites with a team"
              value={`${fmtNumber(covered)} / ${fmtNumber(t?.site_count)}`}
              hint={covered === t?.site_count ? 'Every site covered' : 'Some sites have no contacts yet'}
              icon={Users}
              tone={covered === t?.site_count ? 'green' : 'amber'}
            />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(t?.sites ?? []).map((s) => (
              <Card key={s.site_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{s.site}</CardTitle>
                      <CardDescription>{s.location ?? 'Location not set'}</CardDescription>
                    </div>
                    <Badge variant={safeNum(s.readiness) >= 90 ? 'success' : safeNum(s.readiness) > 0 ? 'warning' : 'secondary'}>
                      {fmtNumber(s.readiness)}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {s.members.length ? (
                    s.members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.role}</p>
                        </div>
                        {m.mobile && (
                          <a href={`tel:${m.mobile}`} className="tabular flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">
                            <Phone className="h-3.5 w-3.5" />
                            {m.mobile}
                          </a>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No contacts recorded for this site yet.</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Register completeness over the last 30 days.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="mt-6">
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Contact register</CardTitle>
                <CardDescription>Every team member across your sites</CardDescription>
              </div>
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, site or number" />
            </CardHeader>
            <CardContent className="p-0">
              {!rows.length ? (
                <EmptyState icon={Users} title="No team members" description="Add the site team so the field can reach them." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Team member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead className="text-right">Register completeness</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.site}</TableCell>
                        <TableCell>
                          {r.name}
                          {r.is_lead && <Badge variant="info" className="ml-2">Site lead</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.role}</TableCell>
                        <TableCell className="tabular">{r.mobile ?? '—'}</TableCell>
                        <TableCell className="tabular text-right">{fmtNumber(r.readiness)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
