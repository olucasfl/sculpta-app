import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/format';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Nome acessível do painel. */
  label: string;
  side?: 'left' | 'bottom';
  children: ReactNode;
}

/**
 * Painel lateral (drawer) ou inferior (bottom sheet) sobre o <dialog> nativo:
 * foco preso, Esc fecha, clique fora fecha e o foco volta ao botão que abriu.
 */
export function Sheet({ open, onClose, label, side = 'left', children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'fixed m-0 max-h-none max-w-none overflow-y-auto bg-surface p-0 text-ink shadow-pop',
        side === 'left' && 'inset-y-0 left-0 h-dvh w-72 border-r border-line',
        side === 'bottom' && 'inset-x-0 bottom-0 top-auto w-full rounded-t-2xl border-t border-line pb-safe',
      )}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
      >
        <X className="size-5" aria-hidden />
      </button>
      {children}
    </dialog>
  );
}
