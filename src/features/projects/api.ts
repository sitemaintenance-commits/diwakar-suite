// Phase 3 — projects, plan, approvals, materials, vendors, bills, money.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type ProjectStage =
  | 'design' | 'approvals' | 'procurement' | 'installation' | 'testing' | 'commissioning' | 'handover' | 'closed';
export type ApprovalStatus = 'not_started' | 'applied' | 'under_review' | 'approved' | 'rejected';
export type MaterialStatus = 'pending' | 'ordered' | 'dispatched' | 'at_site' | 'shortage' | 'installed';
export type BillStatus = 'submitted' | 'pm_approved' | 'accounts_approved' | 'paid' | 'rejected';
export type ClientPayStatus = 'pending' | 'invoiced' | 'part_received' | 'received';
export type WorkStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold';

export interface Project {
  id: string;
  project_code: string;
  name: string;
  site_id: string | null;
  client_name: string | null;
  segment: string;
  project_type: string;
  capacity_kwp: number | string;
  capacity_ac_kw: number | string;
  stage: ProjectStage;
  contract_value: number | string;
  start_date: string | null;
  target_commissioning: string | null;
  actual_commissioning: string | null;
  project_manager_id: string | null;
  site_engineer_id: string | null;
  district: string | null;
  state: string | null;
  address: string | null;
  notes: string | null;
}

export interface ProjectDashboard {
  project_count: number;
  capacity_kwp: number | string;
  capacity_ac_kw: number | string;
  commissioned: number;
  contract_value: number | string;
  open_tasks: number;
  overdue_tasks: number;
  approvals_pending: number;
  materials_open: number;
  material_shortage: number;
  vendors_active: number;
  bills_waiting: number;
  bills_waiting_value: number | string;
  client_invoiced: number | string;
  client_received: number | string;
  client_outstanding: number | string;
  average_progress: number | string;
  projects: {
    id: string;
    code: string;
    name: string;
    client: string | null;
    segment: string;
    project_type: string;
    capacity_kwp: number | string;
    capacity_ac_kw: number | string;
    stage: ProjectStage;
    progress: number | string;
    contract_value: number | string;
    task_total: number;
    task_done: number;
    target_commissioning: string | null;
    manager: string | null;
  }[];
  attention: { id: string; title: string; stage: string; project: string; due_date: string | null; status: string }[];
}

const EMPTY_DASH: ProjectDashboard = {
  project_count: 0, capacity_kwp: 0, capacity_ac_kw: 0, commissioned: 0, contract_value: 0,
  open_tasks: 0, overdue_tasks: 0, approvals_pending: 0, materials_open: 0, material_shortage: 0,
  vendors_active: 0, bills_waiting: 0, bills_waiting_value: 0, client_invoiced: 0,
  client_received: 0, client_outstanding: 0, average_progress: 0, projects: [], attention: [],
};

export function useProjectDashboard() {
  return useQuery({
    queryKey: ['project-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_project_dashboard');
      if (error) throw error;
      return (data && Object.keys(data).length ? data : EMPTY_DASH) as ProjectDashboard;
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Project;
    },
  });
}

/** One child table of a project, ordered and filtered by the project. */
function useChild<T>(table: string, projectId: string | undefined, order: string, ascending = true, select = '*') {
  return useQuery({
    queryKey: [table, projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq('project_id', projectId!)
        .order(order, { ascending });
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  stage: ProjectStage;
  assigned_to: string | null;
  due_date: string | null;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  completed_at: string | null;
  notes: string | null;
  sort_order: number;
}
export const useProjectTasks = (id?: string) => useChild<ProjectTask>('project_tasks', id, 'sort_order');

export interface ProjectApproval {
  id: string;
  project_id: string;
  kind: string;
  authority: string | null;
  reference_no: string | null;
  applied_on: string | null;
  expected_on: string | null;
  approved_on: string | null;
  status: ApprovalStatus;
  remarks: string | null;
}
export const useApprovals = (id?: string) => useChild<ProjectApproval>('project_approvals', id, 'created_at');

export interface ProjectMaterial {
  id: string;
  project_id: string;
  vendor_id: string | null;
  item: string;
  uom: string;
  qty_required: number | string;
  qty_dispatched: number | string;
  qty_received: number | string;
  rate: number | string;
  amount: number | string;
  status: MaterialStatus;
  po_no: string | null;
  expected_on: string | null;
  received_on: string | null;
  remarks: string | null;
}
export const useMaterials = (id?: string) => useChild<ProjectMaterial>('project_materials', id, 'created_at');

export interface VendorBill {
  id: string;
  project_id: string;
  vendor_id: string;
  bill_no: string;
  bill_date: string;
  description: string | null;
  amount: number | string;
  deductions: number | string;
  net_amount: number | string;
  status: BillStatus;
  pm_approved_at: string | null;
  accounts_approved_at: string | null;
  paid_on: string | null;
  utr_no: string | null;
  remarks: string | null;
}
export const useBills = (id?: string) => useChild<VendorBill>('vendor_bills', id, 'bill_date', false);

export interface ClientPayment {
  id: string;
  project_id: string;
  milestone: string;
  invoice_no: string | null;
  invoice_date: string | null;
  amount: number | string;
  received_amount: number | string;
  received_on: string | null;
  status: ClientPayStatus;
  remarks: string | null;
}
export const usePayments = (id?: string) => useChild<ClientPayment>('client_payments', id, 'created_at');

export interface ProjectUpdate {
  id: string;
  project_id: string;
  update_date: string;
  engineer_name: string | null;
  tl_work: WorkStatus;
  gss_bay: WorkStatus;
  piling: WorkStatus;
  panel: WorkStatus;
  module_work: WorkStatus;
  inverter: WorkStatus;
  material: WorkStatus;
  work_description: string | null;
  challenges: string | null;
  remarks: string | null;
}
export const useProjectUpdates = (id?: string) => useChild<ProjectUpdate>('project_updates', id, 'update_date', false);

export interface Vendor {
  id: string;
  name: string;
  category: string | null;
  gst_no: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  payment_terms: string | null;
  status: 'active' | 'inactive' | 'blacklisted';
  rating: number | string | null;
  notes: string | null;
}

export function useVendors() {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vendors').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as Vendor[];
    },
  });
}

export interface ProjectTemplate {
  id: string;
  name: string;
  segment: string | null;
  description: string | null;
  project_template_tasks: { id: string; sort_order: number; title: string; stage: ProjectStage; day_offset: number }[];
}

export function useTemplates() {
  return useQuery({
    queryKey: ['project-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_templates')
        .select('*, project_template_tasks ( id, sort_order, title, stage, day_offset )')
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as ProjectTemplate[];
    },
  });
}
