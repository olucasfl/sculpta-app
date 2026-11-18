import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '../../lib/format';

interface Toast {
  id: number;
  tone: 'ok' | 'error';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (tone: Toast['tone'], message: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, tone, message }] });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 7000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  ok: (message: string) => useToasts.getState().push('ok', message),
  error: (message: string) => useToasts.getState().push('error', message),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-pop',
            t.tone === 'error' ? 'border-danger/30' : 'border-line',
          )}
        >
          {t.tone === 'ok' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          )}
          <p className="flex-1 text-sm">{t.message}</p>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Fechar aviso" className="text-faint hover:text-ink">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
