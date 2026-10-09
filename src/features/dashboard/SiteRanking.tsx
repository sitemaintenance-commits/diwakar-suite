// O&M site ranking: which plants are doing best, which are fine and which
// need attention over the last 7 days, by CUF against the fleet and PR.
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtNumber } from '@/lib/format';
import { Card } from '@/components/ui/card';

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

const LOOK: Record<Status, { dot: string; label: string; text: string }> = {
  best: { dot: 'bg-green-500', label: 'Best', text: 'text-green-700' },
  good: { dot: 'bg-amber-400', label: 'Good', text: 'text-amber-700' },
  attention: { dot: 'bg-red-500', label: 'Needs attention', text: 'text-red-700' },
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

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">O&M site ranking</h2>
          <p className="text-xs text-muted-foreground">
            Last {r.days} days ({fmtDate(r.from)} – {fmtDate(r.to)}) · CUF against the fleet{r.median_cuf != null ? ` (middle ${fmtNumber(r.median_cuf, 1)}%)` : ''} and PR where insolation is recorded.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          {(['best', 'good', 'attention'] as Status[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${LOOK[s].dot}`} /> {count(s)} {LOOK[s].label}
            </span>
          ))}
        </div>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-right">CUF</th>
                <th className="px-3 py-2 text-right">PR</th>
                <th className="px-3 py-2 text-right">vs forecast</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.sites.map((x) => (
                <tr key={x.site_id} className="hover:bg-muted/40">
                  <td className="px-3 py-2 tabular text-muted-foreground">{x.rank}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link to="/operations/monitor" className="hover:underline">{x.name}</Link>
                    {x.days < r.days && <span className="ml-1 text-xs font-normal text-muted-foreground">({x.days}/{r.days} days)</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{x.cuf != null ? `${fmtNumber(x.cuf, 1)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular">{x.pr != null ? `${fmtNumber(x.pr, 1)}%` : '—'}</td>
                  <td className={`px-3 py-2 text-right tabular ${x.forecast_pct == null ? '' : x.forecast_pct >= 100 ? 'text-green-700' : x.forecast_pct >= 90 ? 'text-amber-700' : 'text-red-700'}`}>
                    {x.forecast_pct != null ? `${fmtNumber(x.forecast_pct, 0)}%` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${LOOK[x.status].text}`}>
                      <span className={`h-2 w-2 rounded-full ${LOOK[x.status].dot}`} /> {LOOK[x.status].label}
                    </span>
                    <span className="block text-xs text-muted-foreground">{x.reason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
