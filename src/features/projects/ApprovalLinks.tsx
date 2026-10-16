// Projects and the Approvals section, connected. A project approval
// (DISCOM, CEIG...) or a vendor bill can be sent for internal approval as an
// ordinary approval request, linked back to the item; the project pages show
// that request's number and live status, and each project lists every
// approval request raised for it.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Plus, Send } from 'lucide-react';
import { fmtDate, fmtINR } from '@/lib/format';
import { useCan } from '@/auth/AccessProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/common';
import { RequestForm } from '@/features/approvals/RequestForm';
import {
  STATUS, categoryLabel, useProjectApprovalRequests,
  type ApprovalSource, type ProjectApprovalRequest, type RequestInput,
} from '@/features/approvals/api';

/** Requests still being decided: a new one for the same item is not offered while one is open. */
const OPEN = new Set(['draft', 'submitted', 'pending', 'in_review', 'returned']);

/** The approval requests for a project page: one project, or all of them. */
export function useProjectLinks(projectId: string | null) {
  const q = useProjectApprovalRequests(projectId);
  const rows = q.data ?? [];
  return {
    rows,
    /** The newest request linked to this item, if any. */
    forSource: (type: ApprovalSource['type'], id: string) => rows.find((r) => r.source_type === type && r.source_id === id) ?? null,
  };
}

export interface RequestDraft {
  source?: ApprovalSource;
  prefill: Partial<RequestInput>;
  context: string;
}

/** Opens the approval request form, filled in from a project item, and goes to the request once saved. */
export function useRequestFromProject() {
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canRequest = useCan('approvals').create;
  const dialog = (
    <RequestForm
      open={Boolean(draft)}
      request={null}
      prefill={draft?.prefill}
      source={draft?.source}
      context={draft?.context}
      onClose={() => setDraft(null)}
      onSaved={(id) => {
        void qc.invalidateQueries({ queryKey: ['approvals'] });
        navigate(`/approvals/${id}`);
      }}
    />
  );
  return { canRequest, open: setDraft, dialog };
}

/** The "Internal approval" cell: the linked request and its status, or a button to raise one. */
export function LinkedApproval({ link, canRequest, onRequest }: {
  link: ProjectApprovalRequest | null;
  canRequest: boolean;
  onRequest: () => void;
}) {
  if (link) {
    const st = STATUS[link.status];
    return (
      <Link to={`/approvals/${link.id}`} className="group inline-flex flex-col items-start gap-0.5" title="Open in Approvals">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-xs font-semibold text-primary group-hover:underline">{link.request_no}</span>
          <Badge variant={st?.tone}>{st?.label ?? link.status}</Badge>
        </span>
        {link.current_approver && OPEN.has(link.status) && (
          <span className="text-[11px] text-muted-foreground">with {link.current_approver}</span>
        )}
      </Link>
    );
  }
  if (!canRequest) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRequest}>
      <Send className="h-3.5 w-3.5" /> Request approval
    </Button>
  );
}

/** Whether an item's linked request is still being decided (manual steps then wait for it). */
export const isOpenRequest = (link: ProjectApprovalRequest | null) => Boolean(link && OPEN.has(link.status));

/** A project's "Approval requests" tab: everything raised for it in the Approvals section. */
export function ProjectRequestsTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { rows } = useProjectLinks(projectId);
  const req = useRequestFromProject();
  const sourceLabel = (r: ProjectApprovalRequest) =>
    r.source_type === 'vendor_bill' ? 'Vendor bill' : r.source_type === 'project_approval' ? 'Project approval' : 'Project';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Approval requests</CardTitle>
          <CardDescription>Everything raised for this project in the Approvals section, with its live status</CardDescription>
        </div>
        {req.canRequest && (
          <Button size="sm" onClick={() => req.open({ prefill: { category: 'project', project_id: projectId }, context: projectName })}>
            <Plus /> New request
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!rows.length ? (
          <EmptyState icon={BadgeCheck} title="No approval requests yet"
            description="Raise one here, or use “Request approval” on a project approval or vendor bill." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>About</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Raised</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/approvals/${r.id}`} className="font-medium text-primary hover:underline">{r.request_no}</Link>
                    <div className="max-w-[18rem] truncate text-xs text-muted-foreground" title={r.title}>{r.title}</div>
                  </TableCell>
                  <TableCell className="text-sm">{categoryLabel(r.category)}</TableCell>
                  <TableCell className="text-sm">{sourceLabel(r)}</TableCell>
                  <TableCell className="tabular text-right">{r.amount == null ? '—' : fmtINR(r.amount, true)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    {r.current_approver && OPEN.has(r.status) && <div className="text-[11px] text-muted-foreground">with {r.current_approver}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {fmtDate(r.created_at)}
                    {r.requester && <div className="text-[11px]">{r.requester}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {req.dialog}
    </Card>
  );
}
