import { z } from 'zod';
import { ClinicRole } from './roles.js';

export const PASSWORD_MIN = 10;

/**
 * Cadastro direto de um membro com senha inicial (modo local/desenvolvimento).
 * O caminho de produção é o convite por e-mail (etapa 1B.4).
 */
export const UserCreate = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z
    .string()
    .min(PASSWORD_MIN, `A senha precisa de ao menos ${PASSWORD_MIN} caracteres`)
    .max(200),
  role: ClinicRole,
});
export type UserCreate = z.infer<typeof UserCreate>;

export const UserUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: ClinicRole.optional(),
  active: z.boolean().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdate>;

/** Membro da clínica: a conta vista pelo vínculo. `id` é o id da CONTA. */
export interface User {
  id: string;
  name: string;
  email: string;
  role: ClinicRole;
  active: boolean;
  createdAt: string;
}
