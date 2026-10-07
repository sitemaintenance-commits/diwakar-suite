// Approvals: multi-level approval of requests employees make to the
// company. Every read and change goes through the database functions,
// which decide who sees and does what (the tables are closed to the app).
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BadgeTone } from '@/lib/types';

export type RequestStatus =
  | 'draft' | 'submitted' | 'pending' | 'in_review' | 'approved' | 'rejected' | 'returned' | 'cancelled' | 'completed';
export type LevelStatus = 'locked' | 'pending' | 'approved' | 'rejected' | 'returned' | 'skipped' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type ApprovalTab = 'all' | 'my_approvals' | 'my_requests';

export const CATEGORIES: Record<string, string> = {
  purchase: 'Purchase',
  payment: 'Payment',
  reimbursement: 'Reimbursement',
  travel: 'Travel',
  leave: 'Leave',
  procurement: 'Procurement',
  project: 'Project',
  maintenance: 'Maintenance',
  other: 'Other',
};
/** Types raised before the multi-level upgrade; shown, not offered. */
const LEGACY_CATEGORIES: Record<string, string> = { advance: 'Advance', equipment: 'IT / equipment' };
export const categoryLabel = (c: string) => CATEGORIES[c] ?? LEGACY_CATEGORIES[c] ?? c;

export const PRIORITIES: Record<Priority, { label: string; tone: BadgeTone }> = {
  low: { label: 'Low', tone: 'secondary' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'destructive' },
};

export const STATUS: Record<RequestStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'secondary' },
  submitted: { label: 'Submitted', tone: 'info' },
  pending: { label: 'Pending Approval', tone: 'warning' },
  in_review: { label: 'In Review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  returned: { label: 'Returned for Changes', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
  completed: { label: 'Completed', tone: 'success' },
};

export const LEVEL_STATUS: Record<LevelStatus, { label: string; tone: BadgeTone }> = {
  locked: { label: 'Locked', tone: 'secondary' },
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  returned: { label: 'Returned', tone: 'info' },
  skipped: { label: 'Skipped', tone: 'secondary' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export const ACTION_LABEL: Record<string, string> = {
  created: 'Created as draft',
  submitted: 'Submitted for approval',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned for changes',
  cancelled: 'Cancelled',
  reopened: 'Reopened',
  completed: 'Marked completed',
  reassigned: 'Approver changed',
  edited: 'Details edited',
  level_skipped: 'Level skipped',
  document_added: 'Document added',
  document_version: 'New document version',
  document_deleted: 'Document deleted',
  commented: 'Comment',
};

export const ALLOWED_FILES = /\.(pdf|docx?|xlsx?|jpe?g|png)$/i;
export const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png';
export const MAX_FILE = 25 * 1024 * 1024;

// ------------------------------------------------------------------ list
export interface ApprovalRow {
  id: string;
  request_no: string;
  title: string;
  category: string;
  requester: string;
  requester_id: string;
  department: string | null;
  amount: number | null;
  priority: Priority;
  status: RequestStatus;
  needed_by: string | null;
  current_level: number | null;
  current_level_name: string | null;
  total_levels: number;
  current_approver: string | null;
  my_turn: boolean;
  mine: boolean;
  attachments: number;
  created_at: string;
  updated_at: string;
}

export interface ApprovalCounts {
  total: number; pending: number; my_approvals: number; my_requests: number;
  approved: number; rejected: number; returned: number; urgent: number;
}

export interface ApprovalList {
  is_admin: boolean;
  total: number;
  page: number;
  page_size: number;
  rows: ApprovalRow[];
  counts: ApprovalCounts;
  options: {
    requesters: { id: string; name: string }[];
    approvers: { id: string; name: string }[];
    departments: { id: string; name: string }[];
  };
}

export interface ListParams {
  tab: ApprovalTab;
  search?: string;
  status?: string;
  category?: string;
  priority?: string;
  department_id?: string;
  requester_id?: string;
  approver_id?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export const approvalKeys = {
  all: ['approvals'] as const,
  list: (p: ListParams) => ['approvals', 'list', p] as const,
  detail: (id: string) => ['approvals', 'detail', id] as const,
  settings: ['approvals', 'settings'] as const,
  options: ['approvals', 'form-options'] as const,
};

export function useApprovals(p: ListParams) {
  return useQuery({
    queryKey: approvalKeys.list(p),
    queryFn: async () => {
      const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v != null));
      const { data, error } = await supabase.rpc('list_approvals', { p: clean });
      if (error) throw error;
      return data as ApprovalList;
    },
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------- detail
export interface ApprovalRequest {
  id: string;
  request_no: string;
  /** The approvers the requester chose, in order (the Accounts head follows by itself). */
  chosen_approvers?: string[] | null;
  category: string;
  title: string;
  details: string | null;
  amount: number | null;
  needed_by: string | null;
  priority: Priority;
  status: RequestStatus;
  decision_note: string | null;
  requested_by: string;
  requester: string;
  employee_code: string | null;
  department_id: string | null;
  department: string | null;
  site_id: string | null;
  site: string | null;
  project_id: string | null;
  project: string | null;
  workflow_name: string | null;
  round: number;
  current_level: number | null;
  total_levels: number;
  completed_levels: number;
  current_approver: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalStep {
  id: string;
  round: number;
  level_no: number;
  name: string;
  approver_type: 'employee' | 'department_head' | 'role';
  approver_employee_id: string | null;
  approver_role_id: string | null;
  approver: string | null;
  unassigned: boolean;
  status: LevelStatus;
  activated_at: string | null;
  acted_by_name: string | null;
  acted_role: string | null;
  acted_at: string | null;
  comment: string | null;
}

export interface TimelineEntry {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  actor_name: string | null;
  actor_role: string | null;
  round: number | null;
  level_no: number | null;
  document_id: string | null;
  version_no: number | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface DocVersion {
  id: string;
  version_no: number;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

export interface ApprovalDocument {
  id: string;
  file_name: string;
  category: string | null;
  current_version: number;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
  can_delete: boolean;
  versions: DocVersion[];
}

export interface ApprovalPermissions {
  is_admin: boolean;
  is_requester: boolean;
  can_edit: boolean;
  can_submit: boolean;
  can_cancel: boolean;
  can_reopen: boolean;
  can_complete: boolean;
  can_reassign: boolean;
  can_upload: boolean;
  act_step_id: string | null;
}

export interface ApprovalDetail {
  request: ApprovalRequest;
  steps: ApprovalStep[];
  timeline: TimelineEntry[];
  documents: ApprovalDocument[];
  permissions: ApprovalPermissions;
}

export function useApprovalDetail(id: string | undefined) {
  return useQuery({
    queryKey: approvalKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('approval_detail', { p_id: id });
      if (error) throw error;
      return data as ApprovalDetail;
    },
  });
}

// ------------------------------------------------------------------ form
export interface FormOptions {
  my_department_id: string | null;
  departments: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  workflows: { category: string | null; name: string; levels: string[] | null }[];
  /** Whom a request can be sent to, in order. */
  approvers: { employee_id: string; name: string; title: string | null }[];
  /** The Accounts head: the last level of every request. */
  final_approver: { employee_id: string; name: string; title: string } | null;
}

export function useFormOptions(enabled = true) {
  return useQuery({
    queryKey: approvalKeys.options,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('approval_form_options');
      if (error) throw error;
      return data as FormOptions;
    },
    staleTime: 5 * 60_000,
  });
}

export interface RequestInput {
  category: string;
  priority: Priority;
  title: string;
  details: string;
  amount: string;
  needed_by: string;
  department_id: string;
  site_id: string;
  project_id: string;
  note?: string;
}

/** Saves a request (new or edited); submit sends it for approval. Returns its id. */
export async function saveRequest(input: RequestInput, id: string | null, submit: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('approval_save', { p_request: input, p_id: id, p_submit: submit });
  if (error) throw error;
  return data as string;
}

/** The approvers of a not-yet-submitted request, in order. */
export async function setApprovers(id: string, approvers: string[]) {
  const { error } = await supabase.rpc('approval_set_approvers', { p_request: id, p_approvers: approvers });
  if (error) throw error;
}

export async function actOnStep(stepId: string, action: 'approve' | 'reject' | 'return', comment: string) {
  const { data, error } = await supabase.rpc('approval_act', { p_step: stepId, p_action: action, p_comment: comment.trim() || null });
  if (error) throw error;
  return data as RequestStatus;
}

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw error;
};
export const cancelRequest = (id: string, reason: string) => rpc('approval_cancel', { p_id: id, p_reason: reason.trim() || null });
export const reopenRequest = (id: string, reason: string) => rpc('approval_reopen', { p_id: id, p_reason: reason });
export const completeRequest = (id: string, note: string) => rpc('approval_complete', { p_id: id, p_note: note.trim() || null });
export const addComment = (id: string, body: string) => rpc('approval_add_comment', { p_request: id, p_body: body });
export const deleteDocument = (docId: string, reason: string) => rpc('approval_delete_document', { p_document: docId, p_reason: reason.trim() || null });
export const reassignStep = (stepId: string, target: { employee?: string | null; role?: string | null }, reason: string) =>
  rpc('approval_reassign', { p_step: stepId, p_employee: target.employee ?? null, p_role: target.role ?? null, p_reason: reason.trim() || null });

// ------------------------------------------------------------- documents
export function checkFile(file: File): string | null {
  if (!ALLOWED_FILES.test(file.name)) return `${file.name}: only PDF, Word, Excel, JPG and PNG files can be attached.`;
  if (file.size > MAX_FILE) return `${file.name} is larger than 25 MB.`;
  return null;
}

/** Uploads a file to the request's folder and records it (a new document, or a new version of one). */
export async function uploadApprovalFile(requestId: string, file: File, opts: { documentId?: string; note?: string } = {}) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const safe = file.name.replace(/[^\w.\-() ]+/g, '_').slice(-120);
  const path = `approvals/${requestId}/${crypto.randomUUID()}-${safe}`;
  const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc('approval_add_document', {
    p_request: requestId,
    p_file: { file_name: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size, note: opts.note ?? null },
    p_document: opts.documentId ?? null,
  });
  if (error) {
    await supabase.storage.from('documents').remove([path]); // keep storage and the record in step
    throw error;
  }
}

export async function fileUrl(v: DocVersion, download: boolean) {
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(v.storage_path, 300, download ? { download: v.file_name } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export const isImage = (name: string) => /\.(jpe?g|png)$/i.test(name);
export const isPdf = (name: string) => /\.pdf$/i.test(name);

export function fmtSize(bytes: number | null | undefined) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ------------------------------------------------------------- settings
export interface WorkflowLevel {
  id?: string;
  level_no?: number;
  name: string;
  approver_type: 'employee' | 'department_head' | 'role';
  approver_employee_id: string | null;
  approver_role_id: string | null;
  approver?: string;
}

export interface Workflow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  levels: WorkflowLevel[];
}

export interface ApprovalSettings {
  workflows: Workflow[];
  employees: { id: string; name: string; code: string | null; department: string | null; has_login: boolean }[];
  roles: { id: string; name: string; key: string; members: number }[];
  departments: { id: string; name: string; head_employee_id: string | null; head: string | null }[];
}

export function useApprovalSettings(enabled = true) {
  return useQuery({
    queryKey: approvalKeys.settings,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('approval_settings');
      if (error) throw error;
      return data as ApprovalSettings;
    },
  });
}

export async function saveWorkflow(w: { id?: string; name: string; category: string | null; description: string; is_active: boolean; levels: WorkflowLevel[] }) {
  const { data, error } = await supabase.rpc('approval_save_workflow', { p: w });
  if (error) throw error;
  return data as string;
}

export const setDepartmentHead = (departmentId: string, employeeId: string | null) =>
  rpc('approval_set_department_head', { p_department: departmentId, p_employee: employeeId });
