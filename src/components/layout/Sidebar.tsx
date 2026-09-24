import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronDown } from 'lucide-react';
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
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center border-b px-5">
        <BrandLockup brand={setting('brand_name', 'Diwakar Solar')} suite={setting('suite_name', 'Management Suite')} />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {groups.map((g) => {
          // A group with a single item named like the group (Dashboard) renders flat.
          if (g.items.length === 1 && g.items[0].label === g.label) {
            return <NavItem key={g.key} item={g.items[0]} onNavigate={onNavigate} />;
          }
          const GroupIcon = iconFor(g.icon);
          const activeInGroup = g.items.some((i) => i.route && location.pathname.startsWith(i.route));
          const isCollapsed = collapsed[g.key] ?? false;
          return (
            <div key={g.key} className="pt-3">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600',
                  activeInGroup && 'text-slate-600',
                )}
                aria-expanded={!isCollapsed}
              >
                <GroupIcon className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{g.label}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')} />
              </button>
              {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                  {g.items.map((item) => (
                    <NavItem key={item.key} item={item} onNavigate={onNavigate} nested />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t px-5 py-3 text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} {setting('company_name', 'Diwakar Renewable & Infra Pvt. Ltd.')}
      </div>
    </div>
  );
}

function NavItem({ item, onNavigate, nested }: { item: AccessModule; onNavigate?: () => void; nested?: boolean }) {
  const Icon = iconFor(item.icon);
  return (
    <NavLink
      to={item.route!}
      end={item.route === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-slate-100',
          nested && 'pl-3',
          isActive && 'bg-primary-soft text-primary hover:bg-primary-soft',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}
