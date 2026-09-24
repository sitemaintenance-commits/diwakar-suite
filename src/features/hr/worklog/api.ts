// The daily working sheet and the performance score sheet.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type WorkTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold';

async function rpc<T>(fn: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? fallback) as T;
}

export interface MyWorkLog {
  date: string;
  employee: { id: string; name: string; code: string; department: string | null; designation: string | null } | null;
  log: {
    id: string;
    status: 'draft' | 'submitted' | 'reviewed' | 'returned';
    priority: 'low' | 'medium' | 'high' | 'critical';
    remarks: string | null;
    submitted_at: string | null;
    task_count: number;
    completed: number;
  } | null;
  tasks: { seq: number; description: string; status: WorkTaskStatus }[];
  recent: { date: string; completed: number; task_count: number; status: string }[];
}

const EMPTY_LOG: MyWorkLog = { date: '', employee: null, log: null, tasks: [], recent: [] };

export function useMyWorkLog(date: string, employeeId?: string) {
  return useQuery({
    queryKey: ['my-work-log', date, employeeId ?? 'me'],
    queryFn: () => rpc<MyWorkLog>('get_my_work_log', { p_date: date, p_employee_id: employeeId ?? null }, EMPTY_LOG),
  });
}

export interface WorkLogDay {
  date: string;
  entries: {
    id: string;
    date: string;
    employee_code: string;
    employee: string;
    designation: string | null;
    department: string | null;
    priority: string;
    status: string;
    remarks: string | null;
    task_count: number;
    completed: number;
    score: number | string;
    tasks: { seq: number; description: string; status: WorkTaskStatus }[];
  }[];
}

export function useWorkLogDay(date: string) {
  return useQuery({
    queryKey: ['work-log-day', date],
    queryFn: () => rpc<WorkLogDay>('get_work_logs', { p_date: date }, { date, entries: [] }),
  });
}

export interface PmsScoreRow {
  employee_id: string;
  employee_code: string;
  employee: string;
  designation: string | null;
  department: string | null;
  days: number;
  tasks: number;
  completed: number;
  in_progress: number;
  not_started: number;
  on_hold: number;
  kpi: number;
  competency: number;
  discipline: number;
  attendance: number;
  attendance_source: 'register' | 'discipline';
  final: number;
  rating: string;
}

export interface PmsScores {
  from: string;
  to: string;
  working_days: number;
  weights: { kpi: number; competency: number; discipline: number; attendance: number; kpi_floor: number };
  employee_count: number;
  task_total: number;
  task_completed: number;
  task_in_progress: number;
  task_not_started: number;
  task_on_hold: number;
  team_score: number | string;
  team_rating: string;
  rows: PmsScoreRow[];
  not_reporting: { employee_id: string; employee: string; department: string | null }[];
}

const EMPTY_SCORES: PmsScores = {
  from: '', to: '', working_days: 0,
  weights: { kpi: 60, competency: 20, discipline: 10, attendance: 10, kpi_floor: 60 },
  employee_count: 0, task_total: 0, task_completed: 0, task_in_progress: 0,
  task_not_started: 0, task_on_hold: 0, team_score: 0, team_rating: 'Not rated',
  rows: [], not_reporting: [],
};

export function usePmsScores(from: string, to: string, departmentId: string) {
  return useQuery({
    queryKey: ['pms-scores', from, to, departmentId],
    queryFn: () =>
      rpc<PmsScores>(
        'get_pms_scores',
        { p_from: from, p_to: to, p_department_id: departmentId && departmentId !== 'all' ? departmentId : null },
        EMPTY_SCORES,
      ),
  });
}
