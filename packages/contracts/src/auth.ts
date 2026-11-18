import { z } from 'zod';
import { Role } from './roles.js';

export const LoginRequest = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z.string().min(1, 'Informe a senha').max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  clinicId: string;
  clinicName: string;
}

export interface LoginResponse {
  accessToken: string;
  /** Validade do access token em segundos. */
  expiresIn: number;
  user: AuthUser;
}

/** Conteúdo do access token (JWT). `clinicId` sempre vem daqui, nunca do body. */
export interface AccessTokenPayload {
  sub: string;
  clinicId: string;
  role: Role;
}
