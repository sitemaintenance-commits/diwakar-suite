// Loads the signed-in user's effective access (roles → permissions union,
// sites, enabled modules) from the database via get_my_access().
//
// This drives the UI only: menus, buttons and route guards. The database
// enforces the same rules independently through RLS, so a stale or
// manipulated client state can at most SHOW a button — never read or write
// data it is not allowed to.
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AccessModule, MyAccess, PermAction, PermScope } from '@/lib/types';
import { useAuth } from '@/auth/AuthProvider';

interface AccessContextValue {
  access: MyAccess | null;
  loading: boolean;
  error: Error | null;
  can: (module: string, action?: PermAction) => boolean;
  canAny: (modules: string[], action?: PermAction) => boolean;
  scopeOf: (module: string) => PermScope | null;
  isModuleEnabled: (module: string) => boolean;
  moduleByKey: (module: string) => AccessModule | undefined;
  setting: <T = unknown>(key: string, fallback: T) => T;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export const ACCESS_QUERY_KEY = ['my-access'] as const;

export function AccessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  const query = useQuery({
    queryKey: [...ACCESS_QUERY_KEY, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_access');
      if (error) throw error;
      return data as MyAccess;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const access = query.data ?? null;

  const moduleMap = useMemo(() => new Map((access?.modules ?? []).map((m) => [m.key, m])), [access]);

  const isModuleEnabled = useCallback((key: string) => moduleMap.get(key)?.is_enabled ?? false, [moduleMap]);

  const can = useCallback(
    (module: string, action: PermAction = 'view') => {
      if (!access || access.profile?.status !== 'active') return false;
      if (!isModuleEnabled(module)) return false;
      if (access.is_super_admin) return true;
      return access.permissions[module]?.actions.includes(action) ?? false;
    },
    [access, isModuleEnabled],
  );

  const canAny = useCallback((modules: string[], action: PermAction = 'view') => modules.some((m) => can(m, action)), [can]);

  const scopeOf = useCallback(
    (module: string): PermScope | null => (access?.is_super_admin ? 'all' : (access?.permissions[module]?.scope ?? null)),
    [access],
  );

  const setting = useCallback(
    <T,>(key: string, fallback: T): T => {
      const v = access?.settings?.[key];
      return v === undefined || v === null || v === '' ? fallback : (v as T);
    },
    [access],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY });
  }, [queryClient]);

  const value = useMemo<AccessContextValue>(
    () => ({
      access,
      loading: query.isLoading,
      error: (query.error as Error) ?? null,
      can,
      canAny,
      scopeOf,
      isModuleEnabled,
      moduleByKey: (k) => moduleMap.get(k),
      setting,
      refresh,
    }),
    [access, query.isLoading, query.error, can, canAny, scopeOf, isModuleEnabled, moduleMap, setting, refresh],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error('useAccess must be used inside <AccessProvider>');
  return ctx;
}

/** Permission flags for one module, e.g. `const can = useCan('crm.leads'); can.create && <Button/>` */
export function useCan(module: string) {
  const { can, scopeOf } = useAccess();
  return useMemo(
    () => ({
      view: can(module, 'view'),
      create: can(module, 'create'),
      edit: can(module, 'edit'),
      delete: can(module, 'delete'),
      export: can(module, 'export'),
      approve: can(module, 'approve'),
      assign: can(module, 'assign'),
      scope: scopeOf(module),
    }),
    [module, can, scopeOf],
  );
}

/** Declarative gate: <Can module="crm.leads" action="create">...</Can> */
export function Can({
  module,
  action = 'view',
  children,
  fallback = null,
}: {
  module: string;
  action?: PermAction;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAccess();
  return <>{can(module, action) ? children : fallback}</>;
}
