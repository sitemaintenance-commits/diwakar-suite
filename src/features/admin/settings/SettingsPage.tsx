import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Save, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useAccess, useCan } from '@/auth/AccessProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Field, PageHeader } from '@/components/common';
import { qk, useSettings } from '@/features/admin/api';
import { FilterSelect } from '@/features/admin/users/UsersPage';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function SettingsPage() {
  const can = useCan('admin.settings');
  const { refresh } = useAccess();
  const qc = useQueryClient();
  const settings = useSettings();
  const [f, setF] = useState({ company_name: '', brand_name: '', suite_name: '', support_email: '', fiscal_year_start_month: '4' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setF({
      company_name: String(s.company_name ?? ''),
      brand_name: String(s.brand_name ?? ''),
      suite_name: String(s.suite_name ?? ''),
      support_email: String(s.support_email ?? ''),
      fiscal_year_start_month: String(s.fiscal_year_start_month ?? 4),
    });
  }, [settings.data]);

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const rows = [
      { key: 'company_name', value: f.company_name.trim() },
      { key: 'brand_name', value: f.brand_name.trim() },
      { key: 'suite_name', value: f.suite_name.trim() },
      { key: 'support_email', value: f.support_email.trim() },
      { key: 'fiscal_year_start_month', value: Number(f.fiscal_year_start_month) },
    ].filter((r) => JSON.stringify(settings.data?.[r.key]) !== JSON.stringify(r.value));
    const { error } = rows.length ? await supabase.from('app_settings').upsert(rows) : { error: null };
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success(rows.length ? 'Settings saved' : 'No changes');
    await qc.invalidateQueries({ queryKey: qk.settings });
    await refresh();
  }

  return (
    <>
      <PageHeader icon={Settings} title="System Settings" description="Organisation-wide settings for the Management Suite." />
      {settings.isLoading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : (
        <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Company & branding</CardTitle>
              <CardDescription>Shown in the sidebar, sign-in page and exports.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Registered company name" htmlFor="st_company">
                <Input id="st_company" value={f.company_name} disabled={!can.edit} onChange={(e) => set('company_name', e.target.value)} />
              </Field>
              <Field label="Brand name" htmlFor="st_brand">
                <Input id="st_brand" value={f.brand_name} disabled={!can.edit} onChange={(e) => set('brand_name', e.target.value)} />
              </Field>
              <Field label="Application subtitle" htmlFor="st_suite">
                <Input id="st_suite" value={f.suite_name} disabled={!can.edit} onChange={(e) => set('suite_name', e.target.value)} />
              </Field>
              <Field label="Support email" htmlFor="st_support" hint="Shown to users who need help with access.">
                <Input id="st_support" type="email" value={f.support_email} disabled={!can.edit} onChange={(e) => set('support_email', e.target.value)} />
              </Field>
            </CardContent>
          </Card>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Regional</CardTitle>
              <CardDescription>Used for dates, reports and financial periods.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Time zone" hint="All dates and times are shown in Indian Standard Time.">
                <Input value="Asia/Kolkata (IST, UTC+05:30)" disabled />
              </Field>
              <Field label="Currency">
                <Input value="Indian Rupee (₹ INR)" disabled />
              </Field>
              <Field label="Financial year starts in">
                {can.edit ? (
                  <FilterSelect
                    value={f.fiscal_year_start_month}
                    onChange={(v) => set('fiscal_year_start_month', v)}
                    options={MONTHS.map((m, i) => [String(i + 1), m] as [string, string])}
                  />
                ) : (
                  <Input value={MONTHS[Number(f.fiscal_year_start_month) - 1] ?? 'April'} disabled />
                )}
              </Field>
            </CardContent>
          </Card>
          {can.edit && (
            <div className="lg:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Save />} Save settings
              </Button>
            </div>
          )}
        </form>
      )}
    </>
  );
}
