import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CalendarDays, LogOut, Menu, PanelLeftClose, PanelLeftOpen, UserRound } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { NotificationsBell } from '@/components/layout/NotificationsBell';
import { Button } from '@/components/ui/button';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/common';
import { useAuth } from '@/auth/AuthProvider';
import { useAccess } from '@/auth/AccessProvider';
import { TIMEZONE } from '@/lib/format';
import { cn } from '@/lib/utils';

// The menu stays pinned on wide screens (1280 px and up) and can be hidden
// there to give tables the full width; on anything narrower it opens as a
// drawer from the menu button, so pages are not squeezed beside it.
const MENU_KEY = 'menu-hidden';
const readMenuHidden = () => { try { return localStorage.getItem(MENU_KEY) === '1'; } catch { return false; } };

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuHidden, setMenuHidden] = useState(readMenuHidden);
  const toggleMenu = () => setMenuHidden((h) => {
    try { localStorage.setItem(MENU_KEY, h ? '0' : '1'); } catch { /* not kept */ }
    return !h;
  });

  return (
    <div className="flex h-full min-h-screen">
      {/* Desktop sidebar */}
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar', !menuHidden && 'xl:block')}>
        <Sidebar />
      </aside>

      {/* Drawer (narrow screens, or when the pinned menu is hidden) */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Dialog>

      <div className={cn('flex min-w-0 flex-1 flex-col', !menuHidden && 'xl:pl-64')}>
        <Topbar onMenu={() => setMobileOpen(true)} menuHidden={menuHidden} onToggleMenu={toggleMenu} />
        <main className="flex-1 px-4 py-4 sm:px-6 lg:py-5">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Topbar({ onMenu, menuHidden, onToggleMenu }: { onMenu: () => void; menuHidden: boolean; onToggleMenu: () => void }) {
  const { signOut } = useAuth();
  const { access } = useAccess();
  const profile = access?.profile;
  const roleNames = access?.roles.map((r) => r.name).join(', ') || 'No role assigned';
  const today = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIMEZONE,
  }).format(new Date());

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className={cn(!menuHidden && 'xl:hidden')} onClick={onMenu} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="hidden xl:inline-flex" onClick={onToggleMenu}
        aria-label={menuHidden ? 'Show the menu' : 'Hide the menu'} title={menuHidden ? 'Show the menu' : 'Hide the menu for more room'}>
        {menuHidden ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </Button>
      <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
        <CalendarDays className="h-4 w-4" />
        {today}
      </div>
      <div className="flex-1" />
      <NotificationsBell />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted" aria-label="Account menu">
            <UserAvatar name={profile?.full_name} path={profile?.avatar_path} />
            <div className="hidden leading-tight sm:block">
              <div className="max-w-[180px] truncate text-sm font-semibold">{profile?.full_name || profile?.email}</div>
              <div className="max-w-[180px] truncate text-xs text-muted-foreground">{roleNames}</div>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel>
            <div className="truncate">{profile?.full_name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{profile?.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/profile">
              <UserRound /> My profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
