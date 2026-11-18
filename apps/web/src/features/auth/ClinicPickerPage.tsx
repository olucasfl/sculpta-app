import { ROLE_LABEL } from '@sim/contracts';
import { Building2, ChevronRight, LogOut } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { Logo } from '../../components/Logo';
import { logout } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { switchClinic } from '../../lib/query-client';

/** Quem tem vínculo em mais de uma clínica escolhe em qual entrar. */
export function ClinicPickerPage() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  if (!user) return null;
  if (user.clinics.length === 0) return <Navigate to="/aguardando" replace />;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 pb-safe pt-safe">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-6 h-11" />
          <h1 className="text-2xl font-semibold tracking-tight">Escolha a clínica</h1>
          <p className="mt-1 text-sm text-muted">
            Você tem acesso a {user.clinics.length} clínicas. Os dados de cada uma ficam separados.
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {user.clinics.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  switchClinic(c.id);
                  navigate('/', { replace: true });
                }}
                className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-card hover:border-field"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                  <Building2 className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block text-sm text-muted">{ROLE_LABEL[c.role]}</span>
                </span>
                <ChevronRight className="size-5 text-faint" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="mx-auto mt-6 flex min-h-11 items-center gap-2 text-sm text-muted hover:text-ink"
        >
          <LogOut className="size-4" aria-hidden /> Sair
        </button>
      </div>
    </main>
  );
}
