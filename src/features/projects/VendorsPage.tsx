// Vendors — the vendor master behind materials and vendor bills.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Handshake, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtNumber } from '@/lib/format';
import { exportCsv } from '@/lib/export';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, Field, PageHeader, SearchInput, StatCard } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useVendors } from '@/features/projects/api';

const STATUS: [string, string][] = [
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['blacklisted', 'Blacklisted'],
];
const TONE: Record<string, 'success' | 'secondary' | 'destructive'> = {
  active: 'success',
  inactive: 'secondary',
  blacklisted: 'destructive',
};

const CATEGORIES = [
  'Installation vendor', 'Modules', 'Inverters', 'Structure', 'Cables & BOS',
  'Civil works', 'Transformer & HT', 'Transport', 'Manpower', 'Other',
];

const BLANK = {
  name: '', category: CATEGORIES[0], gst_no: '', contact_person: '', phone: '',
  email: '', payment_terms: 'Milestone based', status: 'active', notes: '',
};

export function VendorsPage() {
  const can = useCan('projects.vendors');
  const qc = useQueryClient();
  const vendors = useVendors();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (vendors.data ?? []).filter(
      (v) =>
        (status === 'all' || v.status === status) &&
        (!q || `${v.name} ${v.category ?? ''} ${v.phone ?? ''} ${v.gst_no ?? ''}`.toLowerCase().includes(q)),
    );
  }, [vendors.data, search, status]);

  async function add() {
    if (!form.name.trim()) return toast.error('The vendor name is required.');
    const { error } = await supabase.from('vendors').insert({
      name: form.name.trim(),
      category: form.category,
      gst_no: form.gst_no.trim() || null,
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      payment_terms: form.payment_terms.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    });
    if (error) return toast.error(errorMessage(error));
    setOpen(false);
    setForm({ ...BLANK });
    await qc.invalidateQueries({ queryKey: ['vendors'] });
    await qc.invalidateQueries({ queryKey: ['project-dashboard'] });
    toast.success('Vendor added.');
  }

  async function setVendorStatus(id: string, next: string) {
    const { error } = await supabase.from('vendors').update({ status: next }).eq('id', id);
    if (error) return toast.error(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['vendors'] });
  }

  async function onExport() {
    if (!rows.length) return;
    try {
      await exportCsv('projects.vendors', 'vendors', rows, [
        { header: 'Vendor', value: (r) => r.name },
        { header: 'Category', value: (r) => r.category ?? '' },
        { header: 'GST', value: (r) => r.gst_no ?? '' },
        { header: 'Contact', value: (r) => r.contact_person ?? '' },
        { header: 'Phone', value: (r) => r.phone ?? '' },
        { header: 'Email', value: (r) => r.email ?? '' },
        { header: 'Payment terms', value: (r) => r.payment_terms ?? '' },
        { header: 'Status', value: (r) => r.status },
      ]);
      toast.success('Exported.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const active = (vendors.data ?? []).filter((v) => v.status === 'active').length;

  return (
    <>
      <PageHeader
        icon={Handshake}
        title="Vendors"
        description="The vendor master used by materials and vendor bills."
        actions={
          <>
            {can.export && (
              <Button variant="outline" size="sm" onClick={onExport} disabled={!rows.length}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            )}
            {can.create && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add vendor
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Vendors" value={fmtNumber(vendors.data?.length)} icon={Handshake} />
        <StatCard label="Active" value={fmtNumber(active)} icon={Handshake} tone="green" />
        <StatCard label="Blacklisted" value={fmtNumber((vendors.data ?? []).filter((v) => v.status === 'blacklisted').length)} icon={Handshake} tone="red" />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Vendor register</CardTitle>
            <CardDescription>{fmtNumber(rows.length)} vendor(s)</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, category or GST" />
            <div className="w-40">
              <FilterSelect value={status} onChange={setStatus} options={[['all', 'All'], ...STATUS]} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {vendors.error ? (
            <ErrorState message={errorMessage(vendors.error)} onRetry={() => vendors.refetch()} />
          ) : !rows.length ? (
            <EmptyState icon={Handshake} title="No vendors" description={can.create ? 'Add the vendors you buy from.' : 'No vendors match this filter.'} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Payment terms</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.category ?? '—'}</TableCell>
                    <TableCell className="tabular text-sm">{v.gst_no ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {v.contact_person ?? '—'}
                      {v.phone && <div className="tabular text-xs text-muted-foreground">{v.phone}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{v.payment_terms ?? '—'}</TableCell>
                    <TableCell>
                      {can.edit ? (
                        <FilterSelect value={v.status} onChange={(next) => setVendorStatus(v.id, next)} options={STATUS} />
                      ) : (
                        <Badge variant={TONE[v.status]}>{STATUS.find(([k]) => k === v.status)?.[1]}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add vendor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor name" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Category">
              <FilterSelect value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => [c, c])} />
            </Field>
            <Field label="GST number">
              <Input value={form.gst_no} onChange={(e) => setForm({ ...form, gst_no: e.target.value })} />
            </Field>
            <Field label="Contact person">
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Payment terms">
              <Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add}>Add vendor</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
