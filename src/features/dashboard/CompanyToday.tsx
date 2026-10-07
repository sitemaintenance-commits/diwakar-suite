// Today in the company: one card per section with a traffic light and two
// or three plain facts, so a Super Admin sees at a glance which sections
// are doing well, which are fine and which need attention.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';

type Light = 'good' | 'ok' | 'bad';
interface Section {
  key: string;
  title: string;
  route: string;
  status: Light;
  headline: string;
  facts: string[];
  chips?: { label: string; status: Light | 'none'; note: string }[];
}
interface CompanyToday {
  judged_on: string;
  judged_label: 'today' | 'yesterday';
  sections: Section[];
}

const LIGHT: Record<Light | 'none', { dot: string; ring: string; label: string }> = {
  good: { dot: 'bg-green-500', ring: 'border-l-green-500', label: 'Good' },
  ok: { dot: 'bg-amber-400', ring: 'border-l-amber-400', label: 'OK' },
  bad: { dot: 'bg-red-500', ring: 'border-l-red-500', label: 'Needs attention' },
  none: { dot: 'bg-slate-300', ring: 'border-l-slate-300', label: 'Not filed' },
};
const ORDER: Record<Light, number> = { bad: 0, ok: 1, good: 2 };

export function CompanyToday({ fallback }: { fallback?: ReactNode }) {
  const q = useQuery({
    queryKey: ['company-today'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_company_today');
      if (error) throw error;
      return data as CompanyToday;
    },
    refetchInterval: 5 * 60_000,
  });

  if (q.isLoading) {
    return <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>;
  }
  const sections = q.data?.sections ?? [];
  if (!sections.length) return <>{fallback ?? null}</>;
  const counts = { good: 0, ok: 0, bad: 0 };
  sections.forEach((x) => { counts[x.status] += 1; });

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Today in the company</h2>
          <p className="text-xs text-muted-foreground">
            Daily filings judged on {q.data?.judged_label === 'today' ? 'today' : `yesterday (${fmtDate(q.data?.judged_on)}) until 6 pm`}.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          {(['good', 'ok', 'bad'] as Light[]).map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${LIGHT[l].dot}`} />
              {counts[l]} {LIGHT[l].label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...sections].sort((a, b) => ORDER[a.status] - ORDER[b.status]).map((x) => (
          <Link key={x.key} to={x.route} className="group">
            <Card className={`h-full border-l-4 p-4 transition-colors group-hover:bg-muted/40 ${LIGHT[x.status].ring}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-semibold">
                  <span className={`h-2.5 w-2.5 rounded-full ${LIGHT[x.status].dot}`} />
                  {x.title}
                </span>
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  {LIGHT[x.status].label}
                  <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </div>
              <p className="text-sm font-medium">{x.headline}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {x.facts.map((f) => <li key={f}>• {f}</li>)}
              </ul>
              {x.chips && x.chips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {x.chips.map((c) => (
                    <span key={c.label} title={c.note} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${LIGHT[c.status].dot}`} />
                      {c.label} <span className="text-muted-foreground">{c.note}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
