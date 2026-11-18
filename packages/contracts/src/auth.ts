import { z } from 'zod';
import { ClinicRole } from './roles.js';

export const LoginRequest = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z.string().min(1, 'Informe a senha').max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Cabeçalho que diz em qual clínica a requisição age. A API valida contra o vínculo a cada chamada. */
export const CLINIC_HEADER = 'x-clinic-id';

/** Uma clínica em que a pessoa tem vínculo ativo. */
export interface ClinicMembership {
  id: string;
  name: string;
  role: ClinicRole;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
  /** Todas as clínicas em que a pessoa tem vínculo ativo. */
  clinics: ClinicMembership[];
  /**
   * Clínica ativa nesta resposta: a do cabeçalho `X-Clinic-Id` ou, se a pessoa tem uma só, essa.
   * `null` quando há várias e nenhuma foi escolhida, ou nenhuma (aguardando convite).
   */
  clinicId: string | null;
  clinicName: string | null;
  role: ClinicRole | null;
  /** Clínicas em que a pessoa acabou de entrar por convite (só em login e verificação de e-mail). */
  joined?: ClinicMembership[];
  /** Só para o administrador da plataforma dentro de uma clínica em modo suporte (somente leitura). */
  support?: { id: string; expiresAt: string; reason: string };
}

export interface LoginResponse {
  accessToken: string;
  /** Validade do access token em segundos. */
  expiresIn: number;
  user: AuthUser;
}

/** Conteúdo do access token (JWT). A clínica NÃO vai no token: vem de `X-Clinic-Id`, validada pelo vínculo. */
export interface AccessTokenPayload {
  sub: string;
}
