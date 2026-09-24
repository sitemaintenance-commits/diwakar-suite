import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9 shrink-0', className)} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#E8740C" />
      <circle cx="32" cy="32" r="10" fill="#fff" />
      <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
        <path d="M32 10v6M32 48v6M10 32h6M48 32h6M16.4 16.4l4.3 4.3M43.3 43.3l4.3 4.3M16.4 47.6l4.3-4.3M43.3 20.7l4.3-4.3" />
      </g>
    </svg>
  );
}

export function BrandLockup({ brand = 'Diwakar Solar', suite = 'Management Suite' }: { brand?: string; suite?: string }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight text-foreground">{brand}</div>
        <div className="text-xs font-medium text-muted-foreground">{suite}</div>
      </div>
    </div>
  );
}
