import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
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
