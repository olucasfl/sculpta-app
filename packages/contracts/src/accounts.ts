import { z } from 'zod';
import { PASSWORD_MIN } from './users.js';

const email = z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'));
const newPassword = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa de ao menos ${PASSWORD_MIN} caracteres`)
  .max(200);

/**
 * Criar conta. Não dá acesso a nenhuma clínica por si só: o acesso vem de convite por e-mail
 * (docs/CONTAS-CLINICAS-PERMISSOES.md, 4.3 e 4.4).
 *
 * ATENÇÃO: por enquanto NÃO há verificação de e-mail (decisão de 18/11/2026: sem e-mail real).
 * Quem souber um e-mail convidado consegue criar a conta com ele e usar o convite. Isso só é
 * aceitável em desenvolvimento; antes de qualquer acesso público é obrigatório verificar o e-mail.
 */
export const SignupRequest = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto').max(120),
    email,
    password: newPassword,
    /** Digitar a senha duas vezes evita criar uma conta com a senha errada. A API confere também. */
    confirmPassword: z.string().max(200),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'As senhas não conferem' });
export type SignupRequest = z.infer<typeof SignupRequest>;

export const ChangePasswordRequest = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual').max(200),
    newPassword,
    confirmNewPassword: z.string().max(200),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, { path: ['confirmNewPassword'], message: 'As senhas não conferem' });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;
