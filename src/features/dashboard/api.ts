import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Shape returned by get_dashboard_summary(). A section is present only when
 * the user may view the underlying module; counts are already limited to the
 * user's sites by RLS. Later phases add crm / projects / om / hr / daily.
 */
export interface DashboardSummary {
  sites?: { total: number; active: number; capacity_kwp: number };
  users?: { total: number; active: number; invited: number; inactive: number };
  roles?: { total: number; custom: number };
  audit?: { today: number; logins_today: number };
  employees?: { total: number; active: number };
  leads?: { total: number; open: number; value: number; new: number; contacted: number; interested: number; quoted: number; converted: number; lost: number };
  tenders?: {
    total: number; live: number; submitted: number; won: number; lost: number;
    closing_7_days: number; overdue: number; pipeline_value: number; won_value: number;
    emd_blocked: number; emd_refund_due: number;
  };
  quotations?: { total: number; draft: number; sent: number; pending_approval: number; approved: number; value: number };
  followups?: { open: number; today: number; overdue: number };
  generation?: { today: number; yesterday: number; month: number; year: number; has_data: boolean; last_date: string | null };
  tickets?: { open: number; critical: number; unassigned: number; resolved_today: number };
  maintenance?: { pending: number; overdue: number };
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_dashboard_summary');
      if (error) throw error;
      return (data ?? {}) as DashboardSummary;
    },
    refetchInterval: 2 * 60_000,
  });
}
