// Data access for administration pages. Every query runs with the user's
// JWT; RLS decides what comes back.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  AuditLog,
  Department,
  Designation,
  ModuleRow,
  Person,
  Role,
  RolePermission,
  Site,
  UserRow,
  UserStatus,
} from '@/lib/types';

export const qk = {
  roles: ['roles'] as const,
  roleUserCounts: ['role-user-counts'] as const,
  rolePermissions: (roleId: string) => ['role-permissions', roleId] as const,
  modules: ['modules-catalogue'] as const,
  sites: ['sites'] as const,
  siteUsers: (siteId: string) => ['site-users', siteId] as const,
  departments: ['departments'] as const,
  designations: ['designations'] as const,
  people: ['people'] as const,
  users: (f: UserFilters) => ['users', f] as const,
  user: (id: string) => ['user', id] as const,
  audit: (f: AuditFilters) => ['audit', f] as const,
  settings: ['app-settings'] as const,
  dashboard: ['dashboard-summary'] as const,
};

/** Strip characters that have meaning inside PostgREST filter strings. */
export function cleanSearch(s: string) {
  return s.replace(/[%,()*\\:"']/g, ' ').trim();
}

// ---------------------------------------------------------------- lookups
export function useRoles() {
  return useQuery({
    queryKey: qk.roles,
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('*').order('is_system', { ascending: false }).order('name');
      if (error) throw error;
      return data as Role[];
    },
  });
}

export function useRoleUserCounts(enabled = true) {
  return useQuery({
    queryKey: qk.roleUserCounts,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_roles').select('role_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) counts[r.role_id] = (counts[r.role_id] ?? 0) + 1;
      return counts;
    },
  });
}

export function useModulesCatalogue() {
  return useQuery({
    queryKey: qk.modules,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('modules')
        .select('*, module_groups(key, label, sort_order)')
        .order('sort_order');
      if (error) throw error;
      return (data as ModuleRow[]).sort(
        (a, b) => (a.module_groups?.sort_order ?? 0) - (b.module_groups?.sort_order ?? 0) || a.sort_order - b.sort_order,
      );
    },
  });
}

export function useRolePermissions(roleId: string | null) {
  return useQuery({
    queryKey: qk.rolePermissions(roleId ?? ''),
    enabled: Boolean(roleId),
    queryFn: async () => {
      const { data, error } = await supabase.from('role_permissions').select('role_id, module_id, action, scope').eq('role_id', roleId!);
      if (error) throw error;
      return data as RolePermission[];
    },
  });
}

export function useSites() {
  return useQuery({
    queryKey: qk.sites,
    queryFn: async () => {
      const { data, error } = await supabase.from('sites').select('*').order('name');
      if (error) throw error;
      return data as Site[];
    },
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: qk.departments,
    queryFn: async () => {
      const { data, error } = await supabase.from('departments').select('*').order('name');
      if (error) throw error;
      return data as Department[];
    },
  });
}

export function useDesignations() {
  return useQuery({
    queryKey: qk.designations,
    queryFn: async () => {
      const { data, error } = await supabase.from('designations').select('*').order('name');
      if (error) throw error;
      return data as Designation[];
    },
  });
}

export function usePeople() {
  return useQuery({
    queryKey: qk.people,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_people', { p_search: null });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------- users
export interface UserFilters {
  search: string;
  status: UserStatus | 'all';
  roleId: string | 'all';
  departmentId: string | 'all';
  siteId: string | 'all';
  page: number;
  pageSize: number;
}

export const USER_SELECT = `
  id, email, full_name, phone, avatar_path, status, all_sites, last_login_at, created_at, employee_id,
  employees (
    id, employee_code, department_id, designation_id, joining_date, reporting_manager_id,
    departments!employees_department_id_fkey ( name ),
    designations!employees_designation_id_fkey ( name )
  ),
  user_roles ( role_id, roles ( id, name, key, is_system ) ),
  user_sites ( site_id, sites ( id, name ) )
`;

async function idsFor(table: 'user_roles' | 'user_sites', column: 'role_id' | 'site_id', value: string) {
  const { data, error } = await supabase.from(table).select('user_id').eq(column, value);
  if (error) throw error;
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

export async function fetchUsers(f: UserFilters, all = false) {
  let q = supabase.from('profiles').select(USER_SELECT, { count: 'exact' }).order('full_name');
  const s = cleanSearch(f.search);
  if (s) q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
  if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.roleId !== 'all') q = q.in('id', await idsFor('user_roles', 'role_id', f.roleId));
  if (f.siteId !== 'all') q = q.in('id', await idsFor('user_sites', 'site_id', f.siteId));
  if (f.departmentId !== 'all') {
    const { data, error } = await supabase.from('employees').select('id').eq('department_id', f.departmentId);
    if (error) throw error;
    q = q.in('employee_id', (data ?? []).map((e) => e.id));
  }
  if (!all) q = q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  else q = q.limit(5000);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as UserRow[], total: count ?? 0 };
}

export function useUsers(f: UserFilters) {
  return useQuery({ queryKey: qk.users(f), queryFn: () => fetchUsers(f), placeholderData: (prev) => prev });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: qk.user(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select(USER_SELECT).eq('id', id!).single();
      if (error) throw error;
      return data as unknown as UserRow;
    },
  });
}

// ---------------------------------------------------------------- audit
export interface AuditFilters {
  search: string;
  actorId: string | 'all';
  module: string | 'all';
  action: string | 'all';
  from: string; // yyyy-mm-dd (IST)
  to: string;
  entityId?: string;
  page: number;
  pageSize: number;
}

export async function fetchAudit(f: AuditFilters, all = false) {
  let q = supabase.from('audit_logs').select('*', { count: 'exact' }).order('occurred_at', { ascending: false });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`summary.ilike.%${s}%,actor_name.ilike.%${s}%,actor_email.ilike.%${s}%`);
  if (f.actorId !== 'all') q = q.eq('actor_id', f.actorId);
  if (f.module !== 'all') q = q.eq('module_key', f.module);
  if (f.action !== 'all') q = q.eq('action', f.action);
  if (f.from) q = q.gte('occurred_at', `${f.from}T00:00:00+05:30`);
  if (f.to) q = q.lte('occurred_at', `${f.to}T23:59:59.999+05:30`);
  if (f.entityId) q = q.or(`entity_id.eq.${f.entityId},actor_id.eq.${f.entityId}`);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as AuditLog[], total: count ?? 0 };
}

export function useAudit(f: AuditFilters, enabled = true) {
  return useQuery({ queryKey: qk.audit(f), enabled, queryFn: () => fetchAudit(f), placeholderData: (prev) => prev });
}

// ---------------------------------------------------------------- settings
export function useSettings() {
  return useQuery({
    queryKey: qk.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('key, value');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
    },
  });
}
