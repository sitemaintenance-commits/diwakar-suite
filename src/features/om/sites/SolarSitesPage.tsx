// Solar Sites — the technical record of each plant plus its equipment.
// The site itself (name, location, access) stays in Site Management; this
// page holds the plant details O&M needs.
import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cpu, Loader2, Pencil, Plus, Sun, Trash2, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { fmtCapacity, fmtDate, fmtINR, fmtNumber, safeNum } from '@/lib/format';
import type { Equipment, EquipmentType, Site, SolarSite } from '@/lib/types';
import { useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, RecordStatusBadge } from '@/components/common';
import { FilterSelect } from '@/features/admin/users/UsersPage';
import { usePeople, useSites } from '@/features/admin/api';
import { useEquipment, useSolarSites } from '@/features/om/api';
import { EQUIPMENT_LABEL, EQUIPMENT_TYPES } from '@/features/om/shared';

const NONE = '__none__';
const MONITORING = [
  ['manual', 'Manual entry'],
  ['api', 'Inverter portal API'],
  ['scada', 'SCADA'],
  ['excel', 'Excel upload'],
] as [string, string][];

export function SolarSitesPage() {
  const can = useCan('om.sites');
  const sites = useSites();
  const solar = useSolarSites();
  const [editing, setEditing] = useState<{ site: Site; solar: SolarSite | null } | null>(null);
  const [equipmentFor, setEquipmentFor] = useState<Site | null>(null);

  const byId = Object.fromEntries((solar.data ?? []).map((s) => [s.site_id, s]));
  const rows = (sites.data ?? []).filter((s) => s.status === 'active' || byId[s.id]);

  return (
    <>
      <PageHeader
        icon={Sun}
        title="Solar Sites"
        description="Plant details for the sites you can access: capacity, commissioning, grid connection and equipment."
      />

      {sites.isLoading || solar.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : sites.error ? (
        <Card>
          <ErrorState message={errorMessage(sites.error)} onRetry={() => sites.refetch()} />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState icon={Sun} title="No sites assigned" description="Ask your administrator to assign sites to your account." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((site) => {
            const ss = byId[site.id];
            return (
              <Card key={site.id}>
                <CardHeader className="flex-row items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{site.name}</CardTitle>
                    <CardDescription className="truncate">
                      {[site.location, site.district].filter(Boolean).join(', ') || 'Location not set'}
                    </CardDescription>
                  </div>
                  <RecordStatusBadge status={site.status} />
                </CardHeader>
                <CardContent className="grid gap-3">
                  {ss ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">DC capacity</dt>
                        <dd className="font-medium">{fmtCapacity(ss.capacity_dc_kwp)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">AC capacity</dt>
                        <dd className="font-medium">{safeNum(ss.capacity_ac_kw) ? `${fmtNumber(ss.capacity_ac_kw, 2)} kW` : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Commissioned</dt>
                        <dd className="font-medium">{ss.commissioning_date ? fmtDate(ss.commissioning_date) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Expected yield</dt>
                        <dd className="font-medium">{ss.expected_yield ? `${fmtNumber(ss.expected_yield, 2)} kWh/kWp` : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Grid / DISCOM</dt>
                        <dd className="font-medium">{[ss.grid_connection, ss.discom].filter(Boolean).join(' · ') || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Tariff</dt>
                        <dd className="font-medium">{ss.tariff_per_kwh ? `${fmtINR(ss.tariff_per_kwh)}/kWh` : '—'}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">Monitoring</dt>
                        <dd>
                          <Badge variant={ss.monitoring_source === 'manual' ? 'secondary' : 'info'}>
                            {MONITORING.find(([k]) => k === ss.monitoring_source)?.[1] ?? ss.monitoring_source}
                          </Badge>
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Plant details not filled in yet{can.create ? ' — add them to enable CUF and yield tracking.' : '.'}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(can.edit || can.create) && (
                      <Button size="sm" variant="outline" onClick={() => setEditing({ site, solar: ss ?? null })}>
                        {ss ? <Pencil /> : <Plus />} {ss ? 'Edit details' : 'Add details'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEquipmentFor(site)}>
                      <Cpu /> Equipment
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SolarSiteDialog entry={editing} onClose={() => setEditing(null)} />
      <EquipmentDialog site={equipmentFor} onClose={() => setEquipmentFor(null)} />
    </>
  );
}

function SolarSiteDialog({ entry, onClose }: { entry: { site: Site; solar: SolarSite | null } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const empty = {
    capacity_dc_kwp: '', capacity_ac_kw: '', commissioning_date: '', module_make: '', module_count: '',
    inverter_make: '', inverter_count: '', grid_connection: '', discom: '', consumer_no: '', tariff_per_kwh: '',
    expected_yield: '', monitoring_source: 'manual', om_lead_id: '', om_start_date: '', om_end_date: '', notes: '',
  };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    const ss = entry.solar;
    setF(
      ss
        ? {
            capacity_dc_kwp: s(ss.capacity_dc_kwp), capacity_ac_kw: s(ss.capacity_ac_kw), commissioning_date: s(ss.commissioning_date),
            module_make: s(ss.module_make), module_count: s(ss.module_count), inverter_make: s(ss.inverter_make),
            inverter_count: s(ss.inverter_count), grid_connection: s(ss.grid_connection), discom: s(ss.discom),
            consumer_no: s(ss.consumer_no), tariff_per_kwh: s(ss.tariff_per_kwh), expected_yield: s(ss.expected_yield),
            monitoring_source: ss.monitoring_source, om_lead_id: s(ss.om_lead_id), om_start_date: s(ss.om_start_date),
            om_end_date: s(ss.om_end_date), notes: s(ss.notes),
          }
        : { ...empty, capacity_dc_kwp: s(entry.site.capacity_kwp) },
    );
  }, [entry]);

  if (!entry) return null;
  const set = (k: keyof typeof empty, v: string) => setF((s) => ({ ...s, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      site_id: entry!.site.id,
      capacity_dc_kwp: num(f.capacity_dc_kwp) ?? 0,
      capacity_ac_kw: num(f.capacity_ac_kw) ?? 0,
      commissioning_date: f.commissioning_date || null,
      module_make: f.module_make.trim() || null,
      module_count: num(f.module_count),
      inverter_make: f.inverter_make.trim() || null,
      inverter_count: num(f.inverter_count),
      grid_connection: f.grid_connection.trim() || null,
      discom: f.discom.trim() || null,
      consumer_no: f.consumer_no.trim() || null,
      tariff_per_kwh: num(f.tariff_per_kwh),
      expected_yield: num(f.expected_yield),
      monitoring_source: f.monitoring_source,
      om_lead_id: f.om_lead_id || null,
      om_start_date: f.om_start_date || null,
      om_end_date: f.om_end_date || null,
      notes: f.notes.trim() || null,
    };
    const { error } = entry!.solar
      ? await supabase.from('solar_sites').update(payload).eq('site_id', entry!.site.id)
      : await supabase.from('solar_sites').insert(payload);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Plant details saved');
    await qc.invalidateQueries({ queryKey: ['solar-sites'] });
    await qc.invalidateQueries({ queryKey: ['generation-summary'] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry.site.name} — plant details</DialogTitle>
          <DialogDescription>Used for CUF, expected generation and O&amp;M planning.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="DC capacity (kWp)" htmlFor="s_dc">
            <Input id="s_dc" inputMode="decimal" value={f.capacity_dc_kwp} onChange={(e) => set('capacity_dc_kwp', e.target.value)} autoFocus />
          </Field>
          <Field label="AC capacity (kW)" htmlFor="s_ac">
            <Input id="s_ac" inputMode="decimal" value={f.capacity_ac_kw} onChange={(e) => set('capacity_ac_kw', e.target.value)} />
          </Field>
          <Field label="Commissioning date" htmlFor="s_comm">
            <Input id="s_comm" type="date" value={f.commissioning_date} onChange={(e) => set('commissioning_date', e.target.value)} />
          </Field>
          <Field label="Expected yield (kWh per kWp per day)" htmlFor="s_yield" hint="Used to pre-fill expected generation.">
            <Input id="s_yield" inputMode="decimal" value={f.expected_yield} onChange={(e) => set('expected_yield', e.target.value)} placeholder="4.5" />
          </Field>
          <Field label="Module make" htmlFor="s_mm">
            <Input id="s_mm" value={f.module_make} onChange={(e) => set('module_make', e.target.value)} />
          </Field>
          <Field label="Module count" htmlFor="s_mc">
            <Input id="s_mc" inputMode="numeric" value={f.module_count} onChange={(e) => set('module_count', e.target.value)} />
          </Field>
          <Field label="Inverter make" htmlFor="s_im">
            <Input id="s_im" value={f.inverter_make} onChange={(e) => set('inverter_make', e.target.value)} />
          </Field>
          <Field label="Inverter count" htmlFor="s_ic">
            <Input id="s_ic" inputMode="numeric" value={f.inverter_count} onChange={(e) => set('inverter_count', e.target.value)} />
          </Field>
          <Field label="Grid connection" htmlFor="s_grid">
            <Input id="s_grid" value={f.grid_connection} onChange={(e) => set('grid_connection', e.target.value)} placeholder="11 kV" />
          </Field>
          <Field label="DISCOM" htmlFor="s_disc">
            <Input id="s_disc" value={f.discom} onChange={(e) => set('discom', e.target.value)} placeholder="JVVNL / AVVNL / JdVVNL" />
          </Field>
          <Field label="Consumer number" htmlFor="s_cons">
            <Input id="s_cons" value={f.consumer_no} onChange={(e) => set('consumer_no', e.target.value)} />
          </Field>
          <Field label="Tariff (₹ per kWh)" htmlFor="s_tar">
            <Input id="s_tar" inputMode="decimal" value={f.tariff_per_kwh} onChange={(e) => set('tariff_per_kwh', e.target.value)} />
          </Field>
          <Field label="Monitoring source">
            <FilterSelect value={f.monitoring_source} onChange={(v) => set('monitoring_source', v)} options={MONITORING} />
          </Field>
          <Field label="O&M lead">
            <FilterSelect
              value={f.om_lead_id || NONE}
              onChange={(v) => set('om_lead_id', v === NONE ? '' : v)}
              options={[[NONE, '— None —'], ...(people.data ?? []).map((p) => [p.id, p.full_name] as [string, string])]}
            />
          </Field>
          <Field label="O&M contract from" htmlFor="s_omf">
            <Input id="s_omf" type="date" value={f.om_start_date} onChange={(e) => set('om_start_date', e.target.value)} />
          </Field>
          <Field label="O&M contract until" htmlFor="s_omt">
            <Input id="s_omt" type="date" value={f.om_end_date} onChange={(e) => set('om_end_date', e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="s_notes" className="sm:col-span-2">
            <Textarea id="s_notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EquipmentDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const can = useCan('om.equipment');
  const qc = useQueryClient();
  const list = useEquipment(site?.id);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ type: 'inverter' as EquipmentType, name: '', make: '', model: '', serial_no: '', capacity_kw: '', installed_on: '', warranty_until: '' });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Equipment | null>(null);

  if (!site) return null;
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('equipment').insert({
      site_id: site!.id,
      type: f.type,
      name: f.name.trim(),
      make: f.make.trim() || null,
      model: f.model.trim() || null,
      serial_no: f.serial_no.trim() || null,
      capacity_kw: f.capacity_kw ? Number(f.capacity_kw) : null,
      installed_on: f.installed_on || null,
      warranty_until: f.warranty_until || null,
    });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success('Equipment added');
    setF({ type: 'inverter', name: '', make: '', model: '', serial_no: '', capacity_kw: '', installed_on: '', warranty_until: '' });
    setAdding(false);
    await qc.invalidateQueries({ queryKey: ['equipment', site!.id] });
  }

  async function remove(item: Equipment) {
    const { error } = await supabase.rpc('soft_delete_record', { p_table: 'equipment', p_id: item.id });
    if (error) return toast.error(errorMessage(error));
    toast.success('Equipment removed');
    await qc.invalidateQueries({ queryKey: ['equipment', site!.id] });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{site.name} — equipment</DialogTitle>
          <DialogDescription>Inverters, modules, transformers and meters installed at this site.</DialogDescription>
        </DialogHeader>

        {can.create && !adding && (
          <Button variant="outline" className="w-fit" onClick={() => setAdding(true)}>
            <Plus /> Add equipment
          </Button>
        )}
        {adding && (
          <form onSubmit={add} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Field label="Type">
              <FilterSelect value={f.type} onChange={(v) => set('type', v)} options={EQUIPMENT_TYPES.map((t) => [t, EQUIPMENT_LABEL[t]] as [string, string])} />
            </Field>
            <Field label="Name / tag" htmlFor="e_name" required>
              <Input id="e_name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="INV-01" autoFocus />
            </Field>
            <Field label="Capacity (kW)" htmlFor="e_cap">
              <Input id="e_cap" inputMode="decimal" value={f.capacity_kw} onChange={(e) => set('capacity_kw', e.target.value)} />
            </Field>
            <Field label="Make" htmlFor="e_make">
              <Input id="e_make" value={f.make} onChange={(e) => set('make', e.target.value)} />
            </Field>
            <Field label="Model" htmlFor="e_model">
              <Input id="e_model" value={f.model} onChange={(e) => set('model', e.target.value)} />
            </Field>
            <Field label="Serial number" htmlFor="e_sn">
              <Input id="e_sn" value={f.serial_no} onChange={(e) => set('serial_no', e.target.value)} />
            </Field>
            <Field label="Installed on" htmlFor="e_inst">
              <Input id="e_inst" type="date" value={f.installed_on} onChange={(e) => set('installed_on', e.target.value)} />
            </Field>
            <Field label="Warranty until" htmlFor="e_warr">
              <Input id="e_warr" type="date" value={f.warranty_until} onChange={(e) => set('warranty_until', e.target.value)} />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy || !f.name.trim()}>
                {busy && <Loader2 className="animate-spin" />} Add
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {list.isLoading ? (
          <Skeleton className="h-32" />
        ) : !list.data?.length ? (
          <EmptyState icon={Cpu} title="No equipment recorded" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipment</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead>Warranty</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((e) => {
                const expiring = e.warranty_until && new Date(e.warranty_until) < new Date(Date.now() + 60 * 864e5);
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-muted-foreground">{[e.make, e.model, e.serial_no].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell>{EQUIPMENT_LABEL[e.type]}</TableCell>
                    <TableCell className="tabular text-right">{e.capacity_kw ? `${fmtNumber(e.capacity_kw, 2)} kW` : '—'}</TableCell>
                    <TableCell className="text-sm">
                      {e.warranty_until ? (
                        <span className={expiring ? 'text-amber-600' : ''}>
                          {fmtDate(e.warranty_until)}
                          {expiring ? ' (expiring)' : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {can.delete && (
                        <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setRemoving(e)} aria-label="Remove">
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>

        <ConfirmDialog
          open={Boolean(removing)}
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Remove ${removing?.name}?`}
          description="The equipment is removed from the register. Tickets that referenced it are kept."
          confirmLabel="Remove"
          destructive
          onConfirm={() => removing && void remove(removing)}
        />
      </DialogContent>
    </Dialog>
  );
}

export { Zap };
