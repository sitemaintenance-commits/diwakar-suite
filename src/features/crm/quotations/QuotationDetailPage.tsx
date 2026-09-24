import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, Pencil, Printer, Send, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtDate, fmtDateTime, fmtINR, fmtNumber, safeNum } from '@/lib/format';
import type { QuotationStatus } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { ConfirmDialog, ErrorState } from '@/components/common';
import { BrandMark } from '@/components/common/Brand';
import { useQuotation } from '@/features/crm/api';
import { QUOTATION_STATUS, StatusChip } from '@/features/crm/shared';

export function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useCan('crm.quotations');
  const { access, setting } = useAccess();
  const { data: q, isLoading, error, refetch } = useQuotation(id);
  const [deleting, setDeleting] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (error || !q) {
    return (
      <Card>
        <ErrorState message={error ? errorMessage(error) : 'This quotation does not exist or you do not have access to it.'} onRetry={() => refetch()} />
      </Card>
    );
  }

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['quotation'] });
    await qc.invalidateQueries({ queryKey: ['quotations'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  async function setStatus(status: QuotationStatus) {
    const { error } = await supabase.from('quotations').update({ status }).eq('id', q!.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`Marked as ${QUOTATION_STATUS[status].label.toLowerCase()}`);
    await refresh();
  }

  async function remove() {
    const { error } = await supabase.rpc('soft_delete_record', { p_table: 'quotations', p_id: q!.id });
    if (error) return toast.error(errorMessage(error));
    toast.success('Quotation deleted');
    await refresh();
    navigate('/crm/quotations');
  }

  const items = q.quotation_items ?? [];

  return (
    <>
      <div className="print:hidden">
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link to="/crm/quotations">
            <ArrowLeft /> All quotations
          </Link>
        </Button>

        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl">{q.quotation_no}</h1>
              <StatusChip map={QUOTATION_STATUS} value={q.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {q.client_name}
              {q.tenders ? ` · ${q.tenders.tender_code}` : ''}
              {q.approved_at ? ` · approved ${fmtDateTime(q.approved_at)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:shrink-0">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Print / PDF
            </Button>
            {can.edit && q.status === 'draft' && (
              <Button variant="outline" onClick={() => setStatus('sent')}>
                <Send /> Mark sent
              </Button>
            )}
            {can.approve && ['draft', 'sent', 'under_discussion'].includes(q.status) && (
              <>
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setStatus('rejected')}>
                  <X /> Reject
                </Button>
                <Button onClick={() => setStatus('approved')}>
                  <Check /> Approve
                </Button>
              </>
            )}
            {can.edit && (
              <Button variant="outline" asChild>
                <Link to={`/crm/quotations/${q.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            {can.delete && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        </div>
        {!can.approve && q.status === 'draft' && (
          <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Approval requires the APPROVE permission on Quotations — the database rejects it otherwise.
          </p>
        )}
      </div>

      {/* Printable document */}
      <Card className="print:border-0 print:shadow-none">
        <CardContent className="p-6 sm:p-10">
          <div className="flex items-start justify-between gap-6 border-b pb-6">
            <div className="flex items-center gap-3">
              <BrandMark className="h-12 w-12" />
              <div>
                <div className="text-lg font-bold">{setting('brand_name', 'Diwakar Solar')}</div>
                <div className="text-sm text-muted-foreground">{setting('company_name', 'Diwakar Renewable & Infra Pvt. Ltd.')}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">QUOTATION</div>
              <div className="tabular text-sm">{q.quotation_no}</div>
              <div className="text-sm text-muted-foreground">{fmtDate(q.quote_date)}</div>
              {q.valid_until && <div className="text-xs text-muted-foreground">Valid until {fmtDate(q.valid_until)}</div>}
            </div>
          </div>

          <div className="grid gap-6 py-6 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">To</div>
              <div className="mt-1 font-semibold">{q.client_name}</div>
              {q.client_address && <div className="whitespace-pre-wrap text-sm text-muted-foreground">{q.client_address}</div>}
            </div>
            <div className="sm:text-right">
              {q.subject && (
                <>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Subject</div>
                  <div className="mt-1 text-sm font-medium">{q.subject}</div>
                </>
              )}
              {q.tenders && <div className="mt-2 text-xs text-muted-foreground">Ref: {q.tenders.tender_code} · {q.tenders.title}</div>}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-y bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-2 py-2 text-left font-semibold">#</th>
                  <th className="px-2 py-2 text-left font-semibold">Description</th>
                  <th className="px-2 py-2 text-left font-semibold">HSN</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 text-right font-semibold">Rate</th>
                  <th className="px-2 py-2 text-right font-semibold">GST</th>
                  <th className="px-2 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-2">{it.description}</td>
                    <td className="px-2 py-2 text-muted-foreground">{it.hsn_sac ?? '—'}</td>
                    <td className="tabular px-2 py-2 text-right">
                      {fmtNumber(it.quantity, 2)} {it.unit}
                    </td>
                    <td className="tabular px-2 py-2 text-right">{fmtINR(it.rate)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtNumber(it.tax_rate)}%</td>
                    <td className="tabular px-2 py-2 text-right font-medium">{fmtINR(safeNum(it.quantity) * safeNum(it.rate))}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                      No line items.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <dl className="tabular w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{fmtINR(q.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">GST</dt>
                <dd>{fmtINR(q.tax_total)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-bold">
                <dt>Grand total</dt>
                <dd>{fmtINR(q.grand_total)}</dd>
              </div>
            </dl>
          </div>

          {q.terms && (
            <div className="mt-8 border-t pt-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Terms &amp; conditions</div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{q.terms}</p>
            </div>
          )}

          <div className="mt-10 flex items-end justify-between gap-6 text-sm">
            <div className="text-xs text-muted-foreground">
              {q.status === 'approved' && q.approved_at ? `Approved on ${fmtDate(q.approved_at)}` : 'Subject to approval.'}
            </div>
            <div className="text-center">
              <div className="h-12" />
              <div className="border-t px-8 pt-1 text-xs text-muted-foreground">
                For {setting('brand_name', 'Diwakar Solar')}
                {access?.profile?.full_name ? ` · ${access.profile.full_name}` : ''}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${q.quotation_no}?`}
        description="The quotation and its line items are removed from the lists. The history stays in the audit log."
        confirmLabel="Delete quotation"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}
