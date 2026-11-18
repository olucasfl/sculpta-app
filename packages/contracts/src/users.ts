import { z } from 'zod';
import { Role } from './roles.js';

export const PASSWORD_MIN = 10;

export const UserCreate = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  password: z
    .string()
    .min(PASSWORD_MIN, `A senha precisa de ao menos ${PASSWORD_MIN} caracteres`)
    .max(200),
  role: Role,
});
export type UserCreate = z.infer<typeof UserCreate>;

export const UserUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: Role.optional(),
  active: z.boolean().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdate>;

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}
