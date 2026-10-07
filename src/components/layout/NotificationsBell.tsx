// In-app notifications (approvals for now): a bell in the top bar with the
// unread count; opening an item marks it read and goes to its page.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
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
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unread = q.data?.unread ?? 0;

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 99 ? '99+' : unread}
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
  );
}
