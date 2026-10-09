// O&M site ranking: which plants are doing best, which are fine and which
// need attention over the last 7 days, by CUF against the fleet and PR --
// a regular suite card with a table, status badges and a CUF bar.
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Status = 'best' | 'good' | 'attention';
interface RankedSite {
  rank: number;
  site_id: string;
  name: string;
  cuf: number | null;
  pr: number | null;
  days: number;
  forecast_pct: number | null;
  status: Status;
  reason: string;
}
interface Ranking { from: string; to: string; days: number; median_cuf: number | null; sites: RankedSite[] }

const LOOK: Record<Status, { label: string; badge: 'success' | 'warning' | 'destructive'; bar: string }> = {
  best: { label: 'Best', badge: 'success', bar: 'bg-green-500' },
  good: { label: 'Good', badge: 'warning', bar: 'bg-amber-400' },
  attention: { label: 'Needs attention', badge: 'destructive', bar: 'bg-red-500' },
};

export function SiteRanking() {
  const q = useQuery({
    queryKey: ['om-site-ranking'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_om_site_ranking', { p_days: 7 });
      if (error) throw error;
      return data as Ranking | null;
    },
    refetchInterval: 15 * 60_000,
  });
  const r = q.data;
  if (!r?.sites?.length) return null;
  const count = (s: Status) => r.sites.filter((x) => x.status === s).length;
  const maxCuf = Math.max(...r.sites.map((x) => x.cuf ?? 0), 1);

  return (
    <Card className="mb-8">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>O&M site ranking</CardTitle>
            <CardDescription>
              Last {r.days} days · {fmtDate(r.from)} – {fmtDate(r.to)} · CUF against the fleet{r.median_cuf != null ? ` (middle ${fmtNumber(r.median_cuf, 1)}%)` : ''}, PR where insolation is recorded
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['best', 'good', 'attention'] as Status[]).map((s) => (
            <Badge key={s} variant={LOOK[s].badge}>{count(s)} {LOOK[s].label}</Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Site</TableHead>
                <TableHead className="w-56">CUF</TableHead>
                <TableHead className="text-right">PR</TableHead>
                <TableHead className="text-right">vs forecast</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.sites.map((x) => (
                <TableRow key={x.site_id}>
                  <TableCell className="tabular text-muted-foreground">{x.rank}</TableCell>
                  <TableCell>
                    <Link to="/operations/monitor" className="font-medium hover:text-primary">{x.name}</Link>
                    {x.days < r.days && <div className="text-xs text-muted-foreground">{x.days} of {r.days} days reported</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="tabular w-12 text-sm font-semibold">{x.cuf != null ? `${fmtNumber(x.cuf, 1)}%` : '—'}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn('h-full rounded-full', LOOK[x.status].bar)} style={{ width: `${Math.round((100 * (x.cuf ?? 0)) / maxCuf)}%` }} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right text-sm">{x.pr != null ? `${fmtNumber(x.pr, 1)}%` : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className={cn('tabular text-right text-sm',
                    x.forecast_pct == null ? 'text-muted-foreground' : x.forecast_pct >= 100 ? 'text-green-700' : x.forecast_pct >= 90 ? 'text-amber-700' : 'text-red-700')}>
                    {x.forecast_pct != null ? `${fmtNumber(x.forecast_pct, 0)}%` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={LOOK[x.status].badge}>{LOOK[x.status].label}</Badge>
                    <div className="mt-0.5 text-xs text-muted-foreground">{x.reason}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
