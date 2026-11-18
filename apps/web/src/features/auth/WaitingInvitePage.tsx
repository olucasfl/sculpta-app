import { MailCheck, LogOut } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { Logo } from '../../components/Logo';
import { logout } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';

/** Conta sem vínculo ativo com nenhuma clínica: só entra quando alguém a adicionar. */
export function WaitingInvitePage() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  if (!user) return null;
  if (user.clinics.length > 0) return <Navigate to="/" replace />;
  if (user.isPlatformAdmin) return <Navigate to="/plataforma" replace />;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10 pb-safe pt-safe">
      <div className="w-full max-w-md text-center">
        <Logo className="mx-auto mb-8 h-11" />
        <div className="rounded-xl border border-line bg-surface p-6 shadow-card">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Aguardando convite</h1>
          <p className="mt-2 text-muted">
            Sua conta ({user.email}) ainda não está ligada a nenhuma clínica. Peça à dona ou à gerência da
            clínica para convidar este e-mail. Depois do convite, saia e entre de novo: o convite vale no login.
          </p>
        </div>
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
