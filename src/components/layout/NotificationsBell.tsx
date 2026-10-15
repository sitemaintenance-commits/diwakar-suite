// In-app notifications (approvals for now): a bell in the top bar with the
// unread count; opening an item marks it read and goes to its page.
//
// New notifications also stand out: a request waiting for your approval
// pops up in the middle of the screen with a short chime, other approval
// news shows as a toast, the tab title flashes while the tab is in the
// background, and -- once the user allows it -- the browser shows a desktop
// notification even when another tab or app is in front. The list is
// checked every 20 seconds, in the background too.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

const KEY = ['notifications'] as const;
/** Kinds that ask the user to act: they pop up instead of a toast. */
const NEEDS_ACTION = new Set(['approval.waiting', 'approval.unassigned']);
const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

/** A short two-note chime (no audio file needed). Silently skipped if the browser blocks sound. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [[880, 0], [1320, 0.16]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.4);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* no sound */
  }
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_notifications', { p_limit: 30 });
      if (error) throw error;
      return data as { unread: number; rows: Notification[] };
    },
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const unread = q.data?.unread ?? 0;
  const seen = useRef<Set<string> | null>(null);
  const [popup, setPopup] = useState<Notification[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(canNotify() ? Notification.permission : 'unsupported');

  async function markRead(ids: string[] | null) {
    await supabase.rpc('mark_notifications_read', { p_ids: ids });
    await qc.invalidateQueries({ queryKey: KEY });
  }

  function open(n: Notification) {
    if (!n.read_at) void markRead([n.id]);
    if (n.link) {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      navigate(n.link);
    }
  }

  async function allowDesktop() {
    if (!canNotify()) return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') {
      new Notification('Desktop alerts are on', { body: 'You will be told here when a request needs your approval.', icon: '/favicon.svg' });
    } else if (p === 'denied') {
      toast.error('Notifications are blocked for this site. Allow them from the lock icon in the address bar.');
    }
  }

  function desktop(n: Notification) {
    if (permission !== 'granted' || !canNotify()) return;
    try {
      const d = new Notification(n.title, { body: n.body ?? undefined, icon: '/favicon.svg', tag: n.id, requireInteraction: NEEDS_ACTION.has(n.kind) });
      d.onclick = () => {
        window.focus();
        open(n);
        d.close();
      };
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }

  // Spot notifications that arrived since the last check.
  useEffect(() => {
    const rows = q.data?.rows;
    if (!rows) return;
    if (!seen.current) {
      // First load: remember what is there, and point out requests still waiting.
      seen.current = new Set(rows.map((n) => n.id));
      const waiting = rows.filter((n) => !n.read_at && NEEDS_ACTION.has(n.kind));
      if (waiting.length) setPopup(waiting.slice(0, 5));
      return;
    }
    const fresh = rows.filter((n) => !seen.current!.has(n.id) && !n.read_at);
    fresh.forEach((n) => seen.current!.add(n.id));
    if (!fresh.length) return;
    const action = fresh.filter((n) => NEEDS_ACTION.has(n.kind));
    if (action.length) {
      setPopup((cur) => [...action, ...cur.filter((c) => !action.some((a) => a.id === c.id))].slice(0, 5));
      chime();
    }
    fresh.filter((n) => !NEEDS_ACTION.has(n.kind)).forEach((n) =>
      toast(n.title, { description: n.body ?? undefined, duration: 10_000, action: n.link ? { label: 'Open', onClick: () => open(n) } : undefined }));
    fresh.forEach(desktop);
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // While the tab is in the background, flash the unread count in its title.
  useEffect(() => {
    const base = BASE_TITLE;
    if (!unread) {
      document.title = base;
      return;
    }
    let on = false;
    const tick = () => {
      on = !on;
      document.title = document.hidden && on ? `(${unread > 99 ? '99+' : unread}) New notification` : base;
    };
    const id = window.setInterval(tick, 1500);
    const reset = () => { if (!document.hidden) document.title = base; };
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', reset);
      document.title = base;
    };
  }, [unread]);

  const dismiss = (id: string) => setPopup((cur) => cur.filter((n) => n.id !== id));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
            {unread > 0 ? <BellRing className="h-5 w-5 animate-[wiggle_1s_ease-in-out_2]" /> : <Bell className="h-5 w-5" />}
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/50" />
                <span className="relative">{unread > 99 ? '99+' : unread}</span>
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
          <div className="flex items-center justify-between px-3 py-2">
            <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
            {unread > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => { e.preventDefault(); void markRead(null); }}>
                <CheckCheck /> Mark all read
              </Button>
            )}
          </div>
          {permission === 'default' && (
            <button type="button" onClick={() => void allowDesktop()}
              className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg bg-primary-soft px-3 py-2 text-left text-xs text-primary hover:bg-primary-soft/70">
              <BellRing className="h-4 w-4 shrink-0" />
              <span><span className="font-semibold">Turn on desktop alerts</span><br />Get a browser notification when a request needs you.</span>
            </button>
          )}
          <DropdownMenuSeparator className="m-0" />
          <div className="max-h-[60vh] overflow-y-auto">
            {!q.data?.rows.length ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              q.data.rows.map((n) => (
                <DropdownMenuItem key={n.id} onSelect={() => open(n)} className={cn('flex items-start gap-2 rounded-none px-3 py-2.5', !n.read_at && 'bg-primary-soft/50')}>
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                    <span className="block text-[11px] text-muted-foreground">{fmtRelative(n.created_at)}</span>
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {popup.length > 0 && (
        <div className="fixed inset-x-0 top-4 z-[60] flex justify-center px-4" role="alertdialog" aria-live="assertive" aria-label="Approval requests waiting for you">
          <div className="card-rise w-full max-w-md overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-[0_24px_60px_-20px_rgb(232_116_12/0.55)]">
            <div className="flex items-center gap-3 bg-gradient-to-r from-primary to-orange-400 px-4 py-3 text-primary-foreground">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
                <span className="absolute inset-0 animate-ping rounded-full bg-white/30" />
                <BellRing className="relative h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{popup.length > 1 ? `${popup.length} requests need your approval` : 'A request needs your approval'}</p>
                <p className="text-xs text-white/85">Review it now, or find it later under the bell.</p>
              </div>
              <button type="button" aria-label="Close" className="rounded-md p-1 text-white/90 hover:bg-white/20" onClick={() => setPopup([])}><X className="h-4 w-4" /></button>
            </div>
            <ul className="max-h-[50vh] divide-y overflow-y-auto">
              {popup.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtRelative(n.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => dismiss(n.id)}>Later</Button>
                    <Button size="sm" onClick={() => { dismiss(n.id); open(n); }}>Review</Button>
                  </div>
                </li>
              ))}
            </ul>
            {permission === 'default' && (
              <button type="button" onClick={() => void allowDesktop()}
                className="flex w-full items-center justify-center gap-2 border-t bg-primary-soft/60 px-4 py-2 text-xs font-medium text-primary hover:bg-primary-soft">
                <BellRing className="h-3.5 w-3.5" /> Also alert me in the browser when I'm on another tab
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
