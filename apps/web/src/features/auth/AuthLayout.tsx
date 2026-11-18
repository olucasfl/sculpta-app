import type { ReactNode } from 'react';
import { Logo } from '../../components/Logo';

/** Moldura simples das telas de entrada (entrar e criar conta): uma coluna centralizada. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 pb-safe pt-safe">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo className="h-11" />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        <p className="mt-6 text-center text-xs text-muted">Simulações são ilustrativas e não garantem resultado.</p>
      </div>
    </main>
  );
}
