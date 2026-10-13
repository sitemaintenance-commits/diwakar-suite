// Today in the company, laid out like an executive report: a slim status
// header (how many sections are on track, a segmented bar), the sections as
// one aligned list (figure, bar, status, one line of detail), and the
// departments beside it -- each with its Department Review status and its
// Daily Work filing.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck, Building2, ChevronRight, ClipboardList, FolderKanban, Gavel, Sun, Users, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';

type Light = 'good' | 'ok' | 'bad';
interface Chip { label: string; status: Light | 'none'; note: string }
interface Section {
  key: string;
  title: string;
  route: string;
  status: Light;
  headline: string;
  facts: string[];
  chips?: Chip[];
}
interface CompanyTodayData {
  judged_on: string;
  judged_label: 'today' | 'yesterday';
  sections: Section[];
}

const TONE: Record<Light | 'none', { dot: string; bar: string; text: string; label: string }> = {
  good: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', text: 'text-emerald-700', label: 'On track' },
  ok: { dot: 'bg-amber-400', bar: 'bg-amber-400', text: 'text-amber-700', label: 'Watch' },
  bad: { dot: 'bg-rose-500', bar: 'bg-rose-500', text: 'text-rose-700', label: 'Needs attention' },
  none: { dot: 'bg-slate-300', bar: 'bg-slate-300', text: 'text-slate-500', label: 'Not filed' },
};
const ORDER: Record<Light, number> = { bad: 0, ok: 1, good: 2 };
const ICONS: Record<string, LucideIcon> = {
  om: Sun, projects: FolderKanban, tenders: Gavel, departments: ClipboardList, hr: Users, approvals: BadgeCheck,
};

/** "12 of 13 plants filed readings yesterday" -> 12 / 13 + the rest; "1 tender(s) due ..." -> 1 + the rest. */
function figure(headline: string): { value: string; done: number | null; of: number | null; label: string } {
  const ofMatch = /^(\d+) of (\d+) (.*)$/.exec(headline);
  if (ofMatch) return { value: `${ofMatch[1]}/${ofMatch[2]}`, done: Number(ofMatch[1]), of: Number(ofMatch[2]), label: ofMatch[3] };
  const numMatch = /^(\d+) (.*)$/.exec(headline);
  if (numMatch) return { value: numMatch[1], done: null, of: null, label: numMatch[2] };
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

  if (q.isLoading) return <Skeleton className="mb-8 h-80 rounded-2xl" />;
  const sections = [...(q.data?.sections ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  if (!sections.length) return <>{fallback ?? null}</>;

  const onTrack = sections.filter((x) => x.status === 'good').length;
  const deptReview = sections.find((x) => x.key === 'departments')?.chips ?? [];
  const deptSheets = sections.find((x) => x.key === 'hr')?.chips ?? [];
  const deptNames = [...new Set([...deptReview.map((c) => c.label), ...deptSheets.map((c) => c.label)])];
  const departments = deptNames.map((name) => ({
    name,
    review: deptReview.find((c) => c.label === name) ?? null,
    sheets: deptSheets.find((c) => c.label === name) ?? null,
  }));

  return (
    <section className="mb-8 space-y-4">
      {/* ---------------------------------------------------- status header */}
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Today in the company</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {onTrack} <span className="font-normal text-muted-foreground">of {sections.length} sections on track</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Daily filings judged on {q.data?.judged_label === 'today' ? 'today' : `yesterday, ${fmtDate(q.data?.judged_on)} — until 6 pm`}
          </p>
        </div>
        <div className="w-full sm:w-80">
          <div className="flex h-2 gap-1">
            {sections.map((x) => <span key={x.key} title={`${x.title}: ${TONE[x.status].label}`} className={cn('flex-1 rounded-full', TONE[x.status].bar)} />)}
          </div>
          <div className="mt-2 flex justify-end gap-4 text-xs text-muted-foreground">
            {(['bad', 'ok', 'good'] as Light[]).map((l) => {
              const n = sections.filter((x) => x.status === l).length;
              return n ? (
                <span key={l} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', TONE[l].dot)} /> {n} {TONE[l].label}
                </span>
              ) : null;
            })}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ------------------------------------------------------- sections */}
        <Card className="overflow-hidden xl:col-span-2">
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-semibold">Sections</h2>
          </div>
          <ul className="divide-y">
            {sections.map((x) => {
              const Icon = ICONS[x.key] ?? ClipboardList;
              const f = figure(x.headline);
              const pct = f.of ? Math.round((100 * (f.done ?? 0)) / f.of) : null;
              return (
                <li key={x.key}>
                  <Link to={x.route} className="group grid grid-cols-[2.25rem_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50/80 sm:grid-cols-[2.25rem_10rem_1fr_auto]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border bg-white text-slate-600 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{x.title}</p>
                      <p className={cn('mt-0.5 inline-flex items-center gap-1.5 text-xs', TONE[x.status].text)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', TONE[x.status].dot)} /> {TONE[x.status].label}
                      </p>
                    </div>
                    <div className="col-span-3 min-w-0 sm:col-span-1">
                      <div className="flex items-baseline gap-2">
                        <span className="tabular text-lg font-semibold tracking-tight">{f.value}</span>
                        <span className="truncate text-xs text-muted-foreground">{f.label}</span>
                      </div>
                      {pct !== null && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', TONE[x.status].bar)} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {x.facts[0] && <p className="mt-1 truncate text-xs text-muted-foreground">{x.facts.join(' · ')}</p>}
                    </div>
                    <ChevronRight className="row-start-1 col-start-3 h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500 sm:col-start-4" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* ---------------------------------------------------- departments */}
        {departments.length > 0 && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-slate-500" /> Departments</h2>
              <span className="text-[11px] text-muted-foreground">Review · Daily sheets</span>
            </div>
            <ul className="divide-y">
              {departments.map((d) => {
                const [done, of] = (d.sheets?.note ?? '').split('/').map(Number);
                const pct = of ? Math.round((100 * (done || 0)) / of) : null;
                return (
                  <li key={d.name} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm">{d.name}</span>
                      {d.review && (
                        <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-[11px]', TONE[d.review.status].text)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', TONE[d.review.status].dot)} />
                          {d.review.status === 'none' ? 'Not filed' : d.review.note.replace(/^./, (c) => c.toUpperCase())}
                        </span>
                      )}
                    </div>
                    {d.sheets && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', TONE[d.sheets.status].bar)} style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        <span className="tabular w-10 text-right text-[11px] text-muted-foreground">{d.sheets.note}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </section>
  );
}
