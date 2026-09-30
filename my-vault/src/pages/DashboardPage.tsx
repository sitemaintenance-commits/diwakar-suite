import { Clock, FileImage, FileText, FileType2, FileVideo, Files, Folder, HardDrive, MonitorSmartphone, RefreshCw, Star } from 'lucide-react';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { StorageWidget } from '@/components/dashboard/StorageWidget';
import { RecentFiles } from '@/components/dashboard/RecentFiles';
import { Button } from '@/components/ui/Button';
import { useStats } from '@/hooks/useFiles';
import { useDisplayName } from '@/hooks/useProfile';
import { getErrorMessage } from '@/lib/errors';
import { formatBytes, greeting } from '@/utils/format';

export function DashboardPage() {
  const name = useDisplayName();
  const { data: stats, isLoading, isError, error, refetch } = useStats();
  const n = (v?: number) => (v ?? 0).toLocaleString();

  const cards = [
    { label: 'Total Files', value: n(stats?.total_files), icon: Files, tone: 'bg-brand-soft text-brand', to: '/files' },
    { label: 'Images', value: n(stats?.images), icon: FileImage, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400', to: '/images' },
    { label: 'Screenshots', value: n(stats?.screenshots), icon: MonitorSmartphone, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400', to: '/screenshots' },
    { label: 'PDFs', value: n(stats?.pdfs), icon: FileType2, tone: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400', to: '/pdfs' },
    { label: 'Documents', value: n(stats?.documents), icon: FileText, tone: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400', to: '/documents' },
    { label: 'Videos', value: n(stats?.videos), icon: FileVideo, tone: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/10 dark:text-fuchsia-400', to: '/videos' },
    { label: 'Other Files', value: n(stats?.other), icon: Folder, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300', to: '/other' },
    { label: 'Favorites', value: n(stats?.favorites), icon: Star, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400', to: '/favorites' },
    {
      label: 'Storage Used',
      value: formatBytes(stats?.total_bytes),
      hint: stats?.quota_bytes ? `of ${formatBytes(stats.quota_bytes, 0)}` : undefined,
      icon: HardDrive,
      tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
      to: '/storage',
    },
    { label: 'Recently Uploaded', value: n(stats?.recent_7d), hint: 'in the last 7 days', icon: Clock, tone: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300', to: '/recent' },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          {greeting()}, {name}
        </h2>
        <p className="mt-1 text-sm text-muted">Here is what is happening in your library.</p>
      </div>

      {isError && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <span className="flex-1">Could not load library stats: {getErrorMessage(error)}</span>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        {cards.map((c) => (
          <DashboardCard key={c.label} {...c} loading={isLoading} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <RecentFiles />
        <StorageWidget stats={stats} loading={isLoading} compact />
      </div>
    </div>
  );
}
