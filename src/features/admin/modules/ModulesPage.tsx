import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Blocks, Check, Lock, Pencil, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import type { ModuleRow } from '@/lib/types';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { ACTION_LABELS, BUILT_MODULES, iconFor } from '@/app/registry';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch, Skeleton } from '@/components/ui/misc';
import { ErrorState, PageHeader } from '@/components/common';
import { qk, useModulesCatalogue } from '@/features/admin/api';

const LOCKED = (key: string) => key === 'dashboard' || key.startsWith('admin.');

export function ModulesPage() {
  const can = useCan('admin.modules');
  const { refresh } = useAccess();
  const qc = useQueryClient();
  const modules = useModulesCatalogue();
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: ModuleRow[] }[] = [];
    for (const m of modules.data ?? []) {
      const key = m.module_groups?.key ?? 'other';
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, label: m.module_groups?.label ?? 'Other', items: [] }));
      g.items.push(m);
    }
    return out;
  }, [modules.data]);

  async function patch(m: ModuleRow, values: Partial<Pick<ModuleRow, 'is_enabled' | 'label'>>) {
    const { error } = await supabase.from('modules').update(values).eq('id', m.id);
    if (error) return toast.error(errorMessage(error));
    toast.success(`${values.label ?? m.label} updated`);
    await qc.invalidateQueries({ queryKey: qk.modules });
    await refresh();
  }

  return (
    <>
      <PageHeader
        icon={Blocks}
        title="Module Management"
        description="Turn modules on or off for the whole organisation and rename menu items. Disabling a module hides it and blocks its data for everyone except Super Admin."
      />

      {modules.isLoading ? (
        <div className="grid gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : modules.error ? (
        <Card>
          <ErrorState message={errorMessage(modules.error)} />
        </Card>
      ) : (
        <div className="grid gap-6">
          {groups.map((g) => (
            <Card key={g.key} className="overflow-hidden">
              <div className="border-b bg-slate-50/60 px-5 py-3 text-sm font-semibold">{g.label}</div>
              <ul className="divide-y">
                {g.items.map((m) => {
                  const Icon = iconFor(m.icon);
                  const built = BUILT_MODULES.has(m.key);
                  const locked = LOCKED(m.key);
                  return (
                    <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {editing === m.id ? (
                            <form
                              className="flex items-center gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (label.trim()) void patch(m, { label: label.trim() });
                                setEditing(null);
                              }}
                            >
                              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 max-w-xs" autoFocus />
                              <Button size="icon-sm" type="submit" aria-label="Save name">
                                <Check />
                              </Button>
                              <Button size="icon-sm" variant="ghost" type="button" onClick={() => setEditing(null)} aria-label="Cancel">
                                <X />
                              </Button>
                            </form>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{m.label}</span>
                              {can.edit && (
                                <button
                                  className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditing(m.id);
                                    setLabel(m.label);
                                  }}
                                  aria-label={`Rename ${m.label}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {!built && <Badge variant="secondary">Phase {m.phase}</Badge>}
                              {m.is_site_scoped && <Badge variant="info">Site-scoped</Badge>}
                              {!m.show_in_nav && <Badge variant="outline">No menu item</Badge>}
                            </div>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.description} · <span className="font-mono">{m.key}</span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Actions: {m.supported_actions.map((a) => ACTION_LABELS[a]).join(', ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:w-56 sm:justify-end">
                        {locked ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" /> Always on
                          </span>
                        ) : !built && !m.is_enabled ? (
                          <span className="text-xs text-muted-foreground">Not yet released</span>
                        ) : (
                          <>
                            <span className="text-xs text-muted-foreground">{m.is_enabled ? 'Enabled' : 'Disabled'}</span>
                            <Switch
                              checked={m.is_enabled}
                              disabled={!can.edit}
                              onCheckedChange={(v) => void patch(m, { is_enabled: v })}
                              aria-label={`Enable ${m.label}`}
                            />
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
