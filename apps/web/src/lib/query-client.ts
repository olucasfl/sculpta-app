import type { AuthUser } from '@sim/contracts';
import { QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { useAuth } from './auth-store';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

/**
 * Troca de clínica. Descarta TODO o cache: dados de uma clínica nunca podem aparecer
 * na tela depois de entrar em outra.
 */
export function switchClinic(clinicId: string) {
  useAuth.getState().setActiveClinic(clinicId);
  queryClient.clear();
}

/**
 * Administrador da plataforma entrando em uma clínica em MODO SUPORTE (somente leitura, com a janela já aberta
 * na API). Depois de recarregar a página o modo some da tela (a janela segue valendo até vencer).
 */
export async function enterSupport(clinicId: string) {
  useAuth.setState({ activeClinicId: clinicId });
  queryClient.clear();
  const me = await api<AuthUser>('/auth/me');
  useAuth.setState({ user: me });
}

export async function leaveSupport() {
  const win = useAuth.getState().user?.support;
  if (win) await api<void>(`/platform/support-access/${win.id}`, { method: 'DELETE' });
  useAuth.setState({ activeClinicId: null });
  queryClient.clear();
  const me = await api<AuthUser>('/auth/me');
  useAuth.setState({ user: me });
}
