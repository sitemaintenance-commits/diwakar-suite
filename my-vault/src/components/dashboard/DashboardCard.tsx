import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/utils/cn';

export function DashboardCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  to,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone: string;
  to?: string;
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <div className={cn('flex size-11 items-center justify-center rounded-xl', tone)}>
          <Icon className="size-5" strokeWidth={1.9} />
        </div>
        {to && <ArrowUpRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <p className="mt-4 text-[13px] font-medium text-muted">{label}</p>
      {loading ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-1 text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</p>}
      {hint && !loading && <p className="mt-1 truncate text-xs text-faint">{hint}</p>}
    </>
  );
  const cls = 'group block rounded-2xl border border-line bg-surface p-5 shadow-card transition-all';
  return to ? (
    <Link to={to} className={cn(cls, 'hover:border-line-strong hover:shadow-pop focus-visible:outline-2 focus-visible:outline-brand')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
