import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccess } from '@/auth/AccessProvider';
import { BUILT_MODULES, iconFor } from '@/app/registry';
import { BrandLockup } from '@/components/common/Brand';
import type { AccessModule } from '@/lib/types';

interface NavGroup {
  key: string;
  label: string;
  icon: string | null;
  items: AccessModule[];
}

/** The reports modules share one page, so the menu shows a single entry. */
const REPORT_MODULES = ['reports.crm', 'reports.projects', 'reports.om', 'reports.generation', 'reports.hr', 'reports.daily'];

/** Builds the menu from: DB module catalogue ∩ built pages ∩ user's VIEW permission. */
export function useNavigation(): NavGroup[] {
  const { access, can } = useAccess();
  return useMemo(() => {
    if (!access) return [];
    return [...access.groups]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        key: g.key,
        label: g.label,
        icon: g.icon,
        items: access.modules
          .filter(
            (m) =>
              m.group === g.key && m.show_in_nav && m.is_enabled && m.route && BUILT_MODULES.has(m.key) && can(m.key, 'view'),
          )
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      .map((g) =>
        g.key === 'analytics'
          ? {
              ...g,
              items: REPORT_MODULES.some((m) => can(m, 'view'))
                ? [
                    {
                      key: 'reports',
                      label: 'Reports',
                      route: '/reports',
                      icon: 'BarChart3',
                      group: 'analytics',
                      sort_order: 0,
                      is_enabled: true,
                      show_in_nav: true,
                      phase: 7,
                    } as AccessModule,
                  ]
                : [],
            }
          : g,
      )
      .filter((g) => g.items.length > 0);
  }, [access, can]);
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useNavigation();
  const { setting } = useAccess();
  // The desktop sidebar opens sections as hover flyouts; the phone drawer
  // (which passes onNavigate) has no hover, so it expands them in place.
  const flyouts = !onNavigate;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center border-b px-5">
        <BrandLockup brand={setting('brand_name', 'Diwakar Solar')} suite={setting('suite_name', 'Management Suite')} />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {groups.map((g) => {
          // The top group (Dashboard, Documents) and any group with a single item
          // named like the group render flat: one click, no flyout.
          if (g.key === 'dashboard' || (g.items.length === 1 && g.items[0].label === g.label)) {
            return g.items.map((item) => <NavItem key={item.key} item={item} onNavigate={onNavigate} />);
          }
          return flyouts ? <FlyoutGroup key={g.key} group={g} /> : <AccordionGroup key={g.key} group={g} onNavigate={onNavigate} />;
        })}
      </nav>
      <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} {setting('company_name', 'Diwakar Renewable & Infra Pvt. Ltd.')}
      </div>
    </div>
  );
}

const rowClass = (active: boolean, open = false) =>
  cn(
    'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100',
    open && 'bg-slate-100',
    active && 'bg-primary-soft text-primary hover:bg-primary-soft',
  );

function useActiveInGroup(group: NavGroup) {
  const location = useLocation();
  return group.items.some((i) => i.route && location.pathname.startsWith(i.route));
}

// ---------------------------------------------------------------- desktop: hover flyout
const CLOSE_DELAY_MS = 180; // grace period to move the pointer from the row into the panel

function FlyoutGroup({ group }: { group: NavGroup }) {
  const GroupIcon = iconFor(group.icon);
  const active = useActiveInGroup(group);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const rowRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const panelId = useId();

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const show = useCallback(() => {
    cancelClose();
    const r = rowRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top - 8, left: r.right + 10 });
    setOpen(true);
  }, []);
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  // Keep the panel inside the window when the row is near the bottom.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const h = panelRef.current.offsetHeight;
    const maxTop = window.innerHeight - h - 12;
    if (pos.top > maxTop) setPos((p) => ({ ...p, top: Math.max(12, maxTop) }));
  }, [open, pos.top]);

  // Close on navigation, Escape, scroll or a click elsewhere (touch screens).
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        rowRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rowRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const nav = rowRef.current?.closest('nav');
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onScroll);
    nav?.addEventListener('scroll', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onScroll);
      nav?.removeEventListener('scroll', onScroll);
    };
  }, [open]);
  useEffect(() => () => cancelClose(), []);

  const openWithKeyboard = () => {
    show();
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('a')?.focus());
  };

  return (
    <div onMouseEnter={show} onMouseLeave={hideSoon}>
      <button
        ref={rowRef}
        type="button"
        className={rowClass(active, open)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openWithKeyboard();
          }
        }}
      >
        <GroupIcon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate">{group.label}</span>
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200', open && 'translate-x-0.5 text-slate-600')} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="menu"
            aria-label={group.label}
            onMouseEnter={cancelClose}
            onMouseLeave={hideSoon}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                setOpen(false);
                rowRef.current?.focus();
              }
            }}
            style={{ top: pos.top, left: pos.left }}
            className="nav-flyout fixed z-50 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10"
          >
            <div className="flex items-center gap-2 px-3 pb-2 pt-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
              <GroupIcon className="h-3.5 w-3.5" /> {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.key} item={item} onNavigate={() => setOpen(false)} role="menuitem" />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------- phone drawer: smooth accordion
function AccordionGroup({ group, onNavigate }: { group: NavGroup; onNavigate?: () => void }) {
  const GroupIcon = iconFor(group.icon);
  const active = useActiveInGroup(group);
  const [open, setOpen] = useState(active);
  const panelId = useId();
  return (
    <div>
      <button type="button" className={rowClass(active && !open)} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <GroupIcon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate">{group.label}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200', !open && '-rotate-90')} />
      </button>
      {/* Animating grid rows from 0fr to 1fr slides the list open smoothly. */}
      <div id={panelId} className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="overflow-hidden">
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
            {group.items.map((item) => (
              <NavItem key={item.key} item={item} onNavigate={onNavigate} tabIndex={open ? undefined : -1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItem({ item, onNavigate, role, tabIndex }: { item: AccessModule; onNavigate?: () => void; role?: string; tabIndex?: number }) {
  const Icon = iconFor(item.icon);
  return (
    <NavLink
      to={item.route!}
      end={item.route === '/'}
      onClick={onNavigate}
      role={role}
      tabIndex={tabIndex}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-950',
          isActive && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}
