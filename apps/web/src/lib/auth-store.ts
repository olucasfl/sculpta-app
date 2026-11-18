import type { AuthUser } from '@sim/contracts';
import { create } from 'zustand';

type Status = 'unknown' | 'authenticated' | 'anonymous';

const CLINIC_KEY = 'sculpta.clinic';

const readStoredClinic = (): string | null => {
  try {
    return localStorage.getItem(CLINIC_KEY);
  } catch {
    return null;
  }
};
const storeClinic = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CLINIC_KEY, id);
    else localStorage.removeItem(CLINIC_KEY);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
};

/**
 * Ajusta o usuário para a clínica escolhida. Uma clínica só = ela; várias = a última usada, se
 * ainda for válida; senão nenhuma (a pessoa vai para a tela de escolha).
 */
function withActiveClinic(user: AuthUser, wanted: string | null) {
  const pick =
    user.clinics.find((c) => c.id === wanted) ?? (user.clinics.length === 1 ? user.clinics[0] : undefined);
  return {
    activeClinicId: pick?.id ?? null,
    user: { ...user, clinicId: pick?.id ?? null, clinicName: pick?.name ?? null, role: pick?.role ?? null },
  };
}

interface AuthState {
  status: Status;
  user: AuthUser | null;
  /** Clínica enviada em `X-Clinic-Id`. A API valida contra o vínculo a cada chamada. */
  activeClinicId: string | null;
  /** Fica só em memória. Ao recarregar a página, a sessão volta pelo cookie de refresh. */
  accessToken: string | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  /** Troca a clínica ativa. Quem chama deve descartar o cache de dados (ver `switchClinic`). */
  setActiveClinic: (clinicId: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  activeClinicId: null,
  accessToken: null,
  setSession: (accessToken, user) => {
    const { user: u, activeClinicId } = withActiveClinic(user, get().activeClinicId ?? readStoredClinic());
    storeClinic(activeClinicId);
    set({ status: 'authenticated', accessToken, user: u, activeClinicId });
  },
  setActiveClinic: (clinicId) => {
    const current = get().user;
    if (!current) return;
    const { user, activeClinicId } = withActiveClinic(current, clinicId);
    storeClinic(activeClinicId);
    set({ user, activeClinicId });
  },
  clear: () => set({ status: 'anonymous', accessToken: null, user: null, activeClinicId: null }),
}));
