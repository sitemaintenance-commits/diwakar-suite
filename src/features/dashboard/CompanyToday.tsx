// Today in the company: one card per section, in the suite's stat-card
// style -- the section's figure, a progress bar where it is "x of y", a
// status badge (good / OK / needs attention) and two or three plain facts.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, BadgeCheck, ClipboardList, FolderKanban, Gavel, Sun, Users, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
interface CompanyTodayData {
  judged_on: string;
  judged_label: 'today' | 'yesterday';
  sections: Section[];
}

export const STATUS: Record<Light, { label: string; badge: 'success' | 'warning' | 'destructive'; tile: string; bar: string; dot: string }> = {
  good: { label: 'Good', badge: 'success', tile: 'bg-green-50 text-green-600', bar: 'bg-green-500', dot: 'bg-green-500' },
  ok: { label: 'OK', badge: 'warning', tile: 'bg-amber-50 text-amber-600', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  bad: { label: 'Needs attention', badge: 'destructive', tile: 'bg-red-50 text-red-600', bar: 'bg-red-500', dot: 'bg-red-500' },
};
const CHIP_DOT: Record<Light | 'none', string> = { good: 'bg-green-500', ok: 'bg-amber-400', bad: 'bg-red-500', none: 'bg-slate-300' };
const ORDER: Record<Light, number> = { bad: 0, ok: 1, good: 2 };
const ICONS: Record<string, LucideIcon> = {
  om: Sun, projects: FolderKanban, tenders: Gavel, departments: ClipboardList, hr: Users, approvals: BadgeCheck,
};

/** "12 of 13 plants filed readings yesterday" -> 12 / 13 + the rest; "1 tender(s) due ..." -> 1 + the rest. */
function figure(headline: string): { value: string; of: number | null; done: number | null; label: string } {
  const ofMatch = /^(\d+) of (\d+) (.*)$/.exec(headline);
  if (ofMatch) return { value: `${ofMatch[1]}/${ofMatch[2]}`, done: Number(ofMatch[1]), of: Number(ofMatch[2]), label: ofMatch[3] };
  const numMatch = /^(\d+) (.*)$/.exec(headline);
  if (numMatch) return { value: numMatch[1], done: null, of: null, label: numMatch[2] };
  // "Nothing waiting for a decision", "No sites under construction"
  if (/^(nothing|no) /i.test(headline)) return { value: '0', done: null, of: null, label: headline.replace(/^(nothing|no) /i, '').replace(/^./, (c) => c.toLowerCase()) };
  return { value: '—', done: null, of: null, label: headline };
}

export function CompanyToday({ fallback }: { fallback?: ReactNode }) {
  const q = useQuery({
    queryKey: ['company-today'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_company_today');
      if (error) throw error;
      return data as CompanyTodayData;
    },
    refetchInterval: 5 * 60_000,
  });

  if (q.isLoading) {
    return <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>;
  }
  const sections = q.data?.sections ?? [];
  if (!sections.length) return <>{fallback ?? null}</>;
  const counts = { good: 0, ok: 0, bad: 0 };
  sections.forEach((x) => { counts[x.status] += 1; });

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Today in the company</h2>
          <p className="text-xs text-muted-foreground">
            Daily filings judged on {q.data?.judged_label === 'today' ? 'today' : `yesterday (${fmtDate(q.data?.judged_on)}) until 6 pm`}.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['bad', 'ok', 'good'] as Light[]).filter((l) => counts[l] > 0).map((l) => (
            <Badge key={l} variant={STATUS[l].badge}>{counts[l]} {STATUS[l].label}</Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...sections].sort((a, b) => ORDER[a.status] - ORDER[b.status]).map((x) => {
          const Icon = ICONS[x.key] ?? ClipboardList;
          const f = figure(x.headline);
          const pct = f.of ? Math.round((100 * (f.done ?? 0)) / f.of) : null;
          return (
            <Link key={x.key} to={x.route} className="group">
              <Card className="flex h-full flex-col p-5 transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                      {x.title}
                      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </p>
                    <p className="tabular mt-1 text-2xl font-bold tracking-tight text-foreground">{f.value}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{f.label}</p>
                  </div>
                  <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', STATUS[x.status].tile)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>

                {pct !== null && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={cn('h-full rounded-full', STATUS[x.status].bar)} style={{ width: `${pct}%` }} />
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Badge variant={STATUS[x.status].badge}>{STATUS[x.status].label}</Badge>
                </div>

                <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                  {x.facts.map((fact) => <li key={fact}>{fact}</li>)}
                </ul>

                {x.chips && x.chips.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {x.chips.map((c) => (
                      <span key={c.label} title={`${c.label}: ${c.note}`}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                        <span className={cn('h-1.5 w-1.5 rounded-full', CHIP_DOT[c.status])} />
                        {c.label}
                        <span className="text-slate-400">{c.note}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
