// Approvals: requests employees make to the company, and the approver's
// decision. Everything goes through the database functions, which decide
// who sees and does what.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BadgeTone } from '@/lib/types';

export type ApprovalStatus = 'pending' | 'needs_info' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalView = 'mine' | 'to_approve' | 'all';

export interface ApprovalRequest {
  id: string;
  request_no: string;
  category: string;
  title: string;
  details: string | null;
  amount: number | null;
  needed_by: string | null;
  priority: 'normal' | 'urgent';
  status: ApprovalStatus;
  decision_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
  requested_by: string;
  requester_id: string;
  employee_code: string | null;
  department: string | null;
  site: string | null;
  created_at: string;
  updated_at: string;
  mine: boolean;
  can_decide: boolean;
  can_edit: boolean;
  attachments: number;
  events: { action: string; note: string | null; at: string; by: string | null }[];
}

export interface ApprovalList {
  approver: boolean;
  waiting: number;
  rows: ApprovalRequest[];
}

export const CATEGORIES: Record<string, string> = {
  purchase: 'Purchase',
  payment: 'Payment / reimbursement',
  advance: 'Advance',
  travel: 'Travel',
  leave: 'Leave / time off',
  equipment: 'IT / equipment',
  other: 'Other',
};

export const STATUS: Record<ApprovalStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  needs_info: { label: 'More info needed', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export const EVENT_LABEL: Record<string, string> = {
  submitted: 'Requested',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_info: 'Sent back for more info',
  cancelled: 'Cancelled',
};

export const approvalKeys = { all: ['approvals'] as const };

export function useApprovals(view: ApprovalView, status: string | null, search: string) {
  return useQuery({
    queryKey: ['approvals', view, status ?? '', search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_approvals', {
        p_view: view, p_status: status, p_search: search.trim() || null, p_limit: 200,
      });
      if (error) throw error;
      return data as ApprovalList;
    },
  });
}

export interface RequestInput {
  category: string;
  title: string;
  details: string;
  amount: string;
  needed_by: string;
  priority: 'normal' | 'urgent';
  note?: string;
}

export async function saveRequest(input: RequestInput, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_approval_request', {
    p_request: { ...input, amount: input.amount.replace(/[,\s₹]/g, '') },
    p_id: id ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function decide(id: string, decision: 'approved' | 'rejected' | 'needs_info', note: string) {
  const { error } = await supabase.rpc('decide_approval', { p_id: id, p_decision: decision, p_note: note.trim() || null });
  if (error) throw error;
}

export async function cancelRequest(id: string) {
  const { error } = await supabase.rpc('cancel_approval', { p_id: id });
  if (error) throw error;
}
