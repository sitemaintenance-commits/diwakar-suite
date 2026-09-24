import { BrandMark } from '@/components/common/Brand';

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <BrandMark className="h-11 w-11 animate-pulse" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
