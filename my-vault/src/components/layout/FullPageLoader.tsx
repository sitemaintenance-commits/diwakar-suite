import { Logo, Spinner } from '@/components/ui/misc';

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas" aria-busy="true">
      <Logo size="lg" />
      <Spinner />
    </div>
  );
}
