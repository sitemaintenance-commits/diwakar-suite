// Create / edit a quotation with its line items. Totals shown here are a
// preview; the database recomputes them from the saved lines.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtINR, safeNum } from '@/lib/format';
import type { QuotationItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/misc';
import { Field, PageHeader } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useQuotation, useTenders } from '@/features/crm/api';

const NONE = '__none__';
const GST_RATES = ['0', '5', '12', '18', '28'];

interface Row extends Omit<QuotationItem, 'quantity' | 'rate' | 'tax_rate'> {
  key: string;
  quantity: number | string;
  rate: number | string;
  tax_rate: number | string;
}
const blankRow = (): Row => ({ key: crypto.randomUUID(), description: '', hsn_sac: '', unit: 'Nos', quantity: 1, rate: 0, tax_rate: 18 });

export function QuotationFormPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuotation(isNew ? undefined : id);
  const tenders = useTenders({ search: '', status: 'all', emd: 'all', authority: 'all', assignedTo: 'all', due: 'all', page: 0, pageSize: 100 });

  const [header, setHeader] = useState({ tender_id: '', client_name: '', client_address: '', subject: '', quote_date: '', valid_until: '', terms: '', notes: '' });
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const q = existing.data;
    if (!q) return;
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    setHeader({
      tender_id: s(q.tender_id), client_name: s(q.client_name), client_address: s(q.client_address), subject: s(q.subject),
      quote_date: s(q.quote_date), valid_until: s(q.valid_until), terms: s(q.terms), notes: s(q.notes),
    });
    const loaded: Row[] = (q.quotation_items ?? []).map((i) => ({ ...i, key: crypto.randomUUID() as string }));
    setRows(loaded.length ? loaded : [blankRow()]);
  }, [existing.data]);

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    for (const r of rows) {
      const amount = Math.round(safeNum(r.quantity) * safeNum(r.rate) * 100) / 100;
      sub += amount;
      tax += Math.round((amount * safeNum(r.tax_rate)) / 100 * 100) / 100;
    }
    return { sub, tax, total: sub + tax };
  }, [rows]);

  const clientError = !header.client_name.trim() ? 'A client name is required.' : null;
  const hasLine = rows.some((r) => r.description.trim());

  async function save() {
    setTouched(true);
    if (clientError || !hasLine) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('save_quotation', {
      p_quotation: {
        tender_id: header.tender_id || null,
        client_name: header.client_name.trim(),
        client_address: header.client_address.trim() || null,
        subject: header.subject.trim() || null,
        quote_date: header.quote_date || null,
        valid_until: header.valid_until || null,
        terms: header.terms.trim() || null,
        notes: header.notes.trim() || null,
      },
      p_items: rows
        .filter((r) => r.description.trim())
        .map((r) => ({
          description: r.description.trim(),
          hsn_sac: r.hsn_sac || null,
          unit: r.unit || 'Nos',
          quantity: safeNum(r.quantity),
          rate: safeNum(r.rate),
          tax_rate: safeNum(r.tax_rate),
        })),
      p_id: isNew ? null : id,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(isNew ? 'Quotation created' : 'Quotation saved');
    await qc.invalidateQueries({ queryKey: ['quotations'] });
    await qc.invalidateQueries({ queryKey: ['quotation'] });
    await qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    navigate(`/crm/quotations/${data ?? id}`);
  }

  if (!isNew && existing.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/crm/quotations">
          <ArrowLeft /> All quotations
        </Link>
      </Button>
      <PageHeader
        title={isNew ? 'New quotation' : `Edit ${existing.data?.quotation_no ?? ''}`}
        description="Line items, GST and totals are stored in the database; totals are recalculated there on save."
        actions={
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Save quotation
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="border-y text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                    <th className="w-24 px-2 py-2 text-left font-semibold">HSN/SAC</th>
                    <th className="w-20 px-2 py-2 text-left font-semibold">Unit</th>
                    <th className="w-24 px-2 py-2 text-right font-semibold">Qty</th>
                    <th className="w-28 px-2 py-2 text-right font-semibold">Rate</th>
                    <th className="w-24 px-2 py-2 text-right font-semibold">GST %</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-2">
                        <Input value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} placeholder="Supply of 550 Wp modules" className="h-8" />
                      </td>
                      <td className="px-2 py-2">
                        <Input value={r.hsn_sac ?? ''} onChange={(e) => setRow(r.key, { hsn_sac: e.target.value })} className="h-8" />
                      </td>
                      <td className="px-2 py-2">
                        <Input value={r.unit ?? ''} onChange={(e) => setRow(r.key, { unit: e.target.value })} className="h-8" />
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" value={String(r.quantity)} onChange={(e) => setRow(r.key, { quantity: e.target.value })} className="h-8 text-right" />
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" value={String(r.rate)} onChange={(e) => setRow(r.key, { rate: e.target.value })} className="h-8 text-right" />
                      </td>
                      <td className="px-2 py-2">
                        <FilterSelect value={String(r.tax_rate)} onChange={(v) => setRow(r.key, { tax_rate: v })} options={GST_RATES.map((g) => [g, `${g}%`] as [string, string])} />
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium">{fmtINR(safeNum(r.quantity) * safeNum(r.rate))}</td>
                      <td className="px-1 py-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          onClick={() => setRows((rs) => (rs.length === 1 ? [blankRow()] : rs.filter((x) => x.key !== r.key)))}
                          aria-label="Remove line"
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t p-3">
              <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blankRow()])}>
                <Plus /> Add line
              </Button>
              {touched && !hasLine && <span className="text-sm text-destructive">Add at least one line item.</span>}
              <dl className="tabular grid gap-1 text-sm">
                <div className="flex justify-between gap-8">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd>{fmtINR(totals.sub)}</dd>
                </div>
                <div className="flex justify-between gap-8">
                  <dt className="text-muted-foreground">GST</dt>
                  <dd>{fmtINR(totals.tax)}</dd>
                </div>
                <div className="flex justify-between gap-8 border-t pt-1 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{fmtINR(totals.total)}</dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Against tender" hint="Leave empty for a direct quotation.">
              <FilterSelect
                value={header.tender_id || NONE}
                onChange={(v) => {
                  const tender = (tenders.data?.rows ?? []).find((t) => t.id === v);
                  setHeader((h) => ({
                    ...h,
                    tender_id: v === NONE ? '' : v,
                    client_name: h.client_name || (tender?.authority ?? ''),
                    subject: h.subject || (tender?.title ?? ''),
                  }));
                }}
                options={[[NONE, '— Not linked —'], ...(tenders.data?.rows ?? []).map((t) => [t.id, `${t.tender_code} · ${t.title}`] as [string, string])]}
              />
            </Field>
            <Field label="Client / authority" htmlFor="q_client" required error={touched ? clientError : null}>
              <Input id="q_client" value={header.client_name} onChange={(e) => setHeader((h) => ({ ...h, client_name: e.target.value }))} />
            </Field>
            <Field label="Address" htmlFor="q_addr">
              <Textarea id="q_addr" rows={2} value={header.client_address} onChange={(e) => setHeader((h) => ({ ...h, client_address: e.target.value }))} />
            </Field>
            <Field label="Subject" htmlFor="q_sub">
              <Input id="q_sub" value={header.subject} onChange={(e) => setHeader((h) => ({ ...h, subject: e.target.value }))} />
            </Field>
            <Field label="Quotation date" htmlFor="q_date">
              <Input id="q_date" type="date" value={header.quote_date} onChange={(e) => setHeader((h) => ({ ...h, quote_date: e.target.value }))} />
            </Field>
            <Field label="Valid until" htmlFor="q_valid">
              <Input id="q_valid" type="date" value={header.valid_until} onChange={(e) => setHeader((h) => ({ ...h, valid_until: e.target.value }))} />
            </Field>
            <Field label="Terms & conditions" htmlFor="q_terms">
              <Textarea id="q_terms" rows={4} value={header.terms} onChange={(e) => setHeader((h) => ({ ...h, terms: e.target.value }))} placeholder="Payment terms, delivery period, warranty…" />
            </Field>
            <Field label="Internal notes" htmlFor="q_notes">
              <Textarea id="q_notes" rows={2} value={header.notes} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} />
            </Field>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
