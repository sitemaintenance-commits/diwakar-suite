// Pieces the procurement pages share: the lookups (projects, sites,
// departments, vendors, items) and the item-line editor used by
// requisitions and purchase orders.
import { Plus, Trash2 } from 'lucide-react';
import { fmtINR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { useDepartments, useSites } from '@/features/admin/api';
import { useVendors } from '@/features/projects/api';
import { useProjectList } from '@/features/projects/portfolio';
import { UOMS, useItems, type Item } from '@/features/procurement/api';

export const NONE = '__none__';
export const opt = (rows: { id: string; name: string }[] | undefined, none?: string): [string, string][] =>
  [...(none ? [[NONE, none] as [string, string]] : []), ...(rows ?? []).map((r) => [r.id, r.name] as [string, string])];
export const unNone = (v: string) => (v === NONE ? '' : v);
const n = (v: unknown) => (v === '' || v == null ? 0 : Number(v));

export function useLookups() {
  const projects = useProjectList();
  const sites = useSites();
  const departments = useDepartments();
  const vendors = useVendors();
  const items = useItems();
  const name = (rows: { id: string; name: string }[] | undefined, id: string | null | undefined) =>
    (id && rows?.find((r) => r.id === id)?.name) || null;
  return {
    projects: projects.data ?? [],
    sites: sites.data ?? [],
    departments: departments.data ?? [],
    vendors: vendors.data ?? [],
    items: items.data ?? [],
    projectName: (id?: string | null) => name(projects.data, id),
    siteName: (id?: string | null) => name(sites.data, id),
    departmentName: (id?: string | null) => name(departments.data, id),
    vendorName: (id?: string | null) => name(vendors.data, id),
    item: (id?: string | null) => (items.data ?? []).find((i) => i.id === id) ?? null,
  };
}

export interface EditLine {
  item_id: string | null;
  description: string;
  qty: string;
  uom: string;
  rate: string;
  gst_rate?: string;
}

/** Item lines: pick an item from the master (fills name, unit, rate, GST) or type a description. */
export function LineEditor({ lines, setLines, items, withGst, rateLabel = 'Rate (₹)', disabled }: {
  lines: EditLine[];
  setLines: (l: EditLine[]) => void;
  items: Item[];
  withGst?: boolean;
  rateLabel?: string;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<EditLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => {
    if (id === NONE) return set(i, { item_id: null });
    const it = items.find((x) => x.id === id);
    if (!it) return;
    set(i, { item_id: it.id, description: it.name, uom: it.uom, rate: it.last_rate != null ? String(it.last_rate) : lines[i].rate, gst_rate: String(it.gst_rate) });
  };
  const blank: EditLine = { item_id: null, description: '', qty: '1', uom: 'nos', rate: '', gst_rate: '18' };
  const total = lines.reduce((s, l) => s + n(l.qty) * n(l.rate) * (withGst ? 1 + n(l.gst_rate) / 100 : 1), 0);

  return (
    <div className="grid gap-2">
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_5rem_5.5rem_6.5rem_4.5rem_2rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
        <span>Item</span><span>Description</span><span>Qty</span><span>Unit</span><span>{rateLabel}</span><span>{withGst ? 'GST %' : ''}</span><span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_5rem_5.5rem_6.5rem_4.5rem_2rem] md:border-0 md:p-0">
          <FilterSelect value={l.item_id ?? NONE} onChange={(v) => pick(i, v)}
            options={[[NONE, 'Not in the master'], ...items.filter((x) => x.is_active).map((x) => [x.id, `${x.code} · ${x.name}`] as [string, string])]} />
          <Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="What is needed, specification" disabled={disabled} />
          <Input inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} placeholder="Qty" disabled={disabled} />
          <FilterSelect value={l.uom} onChange={(v) => set(i, { uom: v })} options={[...new Set([l.uom, ...UOMS])].map((u) => [u, u] as [string, string])} />
          <Input inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} placeholder="0" disabled={disabled} />
          {withGst ? (
            <Input inputMode="decimal" value={l.gst_rate ?? '18'} onChange={(e) => set(i, { gst_rate: e.target.value })} disabled={disabled} />
          ) : <span className="hidden md:block" />}
          <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Remove line" disabled={disabled || lines.length === 1}
            onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setLines([...lines, blank])}><Plus /> Add line</Button>
        <span className="text-sm">Total{withGst ? ' with GST' : ''}: <span className="tabular font-semibold">{fmtINR(total)}</span></span>
      </div>
    </div>
  );
}
