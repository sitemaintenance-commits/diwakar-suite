// HR / PMS data access. Everyone can read their own attendance, leave and
// review; seeing other people needs the module permission (and its scope).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cleanSearch } from '@/features/admin/api';
import type { Attendance, EmployeeRow, LeaveRequest, PerformanceGoal, PerformanceReview, Task } from '@/lib/types';

export interface HrSummary {
  date: string;
  employees: number;
  present: number;
  absent: number;
  on_leave: number;
  marked: number;
  leave_pending: number;
  reviews_open: number;
  tasks_open: number;
  tasks_overdue: number;
}

export function useHrSummary(date?: string) {
  return useQuery({
    queryKey: ['hr-summary', date ?? 'today'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hr_summary', { p_date: date ?? null });
      if (error) throw error;
      return (data ?? {}) as HrSummary;
    },
  });
}

const EMPLOYEE_SELECT = `
  *,
  departments!employees_department_id_fkey ( id, name ),
  designations!employees_designation_id_fkey ( id, name )
`;

export function useEmployees(search = '', departmentId = 'all', status = 'active') {
  return useQuery({
    queryKey: ['employees', search, departmentId, status],
    queryFn: async () => {
      let q = supabase.from('employees').select(EMPLOYEE_SELECT).order('full_name');
      const s = cleanSearch(search);
      if (s) q = q.or(`full_name.ilike.%${s}%,employee_code.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
      if (departmentId !== 'all') q = q.eq('department_id', departmentId);
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as EmployeeRow[];
    },
  });
}

export function useAttendance(from: string, to: string, employeeId = 'all') {
  return useQuery({
    queryKey: ['attendance', from, to, employeeId],
    queryFn: async () => {
      let q = supabase.from('attendance').select('*').gte('att_date', from).lte('att_date', to).order('att_date', { ascending: false });
      if (employeeId !== 'all') q = q.eq('employee_id', employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Attendance[];
    },
  });
}

export function useLeaveRequests(status = 'all') {
  return useQuery({
    queryKey: ['leave-requests', status],
    queryFn: async () => {
      let q = supabase
        .from('leave_requests')
        .select('*, employees ( id, full_name, employee_code )')
        .order('from_date', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LeaveRequest[];
    },
  });
}

export function useReviews(status = 'all') {
  return useQuery({
    queryKey: ['performance-reviews', status],
    queryFn: async () => {
      let q = supabase
        .from('performance_reviews')
        .select('*, employees ( id, full_name, employee_code )')
        .order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PerformanceReview[];
    },
  });
}

export function useReviewGoals(reviewId: string | undefined) {
  return useQuery({
    queryKey: ['performance-goals', reviewId ?? ''],
    enabled: Boolean(reviewId),
    queryFn: async () => {
      const { data, error } = await supabase.from('performance_goals').select('*').eq('review_id', reviewId!).order('sort_order');
      if (error) throw error;
      return (data ?? []) as PerformanceGoal[];
    },
  });
}

export interface TaskFilters {
  search: string;
  status: string;
  module: string;
  assignedTo: string;
  page: number;
  pageSize: number;
}

export async function fetchTasks(f: TaskFilters, all = false) {
  let q = supabase
    .from('tasks')
    .select('*, sites ( id, name )', { count: 'exact' })
    .order('due_date', { ascending: true, nullsFirst: false });
  const s = cleanSearch(f.search);
  if (s) q = q.or(`title.ilike.%${s}%,description.ilike.%${s}%,task_code.ilike.%${s}%`);
  if (f.status === 'open') q = q.in('status', ['todo', 'in_progress', 'blocked']);
  else if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.module !== 'all') q = q.eq('module', f.module);
  if (f.assignedTo !== 'all') q = q.eq('assigned_to', f.assignedTo);
  q = all ? q.limit(5000) : q.range(f.page * f.pageSize, f.page * f.pageSize + f.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Task[], total: count ?? 0 };
}

export function useTasks(f: TaskFilters) {
  return useQuery({ queryKey: ['tasks', f], queryFn: () => fetchTasks(f), placeholderData: (p) => p });
}
