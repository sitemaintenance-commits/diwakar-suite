// Vendors, with the vendor bills (Vendor Payment Approval) and Client
// Payments as tabs of the same page. Each tab shows only for whoever may
// open it; ?tab= keeps the tab in the address.
import { useSearchParams } from 'react-router';
import { useCan } from '@/auth/AccessProvider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VendorsPage } from '@/features/projects/VendorsPage';
import { ClientPaymentsPage, VendorBillsPage } from '@/features/projects/PortfolioPages';

type Tab = 'vendors' | 'bills' | 'payments';

export function VendorsSection() {
  const vendors = useCan('projects.vendors');
  const bills = useCan('projects.bills');
  const payments = useCan('projects.payments');
  const [params, setParams] = useSearchParams();
  const tabs = ([
    ['vendors', 'Vendors', vendors.view],
    ['bills', 'Vendor Payment Approval', bills.view],
    ['payments', 'Client Payments', payments.view],
  ] as [Tab, string, boolean][]).filter(([, , ok]) => ok);
  const asked = params.get('tab') as Tab | null;
  const current: Tab = tabs.some(([k]) => k === asked) ? asked! : tabs[0]?.[0] ?? 'vendors';

  return (
    <>
      {tabs.length > 1 && (
        <Tabs value={current} onValueChange={(v) => setParams(v === 'vendors' ? {} : { tab: v }, { replace: true })} className="mb-4">
          <TabsList className="h-auto flex-wrap">
            {tabs.map(([k, label]) => <TabsTrigger key={k} value={k}>{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
      {current === 'bills' ? <VendorBillsPage /> : current === 'payments' ? <ClientPaymentsPage /> : <VendorsPage />}
    </>
  );
}
