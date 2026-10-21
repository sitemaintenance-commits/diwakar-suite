// Insurance policies in the document library. A document of type
// "Insurance" carries the policy details the Operation - Ground Mounted
// sheet tracks; the list shows them as that sheet's table, with the due
// status worked out from today, before anyone opens the PDF.
import { Download, Eye, Mail, Pencil, Trash2 } from 'lucide-react';
import { fmtDate, todayIST } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LibraryDoc } from '@/features/documents/api';

export interface InsuranceDetails {
  company_name?: string;
  project_name?: string;
  capacity?: string;
  policy_no?: string;
  start_date?: string;
  end_date?: string;
  insurer?: string;
  responsible?: string;
}

export const isInsurance = (category: string | null | undefined) => (category ?? '').trim().toLowerCase() === 'insurance';

/** "Renewal due in 55 day(s)" / "Renewal due today" / "Expired 3 day(s) ago", and Active / Renewal / Expired. */
export function insuranceStatus(end?: string | null) {
  if (!end) return { due: '—', status: '—', tone: 'secondary' as const, days: null as number | null };
  const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${todayIST()}T00:00:00`).getTime()) / 86_400_000);
  if (days < 0) return { due: `Expired ${-days} day(s) ago`, status: 'Expired', tone: 'destructive' as const, days };
  if (days === 0) return { due: 'Renewal due today', status: 'Renewal', tone: 'destructive' as const, days };
  if (days <= 30) return { due: `Renewal due in ${days} day(s)`, status: 'Renewal', tone: 'warning' as const, days };
  return { due: `Renewal due in ${days} day(s)`, status: 'Active', tone: 'success' as const, days };
}

/** The policy fields, shown in the upload form and the edit dialog when the type is Insurance. */
export function InsuranceFields({ value, onChange, sites }: {
  value: InsuranceDetails;
  onChange: (v: InsuranceDetails) => void;
  sites: { id: string; name: string }[];
}) {
  const set = (k: keyof InsuranceDetails, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 rounded-lg border border-primary/25 bg-primary-soft/40 p-3 sm:col-span-2 sm:grid-cols-2">
      <p className="text-sm font-semibold sm:col-span-2">Insurance policy</p>
      <Field label="Company name" className="sm:col-span-2">
        <Input value={value.company_name ?? ''} onChange={(e) => set('company_name', e.target.value)} placeholder="e.g. Diwakar Renewable & Infra Pvt Ltd" />
      </Field>
      <Field label="Project name">
        <Input list="insurance-projects" value={value.project_name ?? ''} onChange={(e) => set('project_name', e.target.value)} placeholder="e.g. Bassi" />
        <datalist id="insurance-projects">{sites.map((s) => <option key={s.id} value={s.name} />)}</datalist>
      </Field>
      <Field label="Project capacity">
        <Input value={value.capacity ?? ''} onChange={(e) => set('capacity', e.target.value)} placeholder="e.g. 3.41 MW" />
      </Field>
      <Field label="Policy number" className="sm:col-span-2">
        <Input value={value.policy_no ?? ''} onChange={(e) => set('policy_no', e.target.value)} />
      </Field>
      <Field label="Starting date">
        <Input type="date" value={value.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} />
      </Field>
      <Field label="Ending date" hint="Also the document's expiry, for renewal reminders">
        <Input type="date" value={value.end_date ?? ''} min={value.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} />
      </Field>
      <Field label="Issuing insurance company">
        <Input value={value.insurer ?? ''} onChange={(e) => set('insurer', e.target.value)} placeholder="e.g. ICICI Lombard" />
      </Field>
      <Field label="Responsible person">
        <Input value={value.responsible ?? ''} onChange={(e) => set('responsible', e.target.value)} placeholder="Who follows up the renewal" />
      </Field>
      {value.end_date && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Status: <span className="font-medium text-foreground">{insuranceStatus(value.end_date).status}</span> · {insuranceStatus(value.end_date).due}
        </p>
      )}
    </div>
  );
}

/** The library as the insurance sheet: one row per policy, soonest renewal first. */
export function InsuranceTable({ rows, onOpen, onDownload, onSend, onEdit, onDelete }: {
  rows: LibraryDoc[];
  onOpen: (d: LibraryDoc) => void;
  onDownload: (d: LibraryDoc) => void;
  onSend: (d: LibraryDoc) => void;
  onEdit: (d: LibraryDoc) => void;
  onDelete: (d: LibraryDoc) => void;
}) {
  const sorted = [...rows].sort((a, b) => {
    const ea = (a.details as InsuranceDetails)?.end_date ?? a.valid_until ?? '9999';
    const eb = (b.details as InsuranceDetails)?.end_date ?? b.valid_until ?? '9999';
    return ea.localeCompare(eb);
  });
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Company · project</TableHead>
            <TableHead>Capacity</TableHead>
            <TableHead>Policy number</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            <TableHead>Insurer</TableHead>
            <TableHead>Due status</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Responsible</TableHead>
            <TableHead className="text-right">File</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((d, i) => {
            const x = (d.details ?? {}) as InsuranceDetails;
            const end = x.end_date || d.valid_until;
            const st = insuranceStatus(end);
            return (
              <TableRow key={d.id} className={cn(st.status !== 'Active' && st.status !== '—' && 'bg-red-50/40')}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="min-w-[12rem]">
                  <div className="font-medium">{x.company_name || '—'}</div>
                  <div className="text-xs text-muted-foreground">{x.project_name || d.site || '—'}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{x.capacity || '—'}</TableCell>
                <TableCell className="tabular max-w-[12rem] break-all text-xs">{x.policy_no || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{x.start_date ? fmtDate(x.start_date) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{end ? fmtDate(end) : '—'}</TableCell>
                <TableCell className="max-w-[12rem]">{x.insurer || '—'}</TableCell>
                <TableCell className={cn('whitespace-nowrap', st.tone === 'destructive' && 'font-medium text-red-700', st.tone === 'warning' && 'text-amber-700')}>{st.due}</TableCell>
                <TableCell><Badge variant={st.tone}>{st.status}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">{x.responsible || '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button variant="ghost" size="icon-sm" aria-label="Open" title={`Open ${d.file_name}`} onClick={() => onOpen(d)}><Eye /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Download" title="Download" onClick={() => onDownload(d)}><Download /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Send by email" title="Send by email" onClick={() => onSend(d)}><Mail /></Button>
                  {d.can_edit && <Button variant="ghost" size="icon-sm" aria-label="Edit details" title="Edit details" onClick={() => onEdit(d)}><Pencil /></Button>}
                  {d.can_delete && <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Delete" title="Delete" onClick={() => onDelete(d)}><Trash2 /></Button>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
