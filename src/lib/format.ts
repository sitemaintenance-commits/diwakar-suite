// Formatting helpers. Every numeric helper goes through safeNum(), so the UI
// can never render "null", "undefined" or "NaN" — missing values become 0.
import { formatDistanceToNowStrict } from 'date-fns';

export const TIMEZONE = 'Asia/Kolkata';

export function safeNum(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

const intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function fmtNumber(value: unknown, fractionDigits = 0): string {
  const n = safeNum(value);
  if (fractionDigits === 0) return intFmt.format(n);
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits }).format(n);
}

/** Capacity: kWp below 1,000, MWp above. */
export function fmtCapacity(kwp: unknown): string {
  const n = safeNum(kwp);
  if (n >= 1000) return `${fmtNumber(n / 1000, 2)} MWp`;
  return `${fmtNumber(n, 2)} kWp`;
}

/** Indian currency with lakh / crore shorthand for large values. */
export function fmtINR(value: unknown, compact = false): string {
  const n = safeNum(value);
  if (compact) {
    if (Math.abs(n) >= 1e7) return `₹${fmtNumber(n / 1e7, 2)} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${fmtNumber(n / 1e5, 2)} L`;
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TIMEZONE }).format(d);
}

export function fmtDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(d);
}

export function fmtRelative(value: string | Date | null | undefined, fallback = 'Never'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${formatDistanceToNowStrict(d)} ago`;
}

/** YYYY-MM-DD for the current day in India. */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function titleCase(value: string | null | undefined): string {
  return (value ?? '').replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
