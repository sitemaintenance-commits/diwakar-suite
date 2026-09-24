// Data access for O&M / solar. Every table is site scoped by RLS, so these
// queries return only the sites the signed-in user is assigned to.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cleanSearch } from '@/features/admin/api';
import type { Equipment, GenerationRecord, MaintenanceRecord, SolarSite, Ticket } from '@/lib/types';

export const omKeys = {
  solarSites: ['solar-sites'] as const,
  equipment: (siteId: string) => ['equipment', siteId] as const,
  generation: (f: unknown) => ['generation', f] as const,
  monitor: (f: unknown) => ['generation-summary', f] as const,
  tickets: (f: unknown) => ['tickets', f] as const,
  ticket: (id: string) => ['ticket', id] as const,
  maintenance: (f: unknown) => ['maintenance', f] as const,
};

export interface MonitorSummary {
  from: string;
  to: string;
  has_data: boolean;
  today: number;
  yesterday: number;
  month: number;
  year: number;
  period: number;
  expected_period: number | null;
  capacity_kwp: number;
  site_count: number;
  cuf: number | null;
  ac_cuf: number | null;
  specific_yield: number | null;
  insolation: number | null;
  capacity_ac_kw: number;
  pr: number | null;
  plant_availability: number | null;
  grid_availability: number | null;
  sites: {
    site_id: string;
    name: string;
    capacity_kwp: number;
    today: number;
    month: number;
    period: number;
    expected_period: number | null;
    specific_yield: number | null;
    pr: number | null;
    grid_outage: number | string;
    capacity_ac_kw: number | string;
    tilt: number | string | null;
    last_reading: string | null;
    open_tickets: number;
  }[];
  daily: { date: string; kwh: number; expected: number | null }[];
}

export function useMonitor(from: string, to: string, siteId?: string) {
  return useQuery({
    queryKey: omKeys.monitor({ from, to, siteId }),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_generation_summary', {
        p_from: from || null,
        p_to: to || null,
        p_site: siteId && siteId !== 'all' ? siteId : null,
      });
      if (error) throw error;
      return (data ?? {}) as MonitorSummary;
    },
  });
}

export function useSolarSites() {
  return useQuery({
    queryKey: omKeys.solarSites,
    queryFn: async () => {
      const { data, error } = await supabase.from('solar_sites').select('*, sites ( id, name, code, location, district, state, status, capacity_kwp )');
      if (error) throw error;
      return (data ?? []) as unknown as SolarSite[];
    },
  });
}

export function useEquipment(siteId: string | undefined) {
  return useQuery({
    queryKey: omKeys.equipment(siteId ?? ''),
    enabled: Boolean(siteId),
    queryFn: async () => {
      const { data, error } = await supabase.from('equipment').select('*').eq('site_id', siteId!).order('type').order('name');
      if (error) throw error;
      return (data ?? []) as Equipment[];
    },
  });
}

export interface GenerationFilters {
  siteId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export async function fetchGeneration(f: GenerationFilters, all = false) {
  let q = supabase
    .from('generation_records')
    .select('*, sites ( id, name )', { count: 'exact' })
    .order('gen_date', { ascending: false })
    .order('site_id');
  if (f.siteId !== 'all') q = q.eq('site_id', f.siteId);
  if (f.from) q = q.gte('gen_date', f.from);
  if (f.to) q = q.lte('gen_date', f.to);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as GenerationRecord[], total: count ?? 0 };
}

export function useGeneration(f: GenerationFilters) {
  return useQuery({ queryKey: omKeys.generation(f), queryFn: () => fetchGeneration(f), placeholderData: (p) => p });
}

/** Existing readings for one date, keyed by site — used by the entry grid. */
export function useGenerationForDate(date: string) {
  return useQuery({
    queryKey: ['generation-date', date],
    enabled: Boolean(date),
    queryFn: async () => {
      const { data, error } = await supabase.from('generation_records').select('*').eq('gen_date', date);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as GenerationRecord[]).map((r) => [r.site_id, r]));
    },
  });
}

export interface TicketFilters {
  search: string;
  status: string;
  priority: string;
  siteId: string;
  assignedTo: string;
  page: number;
  pageSize: number;
}

const TICKET_SELECT = '*, sites ( id, name ), equipment ( id, name, type )';

export async function fetchTickets(f: TicketFilters, all = false) {
  let q = supabase.from('maintenance_tickets').select(TICKET_SELECT, { count: 'exact' }).order('reported_at', { ascending: false });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`title.ilike.%${s}%,issue.ilike.%${s}%,ticket_no.ilike.%${s}%`);
  if (f.status === 'open') q = q.in('status', ['open', 'assigned', 'in_progress']);
  else if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.priority !== 'all') q = q.eq('priority', f.priority);
  if (f.siteId !== 'all') q = q.eq('site_id', f.siteId);
  if (f.assignedTo !== 'all') q = q.eq('assigned_to', f.assignedTo);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Ticket[], total: count ?? 0 };
}

export function useTickets(f: TicketFilters) {
  return useQuery({ queryKey: omKeys.tickets(f), queryFn: () => fetchTickets(f), placeholderData: (p) => p });
}

export interface MaintenanceFilters {
  status: string;
  siteId: string;
  type: string;
  page: number;
  pageSize: number;
}

export async function fetchMaintenance(f: MaintenanceFilters, all = false) {
  let q = supabase
    .from('maintenance_records')
    .select('*, sites ( id, name ), equipment ( id, name )', { count: 'exact' })
    .order('scheduled_date', { ascending: true, nullsFirst: false });
  if (f.status === 'pending') q = q.in('status', ['todo', 'in_progress']);
  else if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.siteId !== 'all') q = q.eq('site_id', f.siteId);
  if (f.type !== 'all') q = q.eq('type', f.type);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as MaintenanceRecord[], total: count ?? 0 };
}

export function useMaintenance(f: MaintenanceFilters) {
  return useQuery({ queryKey: omKeys.maintenance(f), queryFn: () => fetchMaintenance(f), placeholderData: (p) => p });
}
