import type { AuthUser } from '@sim/contracts';
import { create } from 'zustand';

type Status = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: AuthUser | null;
  /** Fica só em memória. Ao recarregar a página, a sessão volta pelo cookie de refresh. */
  accessToken: string | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  accessToken: null,
  setSession: (accessToken, user) => set({ status: 'authenticated', accessToken, user }),
  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}));
