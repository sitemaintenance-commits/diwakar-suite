// Shared page-building blocks used by every module.
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from '@/components/ui/misc';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fmtNumber, initials } from '@/lib/format';
import { signedUrl } from '@/lib/supabase';
import type { UserStatus } from '@/lib/types';

// ---------------------------------------------------------------- PageHeader
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary sm:flex">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- StatCard
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'orange',
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'orange' | 'blue' | 'green' | 'violet' | 'slate' | 'amber' | 'red';
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    orange: 'bg-orange-50 text-orange-600',
    blue: 'bg-sky-50 text-sky-600',
    green: 'bg-green-50 text-green-600',
    violet: 'bg-violet-50 text-violet-600',
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-20" />
          ) : (
            <p className="tabular mt-1 text-xl font-bold tracking-tight text-foreground [overflow-wrap:normal] sm:text-2xl">
              {typeof value === 'number' ? fmtNumber(value) : value}
            </p>
          )}
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- EmptyState
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <p className="font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- SearchInput
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

// ---------------------------------------------------------------- Pagination
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular">
        {fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(total)}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular px-2">
          {page + 1} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Field
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- CheckList (multi-select)
export function CheckList<T extends { id: string }>({
  items,
  selected,
  onChange,
  render,
  disabled,
  emptyText = 'Nothing to select.',
  searchable,
}: {
  items: T[];
  selected: string[];
  onChange: (ids: string[]) => void;
  render: (item: T) => ReactNode;
  disabled?: (item: T) => boolean;
  emptyText?: string;
  searchable?: (item: T) => string;
}) {
  const [q, setQ] = useState('');
  const visible = searchable && q ? items.filter((i) => searchable(i).toLowerCase().includes(q.toLowerCase())) : items;
  const toggle = (id: string, on: boolean) => onChange(on ? [...new Set([...selected, id])] : selected.filter((s) => s !== id));
  if (items.length === 0) return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="rounded-lg border">
      {searchable && (
        <div className="border-b p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-8" />
        </div>
      )}
      <div className="max-h-56 divide-y overflow-y-auto">
        {visible.map((item) => {
          const isDisabled = disabled?.(item) ?? false;
          return (
            <label
              key={item.id}
              className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60', isDisabled && 'cursor-not-allowed opacity-50')}
            >
              <Checkbox
                checked={selected.includes(item.id)}
                disabled={isDisabled}
                onCheckedChange={(v) => toggle(item.id, v === true)}
              />
              <div className="min-w-0 flex-1">{render(item)}</div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- UserAvatar
export function UserAvatar({ name, path, className }: { name: string | null | undefined; path?: string | null; className?: string }) {
  const { data: url } = useQuery({
    queryKey: ['avatar-url', path],
    enabled: Boolean(path),
    queryFn: () => signedUrl('avatars', path),
    staleTime: 50 * 60_000,
  });
  return (
    <Avatar className={className}>
      {url && <AvatarImage src={url} alt={name ?? ''} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

// ---------------------------------------------------------------- Status badges
export function UserStatusBadge({ status }: { status: UserStatus }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'invited') return <Badge variant="info">Invited</Badge>;
  return <Badge variant="secondary">Inactive</Badge>;
}

export function RecordStatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return status === 'active' ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>;
}

// ---------------------------------------------------------------- ConfirmDialog
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction destructive={destructive} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------- TableSkeleton
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- ErrorState
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p className="font-medium">Could not load data</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
