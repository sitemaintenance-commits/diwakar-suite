// Data access for the site register, team performance and solar analytics.
//
// Every call is a database function that checks the caller's permission
// and narrows the result to the sites they are assigned to, so these
// hooks carry no authorisation logic of their own.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type OpsSection = 'administration' | 'patrol' | 'security';
export type OpsCheck = 'pending' | 'ok' | 'not_ok' | 'na';
export type OpsShift = 'day' | 'night';
export type OpsUrgency = 'normal' | 'urgent' | 'critical';

async function rpc<T>(fn: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? fallback) as T;
}

// ------------------------------------------------------------ site register
export interface ChecklistItem {
  id: string;
  section: OpsSection;
  sort_order: number;
  title: string;
  frequency: string | null;
  scope_points: string | null;
  responsible: string;
  slot: string | null;
}

export interface SiteOpsData {
  date: string;
  shift: OpsShift;
  sites: { site_id: string; name: string; location: string | null }[];
  technicians: { id: string; name: string; site_id: string; role: string; mobile: string | null }[];
  checklist: ChecklistItem[];
  log: {
    id: string;
    status: 'draft' | 'submitted' | 'reviewed' | 'returned';
    urgency: OpsUrgency;
    technician_name: string | null;
    member_id: string | null;
    readiness: number | string;
    remarks: string | null;
    submitted_at: string | null;
    admin_done: number;
    patrol_done: number;
    security_done: number;
  } | null;
  entries: Record<string, { status: OpsCheck; remarks: string | null }>;
}

export interface OpsSummary {
  from: string;
  to: string;
  submitted: number;
  avg_readiness: number | string;
  open_points: number;
  logs: {
    id: string;
    log_date: string;
    site: string;
    site_id: string;
    shift: OpsShift;
    technician: string | null;
    urgency: OpsUrgency;
    status: string;
    readiness: number | string;
    admin: string;
    patrol: string;
    security: string;
    remarks: string | null;
    issues: string[];
  }[];
}

const EMPTY_OPS: SiteOpsData = { date: '', shift: 'day', sites: [], technicians: [], checklist: [], log: null, entries: {} };

export function useSiteOps(date: string, siteId: string | null, shift: OpsShift) {
  return useQuery({
    queryKey: ['site-ops', date, siteId, shift],
    queryFn: () => rpc<SiteOpsData>('get_site_ops', { p_date: date, p_site_id: siteId, p_shift: shift }, EMPTY_OPS),
  });
}

export function useOpsSummary(from: string, to: string, siteId: string) {
  return useQuery({
    queryKey: ['site-ops-summary', from, to, siteId],
    queryFn: () =>
      rpc<OpsSummary>(
        'get_site_ops_summary',
        { p_from: from, p_to: to, p_site_id: siteId && siteId !== 'all' ? siteId : null },
        { from, to, submitted: 0, avg_readiness: 0, open_points: 0, logs: [] },
      ),
  });
}

// ------------------------------------------------------------ performance
export interface TechScore {
  id: string;
  score_date: string;
  site: string;
  site_id: string;
  technician: string;
  attendance: number;
  daily_work: number;
  task_assigned: number;
  task_status: string;
  form_submit: number;
  auto_score: number;
  monthly_review: number | null;
  total_score: number;
  band: 'Good' | 'Average' | 'Critical';
  remarks: string | null;
  source: string;
}

export interface TeamPerformance {
  from: string;
  to: string;
  criteria: { key: string; label: string; description: string | null; max_score: number; is_auto: boolean }[];
  records: TechScore[];
  record_count: number;
  average: number | string;
  pending_review: number;
  ranking: { technician: string; site: string; score: number | string; days: number }[];
  by_site: { site: string; site_id: string; score: number | string; records: number }[];
  weekly: { week_start: string; score: number | string; records: number }[];
}

const EMPTY_PERF: TeamPerformance = {
  from: '', to: '', criteria: [], records: [], record_count: 0, average: 0, pending_review: 0,
  ranking: [], by_site: [], weekly: [],
};

export function useTeamPerformance(from: string, to: string, siteId: string) {
  return useQuery({
    queryKey: ['team-performance', from, to, siteId],
    queryFn: () =>
      rpc<TeamPerformance>(
        'get_team_performance',
        { p_from: from, p_to: to, p_site_id: siteId && siteId !== 'all' ? siteId : null },
        EMPTY_PERF,
      ),
  });
}

export interface TeamDirectory {
  site_count: number;
  member_count: number;
  sites: {
    site_id: string;
    site: string;
    location: string | null;
    member_count: number;
    readiness: number | string;
    members: { id: string; name: string; role: string; mobile: string | null; is_lead: boolean; user_id: string | null }[];
  }[];
}

export function useOmTeams() {
  return useQuery({
    queryKey: ['om-teams'],
    queryFn: () => rpc<TeamDirectory>('get_om_teams', {}, { site_count: 0, member_count: 0, sites: [] }),
  });
}

// ------------------------------------------------------------ analytics
export interface DailyPerformance {
  date: string;
  site_count: number;
  reported_count: number;
  capacity_dc_kwp: number | string;
  capacity_ac_kw: number | string;
  total_generation: number | string;
  total_grid_outage: number | string;
  avg_pr: number | string | null;
  avg_insolation: number | string | null;
  dc_cuf: number | string | null;
  ac_cuf: number | string | null;
  sites: {
    site_id: string;
    name: string;
    location: string | null;
    capacity_dc_kwp: number | string;
    capacity_ac_kw: number | string;
    tilt: number | string | null;
    generation_kwh: number | string;
    insolation: number | string | null;
    specific_yield: number | string | null;
    pr: number | string | null;
    dc_cuf: number | string | null;
    ac_cuf: number | string | null;
    grid_outage: number | string;
    plant_outage: number | string;
    remarks: string | null;
    source: string | null;
    reported: boolean;
  }[];
  ranking: { name: string; generation_kwh: number | string; specific_yield: number | string | null; pr: number | string | null }[];
}

const EMPTY_DAY: DailyPerformance = {
  date: '', site_count: 0, reported_count: 0, capacity_dc_kwp: 0, capacity_ac_kw: 0,
  total_generation: 0, total_grid_outage: 0, avg_pr: null, avg_insolation: null,
  dc_cuf: null, ac_cuf: null, sites: [], ranking: [],
};

export function useDailyPerformance(date: string) {
  return useQuery({
    queryKey: ['daily-performance', date],
    queryFn: () => rpc<DailyPerformance>('get_daily_performance', { p_date: date }, EMPTY_DAY),
  });
}

export interface SiteAnalysisRow {
  date: string;
  generation_kwh: number | string;
  insolation: number | string | null;
  specific_yield: number | string | null;
  pr: number | string | null;
  dc_cuf: number | string | null;
  ac_cuf: number | string | null;
  grid_outage: number | string;
  remarks: string | null;
}

export interface SiteAnalysis {
  site_id: string;
  site: string;
  from: string;
  to: string;
  capacity_dc_kwp: number | string;
  capacity_ac_kw: number | string;
  record_count: number;
  total_generation: number | string;
  total_outage: number | string;
  avg_pr: number | string | null;
  avg_dc_cuf: number | string | null;
  avg_ac_cuf: number | string | null;
  latest: { date: string; generation_kwh: number | string; pr: number | string | null; dc_cuf: number | string | null; ac_cuf: number | string | null } | null;
  best: { date: string; generation_kwh: number | string; pr: number | string | null; dc_cuf: number | string | null; ac_cuf: number | string | null } | null;
  rows: SiteAnalysisRow[];
}

export function useSiteAnalysis(siteId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ['site-analysis', siteId, from, to],
    enabled: Boolean(siteId),
    queryFn: () =>
      rpc<SiteAnalysis | null>('get_site_analysis', { p_site_id: siteId, p_from: from, p_to: to }, null),
  });
}

export interface ShutdownAnalysis {
  month: string;
  month_days: number;
  peak_hours: number | string;
  total_hours: number | string;
  total_shutdown_days: number | string;
  site_count: number;
  highest: { site: string; hours: number | string; shutdown_days: number | string } | null;
  sites: {
    site_id: string;
    site: string;
    hours: number | string;
    grid_hours: number | string;
    plant_hours: number | string;
    shutdown_days: number | string;
    monthly_days: number | string;
  }[];
  days: {
    date: string;
    site: string;
    site_id: string;
    hours: number | string;
    grid_hours: number | string;
    plant_hours: number | string;
    shutdown_days: number | string;
  }[];
}

const EMPTY_SHUTDOWN: ShutdownAnalysis = {
  month: '', month_days: 0, peak_hours: 11, total_hours: 0, total_shutdown_days: 0,
  site_count: 0, highest: null, sites: [], days: [],
};

export function useShutdown(month: string) {
  return useQuery({
    queryKey: ['shutdown-analysis', month],
    queryFn: () => rpc<ShutdownAnalysis>('get_shutdown_analysis', { p_month: month }, EMPTY_SHUTDOWN),
  });
}

export interface PortfolioAnalytics {
  year: number;
  site_count: number;
  total_generation: number | string;
  reporting_days: number;
  months_reported: number;
  capacity_dc_kwp: number | string;
  best_month: { month: number; generation_kwh: number | string } | null;
  monthly: { month: number; generation_kwh: number | string; days: number }[];
  ranking: { site: string; site_id: string; generation_kwh: number | string; specific_yield: number | string | null }[];
  outage_by_site: { site: string; hours: number | string }[];
  matrix: { site: string; site_id: string; total: number | string; months: Record<string, number | string> }[];
}

const EMPTY_PORTFOLIO: PortfolioAnalytics = {
  year: 0, site_count: 0, total_generation: 0, reporting_days: 0, months_reported: 0,
  capacity_dc_kwp: 0, best_month: null, monthly: [], ranking: [], outage_by_site: [], matrix: [],
};

export function usePortfolio(year: number) {
  return useQuery({
    queryKey: ['portfolio-analytics', year],
    queryFn: () => rpc<PortfolioAnalytics>('get_portfolio_analytics', { p_year: year }, EMPTY_PORTFOLIO),
  });
}
