// Today in the company: a slim status header (how many sections are on
// track, one segment per section), then one card per section with every
// detail the database sends -- the key figure with a progress ring, the
// facts, and the per-department list. Cards rise in on load and lift with a
// brand-coloured accent on hover; the whole card opens the section.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, BadgeCheck, ShieldCheck, ShoppingCart, ClipboardList, FolderKanban, Gavel, Sun, Users, type LucideIcon,
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

const TONE: Record<Light | 'none', { dot: string; bar: string; stroke: string; pill: string; label: string }> = {
  good: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', stroke: 'stroke-emerald-500', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', label: 'On track' },
  ok: { dot: 'bg-amber-400', bar: 'bg-amber-400', stroke: 'stroke-amber-400', pill: 'bg-amber-50 text-amber-700 ring-amber-600/20', label: 'Watch' },
  bad: { dot: 'bg-rose-500', bar: 'bg-rose-500', stroke: 'stroke-rose-500', pill: 'bg-rose-50 text-rose-700 ring-rose-600/15', label: 'Needs attention' },
  none: { dot: 'bg-slate-300', bar: 'bg-slate-300', stroke: 'stroke-slate-300', pill: 'bg-slate-50 text-slate-600 ring-slate-500/15', label: 'Not filed' },
};
const ORDER: Record<Light, number> = { bad: 0, ok: 1, good: 2 };
const ICONS: Record<string, LucideIcon> = {
  om: Sun, projects: FolderKanban, tenders: Gavel, departments: ClipboardList, hr: Users, approvals: BadgeCheck, insurance: ShieldCheck, procurement: ShoppingCart,
};

/** "12 of 13 plants filed readings yesterday" -> 12 / 13 + the rest; "1 tender(s) due ..." -> 1 + the rest. */
function figure(headline: string): { value: string; done: number | null; of: number | null; label: string } {
  const ofMatch = /^(\d+) of (\d+) (.*)$/.exec(headline);
  if (ofMatch) return { value: ofMatch[1], done: Number(ofMatch[1]), of: Number(ofMatch[2]), label: ofMatch[3] };
  const numMatch = /^(\d+) (.*)$/.exec(headline);
  if (numMatch) return { value: numMatch[1], done: null, of: null, label: numMatch[2] };
  if (/^(nothing|no) /i.test(headline)) return { value: '0', done: null, of: null, label: headline.replace(/^(nothing|no) /i, '').replace(/^./, (c) => c.toLowerCase()) };
  return { value: '—', done: null, of: null, label: headline };
}

/** A small progress ring with the percentage in the middle. */
function Ring({ pct, status }: { pct: number; status: Light }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-11 w-11 shrink-0">
      <svg viewBox="0 0 56 56" className="h-11 w-11 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className="stroke-slate-100" />
        <circle
          cx="28" cy="28" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
          className={cn('transition-[stroke-dashoffset] duration-700 ease-out', TONE[status].stroke)}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-[9px] font-semibold tracking-tight text-slate-700">{pct}%</span>
    </div>
  );
}

function SectionCard({ s, index }: { s: Section; index: number }) {
  const Icon = ICONS[s.key] ?? ClipboardList;
  const f = figure(s.headline);
  const pct = f.of ? Math.round((100 * (f.done ?? 0)) / f.of) : null;
  const chips = s.chips ?? [];
  return (
    <Link
      to={s.route}
      style={{ animationDelay: `${index * 60}ms` }}
      className={cn(
        'card-rise group relative flex flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-card',
        'transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/40',
        'hover:shadow-[0_14px_32px_-14px_rgb(232_116_12/0.35)]',
      )}
    >
      {/* brand accent that sweeps in across the top, and a soft glow in the corner */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-primary via-orange-400 to-amber-300 transition-transform duration-500 ease-out group-hover:scale-x-100" />
      <span className="pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />

      {/* header */}
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary transition-all duration-300 group-hover:-rotate-6 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-md group-hover:shadow-primary/30">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="truncate text-sm font-semibold tracking-tight">{s.title}</h3>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-primary opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', TONE[s.status].pill)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', TONE[s.status].dot, s.status === 'bad' && 'animate-pulse')} />
          {TONE[s.status].label}
        </span>
      </div>

      {/* key figure */}
      <div className="relative mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-2xl font-semibold leading-none tracking-tight text-slate-900">
            {f.value}
            {f.of !== null && <span className="text-sm font-medium text-slate-400"> / {f.of}</span>}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={f.label}>{f.label}</p>
        </div>
        {pct !== null && <Ring pct={pct} status={s.status} />}
      </div>

      {/* facts */}
      {s.facts.length > 0 && (
        <ul className="relative mt-3 space-y-0.5 border-t border-dashed pt-2.5">
          {s.facts.map((fact) => (
            <li key={fact} className="flex items-start gap-1.5 text-xs leading-5 text-slate-600">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400 transition-colors group-hover:bg-primary" />
              {fact}
            </li>
          ))}
        </ul>
      )}

      {/* per-department detail */}
      {chips.length > 0 && (
        <div className="relative mt-2.5 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c.label} title={`${c.label}: ${c.note || 'not filed'}`} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200/70 transition-colors group-hover:bg-primary-soft/60">
              <span className={cn('h-1.5 w-1.5 rounded-full', TONE[c.status].dot)} />
              {c.label}
              <span className="tabular text-slate-400">{c.note || '—'}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
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

  return (
    <section className="mb-8 space-y-4">
      {/* status header */}
      <Card className="card-rise flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Today in the company</p>
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

      {/* one card per section */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((s, i) => <SectionCard key={s.key} s={s} index={i + 1} />)}
      </div>
    </section>
  );
}
