import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Search, X } from 'lucide-react';
import { findView } from '@/lib/views';
import { cn } from '@/utils/cn';

/**
 * Global search. On a library page it filters that page; elsewhere it
 * searches All Files. The query lives in the URL (?q=).
 */
export function SearchBar({ className, autoFocus, onDone }: { className?: string; autoFocus?: boolean; onDone?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [value, setValue] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const onLibraryPage = Boolean(findView(location.pathname));

  // Keep the input in sync when the URL changes (navigation, clear filters).
  useEffect(() => setValue(urlQuery), [urlQuery]);

  // Debounced live search on library pages.
  useEffect(() => {
    if (!onLibraryPage || value === urlQuery) return;
    const t = setTimeout(() => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value.trim()) next.set('q', value.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [value, onLibraryPage, urlQuery, setParams]);

  // "/" focuses search, like many dashboards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement)?.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    const q = value.trim();
    if (!onLibraryPage) navigate(q ? `/files?q=${encodeURIComponent(q)}` : '/files');
    onDone?.();
  };

  return (
    <form
      role="search"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setValue(''), inputRef.current?.blur())}
        placeholder="Search files, tags, descriptions…"
        aria-label="Search files"
        className="h-10 w-full rounded-xl border border-line bg-subtle/70 pr-9 pl-9 text-sm text-ink placeholder:text-faint focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand/15 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" onClick={() => setValue('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-faint hover:text-ink" aria-label="Clear search">
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-faint md:block">/</kbd>
      )}
    </form>
  );
}
