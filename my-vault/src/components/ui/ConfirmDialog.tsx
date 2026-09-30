import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialog({
  open,
  options,
  onResult,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  onResult: (ok: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={() => onResult(false)}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onResult(false)}>
            {options?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={options?.danger ? 'danger' : 'primary'} onClick={() => onResult(true)} data-autofocus>
            {options?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="flex gap-4 pt-1">
        <div
          className={
            options?.danger
              ? 'flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger'
              : 'flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand'
          }
        >
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{options?.title}</h2>
          <div className="mt-1 text-sm text-muted">{options?.message}</div>
        </div>
      </div>
    </Modal>
  );
}

/** Promise-based confirmation: `if (await confirm({...})) doIt()` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog open={options !== null} options={options} onResult={finish} />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
