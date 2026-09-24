import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, Download, PhoneCall } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDateTime, safeNum, titleCase } from '@/lib/format';
import type { FollowUp } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople } from '@/features/admin/api';
import { useDashboardSummary } from '@/features/dashboard/api';
import { fetchFollowUps, useFollowUps, type FollowUpFilters } from '@/features/crm/api';
import { CompleteFollowUpDialog, Deadline, FOLLOWUP_STATUS, StatusChip } from '@/features/crm/shared';

const PAGE_SIZE = 25;

export function FollowUpsPage() {
  const can = useCan('crm.followups');
  const qc = useQueryClient();
  const people = usePeople();
  const summary = useDashboardSummary();
  const [filters, setFilters] = useState<FollowUpFilters>({
    search: '',
    status: 'scheduled',
    entity: 'all',
    assignedTo: 'all',
    due: 'all',
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const list = useFollowUps(filters);
  const [completing, setCompleting] = useState<FollowUp | null>(null);

  const update = (patch: Partial<FollowUpFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  const s = summary.data?.followups;

  async function onExport() {
    try {
      const { rows } = await fetchFollowUps(filters, true);
      await exportCsv('crm.followups', `follow-ups-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'When', value: (r) => r.follow_up_at },
        { header: 'Type', value: (r) => r.type },
        { header: 'Subject', value: (r) => r.subject },
        { header: 'Related to', value: (r) => r.tenders?.title ?? r.leads?.company ?? r.leads?.contact_person },
        { header: 'Status', value: (r) => FOLLOWUP_STATUS[r.status].label },
        { header: 'Outcome', value: (r) => r.outcome },
        { header: 'Notes', value: (r) => r.notes },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={PhoneCall}
        title="Follow-ups"
        description="Pre-bid meetings, clarifications, EMD refunds and client calls — everything that needs chasing."
        actions={
          can.export && (
            <Button variant="outline" onClick={onExport}>
              <Download /> Export
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Open follow-ups" value={safeNum(s?.open)} icon={CalendarClock} loading={summary.isLoading} />
        <StatCard label="Due today" value={safeNum(s?.today)} icon={CalendarCheck} tone="blue" loading={summary.isLoading} />
        <StatCard label="Overdue" value={safeNum(s?.overdue)} icon={AlertTriangle} tone="red" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center">
          <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Search subject or notes…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v })}
              options={[['all', 'All statuses'], ...Object.entries(FOLLOWUP_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect
              value={filters.due}
              onChange={(v) => update({ due: v as FollowUpFilters['due'] })}
              options={[
                ['all', 'Any time'],
                ['overdue', 'Overdue'],
                ['today', 'Today'],
                ['week', 'Next 7 days'],
              ]}
            />
            <FilterSelect
              value={filters.entity}
              onChange={(v) => update({ entity: v })}
              options={[
                ['all', 'Tenders & leads'],
                ['tender', 'Tenders only'],
                ['lead', 'Leads only'],
              ]}
            />
            <FilterSelect
              value={filters.assignedTo}
              onChange={(v) => update({ assignedTo: v })}
              options={[['all', 'Anyone'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
            />
          </div>
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={5} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : !list.data?.rows.length ? (
          <EmptyState icon={CalendarCheck} title="Nothing to follow up" description="Schedule follow-ups from a tender or lead." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead className="hidden md:table-cell">Related to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-sm">
                    <Deadline at={f.follow_up_at} done={f.status !== 'scheduled'} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{f.subject || titleCase(f.type)}</div>
                    <div className="text-xs text-muted-foreground">
                      {titleCase(f.type)}
                      {f.outcome ? ` · ${f.outcome}` : f.notes ? ` · ${f.notes}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">
                    {f.tenders ? (
                      <Link to={`/crm/tenders/${f.tenders.id}`} className="hover:text-primary">
                        {f.tenders.tender_code} · {f.tenders.title}
                      </Link>
                    ) : f.leads ? (
                      <span>
                        {f.leads.lead_code} · {f.leads.company ?? f.leads.contact_person}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip map={FOLLOWUP_STATUS} value={f.status} />
                    {f.completed_at && <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(f.completed_at)}</div>}
                  </TableCell>
                  <TableCell>
                    {can.edit && f.status === 'scheduled' && (
                      <Button variant="ghost" size="sm" onClick={() => setCompleting(f)}>
                        <CheckCircle2 /> Done
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <CompleteFollowUpDialog
        followUp={completing}
        onClose={() => setCompleting(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['follow-ups'] });
          void qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
        }}
      />
    </>
  );
}
