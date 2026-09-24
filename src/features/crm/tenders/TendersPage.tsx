import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, Download, Gavel, IndianRupee, Plus, Trophy, Wallet } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtCapacity, fmtDate, fmtINR, safeNum } from '@/lib/format';
import type { Tender } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople } from '@/features/admin/api';
import { useDashboardSummary } from '@/features/dashboard/api';
import { fetchTenders, useAuthorities, useTenders, type TenderFilters } from '@/features/crm/api';
import { Deadline, EMD_STATUS, StatusChip, TENDER_STATUS } from '@/features/crm/shared';
import { TenderFormDialog } from '@/features/crm/tenders/TenderFormDialog';

const PAGE_SIZE = 20;

const EMPTY_FILTERS: TenderFilters = {
  search: '',
  status: 'all',
  emd: 'all',
  authority: 'all',
  assignedTo: 'all',
  due: 'all',
  page: 0,
  pageSize: PAGE_SIZE,
};

export function TendersPage() {
  const can = useCan('crm.tenders');
  const navigate = useNavigate();
  const people = usePeople();
  const authorities = useAuthorities();
  const summary = useDashboardSummary();
  const [filters, setFilters] = useState<TenderFilters>(EMPTY_FILTERS);
  const tenders = useTenders(filters);
  const [formOpen, setFormOpen] = useState(false);

  const update = (patch: Partial<TenderFilters>) => setFilters((f) => ({ ...f, page: 0, ...patch }));
  const t = summary.data?.tenders;

  async function onExport() {
    try {
      const { rows } = await fetchTenders(filters, true);
      await exportCsv('crm.tenders', `tenders-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Code', value: (r) => r.tender_code },
        { header: 'Tender No', value: (r) => r.reference_no },
        { header: 'Title', value: (r) => r.title },
        { header: 'Authority', value: (r) => r.authority },
        { header: 'Portal', value: (r) => r.portal },
        { header: 'Scope', value: (r) => r.work_type },
        { header: 'District', value: (r) => r.district },
        { header: 'Capacity (kWp)', value: (r) => safeNum(r.capacity_kwp) },
        { header: 'Estimated Value', value: (r) => safeNum(r.estimated_value) },
        { header: 'EMD', value: (r) => safeNum(r.emd_amount) },
        { header: 'EMD Status', value: (r) => EMD_STATUS[r.emd_status].label },
        { header: 'Submission Deadline', value: (r) => r.submission_due_at },
        { header: 'Status', value: (r) => TENDER_STATUS[r.status].label },
        { header: 'Our Bid', value: (r) => r.our_bid_value },
        { header: 'Rank', value: (r) => r.our_rank },
        { header: 'L1 Value', value: (r) => r.l1_value },
        { header: 'Contract Value', value: (r) => r.contract_value },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={Gavel}
        title="Tenders"
        description="Government bids from the published notice to the award — deadlines, EMD and results in one place."
        actions={
          <>
            {can.export && (
              <Button variant="outline" onClick={onExport}>
                <Download /> Export
              </Button>
            )}
            {can.create && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus /> Add tender
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Live tenders"
          value={safeNum(t?.live)}
          hint={`${safeNum(t?.closing_7_days)} closing in 7 days`}
          icon={Gavel}
          loading={summary.isLoading}
        />
        <StatCard label="Submitted bids" value={safeNum(t?.submitted)} hint={`${safeNum(t?.won)} won`} icon={Trophy} tone="violet" loading={summary.isLoading} />
        <StatCard
          label="Pipeline value"
          value={fmtINR(t?.pipeline_value, true)}
          hint={`Won ${fmtINR(t?.won_value, true)}`}
          icon={IndianRupee}
          tone="green"
          loading={summary.isLoading}
        />
        <StatCard
          label="EMD blocked"
          value={fmtINR(t?.emd_blocked, true)}
          hint={`${safeNum(t?.emd_refund_due)} refund(s) to chase`}
          icon={Wallet}
          tone="amber"
          loading={summary.isLoading}
        />
      </div>

      {safeNum(t?.overdue) > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {safeNum(t?.overdue)} tender(s) passed their submission deadline without being submitted.
          <button className="ml-auto cursor-pointer font-medium underline" onClick={() => update({ due: 'overdue', status: 'live' })}>
            Show them
          </button>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center">
          <SearchInput value={filters.search} onChange={(v) => update({ search: v })} placeholder="Search title, authority, NIT no…" />
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <FilterSelect
              value={filters.status}
              onChange={(v) => update({ status: v })}
              options={[
                ['all', 'All statuses'],
                ['live', 'Live (not yet bid)'],
                ['in_bid', 'Submitted / in evaluation'],
                ...Object.entries(TENDER_STATUS).map(([k, v]) => [k, v.label] as [string, string]),
              ]}
            />
            <FilterSelect
              value={filters.due}
              onChange={(v) => update({ due: v as TenderFilters['due'] })}
              options={[
                ['all', 'Any deadline'],
                ['overdue', 'Deadline passed'],
                ['next7', 'Closing in 7 days'],
                ['next30', 'Closing in 30 days'],
              ]}
            />
            <FilterSelect
              value={filters.emd}
              onChange={(v) => update({ emd: v })}
              options={[['all', 'Any EMD'], ...Object.entries(EMD_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
            <FilterSelect
              value={filters.authority}
              onChange={(v) => update({ authority: v })}
              options={[['all', 'All authorities'], ...(authorities.data ?? []).map((a) => [a, a] as [string, string])]}
            />
            <FilterSelect
              value={filters.assignedTo}
              onChange={(v) => update({ assignedTo: v })}
              options={[['all', 'Anyone'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
            />
          </div>
        </div>

        {tenders.isLoading ? (
          <TableSkeleton cols={6} />
        ) : tenders.error ? (
          <ErrorState message={errorMessage(tenders.error)} onRetry={() => tenders.refetch()} />
        ) : !tenders.data?.rows.length ? (
          <EmptyState
            icon={Gavel}
            title="No tenders found"
            description={can.create ? 'Add the tenders you are tracking, or clear the filters.' : 'Nothing matches these filters.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tender</TableHead>
                <TableHead className="hidden lg:table-cell">Authority</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden md:table-cell">EMD</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenders.data.rows.map((row: Tender) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/crm/tenders/${row.id}`)}>
                  <TableCell>
                    <Link to={`/crm/tenders/${row.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {row.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {row.tender_code}
                      {row.reference_no ? ` · ${row.reference_no}` : ''}
                      {safeNum(row.capacity_kwp) ? ` · ${fmtCapacity(row.capacity_kwp)}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="text-sm">{row.authority ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{[row.district, row.portal].filter(Boolean).join(' · ')}</div>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    <div className="font-medium">{fmtINR(row.estimated_value, true)}</div>
                    {safeNum(row.contract_value) > 0 && <div className="text-xs text-green-700">Won {fmtINR(row.contract_value, true)}</div>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="tabular text-sm">{safeNum(row.emd_amount) ? fmtINR(row.emd_amount, true) : '—'}</div>
                    {safeNum(row.emd_amount) > 0 && <StatusChip map={EMD_STATUS} value={row.emd_status} />}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Deadline at={row.submission_due_at} done={!['identified', 'evaluating', 'preparing'].includes(row.status)} />
                    {row.prebid_at && <div className="text-xs text-muted-foreground">Pre-bid {fmtDate(row.prebid_at)}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusChip map={TENDER_STATUS} value={row.status} />
                      {row.our_rank ? <Badge variant="outline">L{row.our_rank}</Badge> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={tenders.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>

      <TenderFormDialog open={formOpen} onOpenChange={setFormOpen} tender={null} onSaved={(id) => navigate(`/crm/tenders/${id}`)} />
    </>
  );
}
