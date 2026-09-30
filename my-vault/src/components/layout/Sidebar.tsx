import { NavLink } from 'react-router';
import {
  Clock,
  Files,
  HardDrive,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useAvatarUrl, useDisplayName, useProfile } from '@/hooks/useProfile';
import { useStats } from '@/hooks/useFiles';
import { CATEGORIES, CATEGORY_ORDER } from '@/lib/categories';
import { getErrorMessage } from '@/lib/errors';
import { Avatar, Logo, ProgressBar } from '@/components/ui/misc';
import { IconButton } from '@/components/ui/Button';
import type { VaultStats } from '@/types';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  count?: (s: VaultStats) => number;
}

const countKey: Record<string, keyof VaultStats> = {
  image: 'images',
  screenshot: 'screenshots',
  pdf: 'pdfs',
  document: 'documents',
  other: 'other',
};

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'Library',
    items: [
      { to: '/files', label: 'All Files', icon: Files, count: (s) => s.total_files },
      ...CATEGORY_ORDER.map((c) => ({
        to: CATEGORIES[c].route,
        label: CATEGORIES[c].plural,
        icon: CATEGORIES[c].icon,
        count: (s: VaultStats) => Number(s[countKey[c]] ?? 0),
      })),
    ],
  },
  {
    title: 'Tools',
    items: [
      { to: '/favorites', label: 'Favorites', icon: Star, count: (s) => s.favorites },
      { to: '/recent', label: 'Recent', icon: Clock },
      { to: '/trash', label: 'Trash', icon: Trash2, count: (s) => s.trash },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/storage', label: 'Storage', icon: HardDrive },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: Props) {
  const { user, signOut } = useAuth();
  const { data: stats } = useStats();
  const { data: profile } = useProfile();
  const { data: avatarUrl } = useAvatarUrl(profile?.avatar_path);
  const name = useDisplayName();

  const logout = async () => {
    try {
      await signOut();
    } catch (err) {
      toast.error('Sign out failed', { description: getErrorMessage(err) });
    }
  };

  // On mobile the drawer is always expanded.
  const mini = collapsed && !mobileOpen;
  const quota = stats?.quota_bytes ?? 0;
  const usedPct = quota ? (stats!.total_bytes / quota) * 100 : 0;

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={onCloseMobile} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[width,transform] duration-200',
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'w-72 translate-x-0' : '-translate-x-full',
          mini ? 'lg:w-[76px]' : 'lg:w-64',
        )}
        aria-label="Main navigation"
      >
        <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-line', mini ? 'justify-center px-2' : 'px-5')}>
          <Logo />
          {!mini && (
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-tight font-bold text-ink">My Vault</p>
              <p className="truncate text-xs text-muted">Private Digital Library</p>
            </div>
          )}
          <IconButton label="Close menu" size="sm" onClick={onCloseMobile} className="lg:hidden">
            <X className="size-4" />
          </IconButton>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
          {SECTIONS.map((section, i) => (
            <div key={i} className={cn(i > 0 && 'mt-5')}>
              {section.title &&
                (mini ? (
                  <div className="mx-auto mb-2 h-px w-8 bg-line" />
                ) : (
                  <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-faint uppercase">{section.title}</p>
                ))}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const count = stats && item.count ? item.count(stats) : undefined;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onCloseMobile}
                        title={mini ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'group flex items-center gap-3 rounded-xl text-sm font-medium transition-colors',
                            mini ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                            isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-subtle hover:text-ink',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={cn('size-[18px] shrink-0', isActive ? 'text-brand' : 'text-faint group-hover:text-muted')} />
                            {!mini && <span className="flex-1 truncate">{item.label}</span>}
                            {!mini && count !== undefined && count > 0 && (
                              <span className={cn('text-xs tabular-nums', isActive ? 'text-brand-ink' : 'text-faint')}>{count.toLocaleString()}</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {!mini && stats && quota > 0 && (
          <NavLink to="/storage" onClick={onCloseMobile} className="mx-3 mb-3 block rounded-xl border border-line bg-subtle/60 p-3 hover:border-line-strong">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-ink">Storage</span>
              <span className="text-muted">{Math.min(100, Math.round(usedPct))}%</span>
            </div>
            <ProgressBar value={usedPct} tone={usedPct > 90 ? 'danger' : 'brand'} />
            <p className="mt-2 text-[11px] text-muted">
              {formatBytes(stats.total_bytes)} of {formatBytes(quota, 0)}
            </p>
          </NavLink>
        )}

        <div className={cn('flex shrink-0 items-center gap-2 border-t border-line p-3', mini && 'flex-col')}>
          <NavLink to="/settings" onClick={onCloseMobile} className={cn('flex min-w-0 items-center gap-2.5 rounded-xl p-1 hover:bg-subtle', !mini && 'flex-1')} title="Profile settings">
            <Avatar name={name} url={avatarUrl} size={34} />
            {!mini && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{name}</p>
                <p className="truncate text-xs text-muted">{user?.email}</p>
              </div>
            )}
          </NavLink>
          <IconButton label="Sign out" size="sm" onClick={logout}>
            <LogOut className="size-4" />
          </IconButton>
        </div>

        <button
          type="button"
          onClick={onToggleCollapsed}
          className="absolute top-5 -right-3 hidden size-6 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card hover:text-ink lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
        </button>
      </aside>
    </>
  );
}
