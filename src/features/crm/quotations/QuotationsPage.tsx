import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Download, FileText, IndianRupee, Plus } from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { exportCsv } from '@/lib/export';
import { fmtDate, fmtINR, safeNum } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useDashboardSummary } from '@/features/dashboard/api';
import { fetchQuotations, useQuotations, type QuotationFilters } from '@/features/crm/api';
import { QUOTATION_STATUS, StatusChip } from '@/features/crm/shared';

const PAGE_SIZE = 20;

export function QuotationsPage() {
  const can = useCan('crm.quotations');
  const navigate = useNavigate();
  const summary = useDashboardSummary();
  const [filters, setFilters] = useState<QuotationFilters>({ search: '', status: 'all', page: 0, pageSize: PAGE_SIZE });
  const quotations = useQuotations(filters);
  const q = summary.data?.quotations;

  async function onExport() {
    try {
      const { rows } = await fetchQuotations(filters, true);
      await exportCsv('crm.quotations', `quotations-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Quotation No', value: (r) => r.quotation_no },
        { header: 'Date', value: (r) => r.quote_date },
        { header: 'Client', value: (r) => r.client_name },
        { header: 'Tender', value: (r) => r.tenders?.tender_code },
        { header: 'Subject', value: (r) => r.subject },
        { header: 'Subtotal', value: (r) => safeNum(r.subtotal) },
        { header: 'GST', value: (r) => safeNum(r.tax_total) },
        { header: 'Total', value: (r) => safeNum(r.grand_total) },
        { header: 'Status', value: (r) => QUOTATION_STATUS[r.status].label },
        { header: 'Valid until', value: (r) => r.valid_until },
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        icon={FileText}
        title="Quotations"
        description="Priced offers for tenders and direct enquiries, with GST and approval."
        actions={
          <>
            {can.export && (
              <Button variant="outline" onClick={onExport}>
                <Download /> Export
              </Button>
            )}
            {can.create && (
              <Button onClick={() => navigate('/crm/quotations/new')}>
                <Plus /> New quotation
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Quotations" value={safeNum(q?.total)} icon={FileText} loading={summary.isLoading} />
        <StatCard label="Drafts" value={safeNum(q?.draft)} icon={FileText} tone="slate" loading={summary.isLoading} />
        <StatCard label="Sent / discussing" value={safeNum(q?.sent)} icon={FileText} tone="blue" loading={summary.isLoading} />
        <StatCard label="Open value" value={fmtINR(q?.value, true)} icon={IndianRupee} tone="green" loading={summary.isLoading} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput
            value={filters.search}
            onChange={(v) => setFilters((f) => ({ ...f, page: 0, search: v }))}
            placeholder="Search number, client, subject…"
          />
          <div className="w-full sm:w-56">
            <FilterSelect
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, page: 0, status: v }))}
              options={[['all', 'All statuses'], ...Object.entries(QUOTATION_STATUS).map(([k, v]) => [k, v.label] as [string, string])]}
            />
          </div>
        </div>

        {quotations.isLoading ? (
          <TableSkeleton cols={5} />
        ) : quotations.error ? (
          <ErrorState message={errorMessage(quotations.error)} onRetry={() => quotations.refetch()} />
        ) : !quotations.data?.rows.length ? (
          <EmptyState icon={FileText} title="No quotations yet" description={can.create ? 'Create the first priced offer.' : undefined} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quotation</TableHead>
                <TableHead className="hidden md:table-cell">For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Valid until</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotations.data.rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/crm/quotations/${row.id}`)}>
                  <TableCell>
                    <Link to={`/crm/quotations/${row.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                      {row.quotation_no}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(row.quote_date)}
                      {row.subject ? ` · ${row.subject}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm">{row.client_name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.tenders ? `${row.tenders.tender_code} · ${row.tenders.title}` : row.leads ? `${row.leads.lead_code} · ${row.leads.company ?? row.leads.contact_person}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">
                    <div className="font-medium">{fmtINR(row.grand_total)}</div>
                    <div className="text-xs text-muted-foreground">incl. GST {fmtINR(row.tax_total, true)}</div>
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{row.valid_until ? fmtDate(row.valid_until) : '—'}</TableCell>
                  <TableCell>
                    <StatusChip map={QUOTATION_STATUS} value={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={filters.page} pageSize={PAGE_SIZE} total={quotations.data?.total ?? 0} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </Card>
    </>
  );
}
