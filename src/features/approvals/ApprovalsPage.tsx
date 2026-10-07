// Approvals dashboard: the counts, then every request the user may see --
// all of them, the ones waiting for their approval, or their own -- with
// search, filters, sorting and pages. A row opens the request.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, CheckCircle2, ClipboardList, Download, FilterX, Hourglass,
  Plus, RotateCcw, Settings2, UserCheck, XCircle,
} from 'lucide-react';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtINR, todayIST } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { cn } from '@/lib/utils';
import { useCan } from '@/auth/AccessProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput, StatCard, TableSkeleton } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { RequestForm } from '@/features/approvals/RequestForm';
import {
  CATEGORIES, PRIORITIES, STATUS, categoryLabel, useApprovals, type ApprovalRow, type ApprovalTab, type ListParams,
} from '@/features/approvals/api';

const ALL = '__all__';
const PAGE_SIZE = 20;

type Filters = Required<Pick<ListParams, 'status' | 'category' | 'priority' | 'department_id' | 'requester_id' | 'approver_id' | 'from' | 'to'>>;
const NO_FILTERS: Filters = { status: '', category: '', priority: '', department_id: '', requester_id: '', approver_id: '', from: '', to: '' };

export function ApprovalsPage() {
  const can = useCan('approvals');
  const navigate = useNavigate();
  const [tab, setTab] = useState<ApprovalTab | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'updated_at', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  // Start where the work is: approvers on what waits for them.
  const probe = useApprovals({ tab: 'my_approvals', page_size: 5 });
  const counts = probe.data?.counts;
  const current: ApprovalTab = tab ?? (counts?.my_approvals ? 'my_approvals' : counts && !probe.data?.is_admin && counts.total === counts.my_requests ? 'my_requests' : 'all');
  const params: ListParams = { tab: current, search: search.trim(), ...filters, sort: sort.key, dir: sort.dir, page: page + 1, page_size: PAGE_SIZE };
  const list = useApprovals(params);
  const data = list.data;
  const isAdmin = data?.is_admin ?? probe.data?.is_admin ?? false;
  const rows = data?.rows ?? [];
  const filtered = Object.values(filters).some(Boolean) || Boolean(search.trim());

  const setFilter = (k: keyof Filters, v: string) => { setFilters((f) => ({ ...f, [k]: v === ALL ? '' : v })); setPage(0); };
  const sortBy = (key: string) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' || key === 'request_no' ? 'asc' : 'desc' }));
    setPage(0);
  };
  const card = (patch: Partial<Filters>, t: ApprovalTab = 'all') => { setTab(t); setFilters({ ...NO_FILTERS, ...patch }); setPage(0); };

  async function onExport() {
    try {
      await exportXlsx('approvals', `approvals-${todayIST()}`, rows, [
        { header: 'Request ID', value: (r) => r.request_no, width: 11 },
        { header: 'Title', value: (r) => r.title, width: 40 },
        { header: 'Type', value: (r) => categoryLabel(r.category), width: 14 },
        { header: 'Requester', value: (r) => r.requester, width: 22 },
        { header: 'Department', value: (r) => r.department ?? '', width: 20 },
        { header: 'Amount (₹)', value: (r) => (r.amount == null ? '' : Number(r.amount)), numFmt: '#,##0.00', width: 13 },
        { header: 'Priority', value: (r) => PRIORITIES[r.priority]?.label ?? r.priority, width: 9 },
        { header: 'Current level', value: (r) => levelText(r), width: 22 },
        { header: 'Current approver', value: (r) => r.current_approver ?? '', width: 22 },
        { header: 'Status', value: (r) => STATUS[r.status]?.label ?? r.status, width: 20 },
        { header: 'Created', value: (r) => fmtDate(r.created_at), width: 12 },
        { header: 'Last updated', value: (r) => fmtDate(r.updated_at), width: 12 },
      ], { sheet: 'Approvals', title: ['APPROVAL REQUESTS', fmtDate(todayIST())] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const statOpts = (key: keyof NonNullable<typeof counts>) => ({ value: counts?.[key] ?? 0, loading: probe.isLoading });

  return (
    <>
      <PageHeader
        icon={BadgeCheck}
        title="Approvals"
        description="Purchase, payment, travel, leave and other requests, approved level by level."
        actions={
          <>
            {isAdmin && (
              <Button variant="outline" asChild><Link to="/approvals/workflows"><Settings2 /> Workflow settings</Link></Button>
            )}
            {can.export && (
              <Button variant="outline" onClick={() => void onExport()} disabled={!rows.length}><Download /> Export</Button>
            )}
            {can.create && <Button onClick={() => setCreating(true)}><Plus /> New request</Button>}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-7">
        <CardButton onClick={() => card({})}><StatCard label="Total requests" icon={ClipboardList} tone="slate" {...statOpts('total')} /></CardButton>
        <CardButton onClick={() => card({ status: 'open' })}><StatCard label="Pending" icon={Hourglass} tone="amber" {...statOpts('pending')} /></CardButton>
        <CardButton onClick={() => card({}, 'my_approvals')}><StatCard label="My approvals" icon={UserCheck} tone="orange" {...statOpts('my_approvals')} /></CardButton>
        <CardButton onClick={() => card({ status: 'approved' })}><StatCard label="Approved" icon={CheckCircle2} tone="green" {...statOpts('approved')} /></CardButton>
        <CardButton onClick={() => card({ status: 'rejected' })}><StatCard label="Rejected" icon={XCircle} tone="red" {...statOpts('rejected')} /></CardButton>
        <CardButton onClick={() => card({ status: 'returned' })}><StatCard label="Returned" icon={RotateCcw} tone="blue" {...statOpts('returned')} /></CardButton>
        <CardButton onClick={() => card({ priority: 'urgent', status: 'open' })}><StatCard label="Urgent" icon={AlertTriangle} tone="red" {...statOpts('urgent')} /></CardButton>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={current} onValueChange={(v) => { setTab(v as ApprovalTab); setPage(0); }}>
              <TabsList>
                <TabsTrigger value="all">All requests</TabsTrigger>
                <TabsTrigger value="my_approvals">My approvals{counts?.my_approvals ? ` (${counts.my_approvals})` : ''}</TabsTrigger>
                <TabsTrigger value="my_requests">My requests</TabsTrigger>
              </TabsList>
            </Tabs>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Search ID, title, requester…" />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <FilterSelect value={filters.status || ALL} onChange={(v) => setFilter('status', v)}
              options={[[ALL, 'Any status'], ['open', 'Open (any pending)'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label] as [string, string])]} />
            <FilterSelect value={filters.category || ALL} onChange={(v) => setFilter('category', v)}
              options={[[ALL, 'Any type'], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v] as [string, string])]} />
            <FilterSelect value={filters.priority || ALL} onChange={(v) => setFilter('priority', v)}
              options={[[ALL, 'Any priority'], ...Object.entries(PRIORITIES).map(([k, v]) => [k, v.label] as [string, string])]} />
            <FilterSelect value={filters.department_id || ALL} onChange={(v) => setFilter('department_id', v)}
              options={[[ALL, 'Any department'], ...(data?.options.departments ?? []).map((d) => [d.id, d.name] as [string, string])]} />
            <FilterSelect value={filters.requester_id || ALL} onChange={(v) => setFilter('requester_id', v)}
              options={[[ALL, 'Any requester'], ...sortByName(data?.options.requesters).map((d) => [d.id, d.name] as [string, string])]} />
            <FilterSelect value={filters.approver_id || ALL} onChange={(v) => setFilter('approver_id', v)}
              options={[[ALL, 'Any approver'], ...sortByName(data?.options.approvers).map((d) => [d.id, d.name] as [string, string])]} />
            <Input type="date" aria-label="Created from" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            <div className="flex gap-2">
              <Input type="date" aria-label="Created to" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
              {filtered && (
                <Button variant="ghost" size="icon" aria-label="Clear filters" title="Clear filters"
                  onClick={() => { setFilters(NO_FILTERS); setSearch(''); setPage(0); }}><FilterX /></Button>
              )}
            </div>
          </div>
        </div>

        {list.isLoading ? (
          <TableSkeleton cols={6} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={BadgeCheck}
            title={filtered ? 'No requests match' : current === 'my_approvals' ? 'Nothing waiting for your approval' : current === 'my_requests' ? 'You have not raised a request yet' : 'No requests yet'}
            description={filtered ? 'Try other filters.' : current !== 'my_approvals' && can.create ? 'Use “New request” to ask for a purchase, a payment, travel or leave.' : undefined}
            action={!filtered && current !== 'my_approvals' && can.create ? <Button onClick={() => setCreating(true)}><Plus /> New request</Button> : undefined}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="request_no" sort={sort} onSort={sortBy}>Request ID</SortHead>
                  <SortHead k="title" sort={sort} onSort={sortBy}>Title</SortHead>
                  <SortHead k="category" sort={sort} onSort={sortBy}>Type</SortHead>
                  <SortHead k="requester" sort={sort} onSort={sortBy}>Requester</SortHead>
                  <SortHead k="department" sort={sort} onSort={sortBy}>Department</SortHead>
                  <SortHead k="amount" sort={sort} onSort={sortBy} className="text-right">Amount</SortHead>
                  <SortHead k="priority" sort={sort} onSort={sortBy}>Priority</SortHead>
                  <SortHead k="current_level" sort={sort} onSort={sortBy}>Current level</SortHead>
                  <SortHead k="approver" sort={sort} onSort={sortBy}>Current approver</SortHead>
                  <SortHead k="status" sort={sort} onSort={sortBy}>Status</SortHead>
                  <SortHead k="created_at" sort={sort} onSort={sortBy}>Created</SortHead>
                  <SortHead k="updated_at" sort={sort} onSort={sortBy}>Last updated</SortHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/approvals/${r.id}`)}>
                    <TableCell className="tabular whitespace-nowrap font-medium">{r.request_no}</TableCell>
                    <TableCell className="min-w-48 max-w-72"><div className="truncate font-medium" title={r.title}>{r.title}</div></TableCell>
                    <TableCell className="whitespace-nowrap">{categoryLabel(r.category)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.requester}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.department ?? '—'}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">{r.amount == null ? '—' : fmtINR(r.amount)}</TableCell>
                    <TableCell><Badge variant={PRIORITIES[r.priority]?.tone ?? 'secondary'}>{PRIORITIES[r.priority]?.label ?? r.priority}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{levelText(r)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.current_approver ?? (r.current_level_name && ['submitted', 'pending', 'in_review'].includes(r.status) ? <span className="text-amber-700">Not assigned</span> : '—')}</TableCell>
                    <TableCell><Badge variant={STATUS[r.status]?.tone ?? 'secondary'}>{STATUS[r.status]?.label ?? r.status}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={r.my_turn ? 'default' : 'outline'} asChild onClick={(e) => e.stopPropagation()}>
                        <Link to={`/approvals/${r.id}`}>{r.my_turn ? 'Review' : 'View'}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      <RequestForm open={creating} request={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/approvals/${id}`)} />
    </>
  );
}

function levelText(r: ApprovalRow) {
  if (!r.total_levels) return '—';
  if (r.status === 'approved' || r.status === 'completed') return `All ${r.total_levels} approved`;
  if (!r.current_level) return `— of ${r.total_levels}`;
  const at = `L${r.current_level} of ${r.total_levels}${r.current_level_name ? ` · ${r.current_level_name}` : ''}`;
  if (r.status === 'rejected') return `Rejected at ${at}`;
  if (r.status === 'returned') return `Returned at ${at}`;
  if (r.status === 'cancelled') return `Stopped at ${at}`;
  return at;
}

const sortByName = (rows: { id: string; name: string }[] | undefined) => [...(rows ?? [])].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

function CardButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary [&>div]:h-full">
      {children}
    </button>
  );
}

function SortHead({ k, sort, onSort, children, className }: {
  k: string; sort: { key: string; dir: 'asc' | 'desc' }; onSort: (k: string) => void; children: React.ReactNode; className?: string;
}) {
  const active = sort.key === k;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 uppercase hover:text-foreground', active && 'text-foreground')}>
        {children}
        {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );
}
