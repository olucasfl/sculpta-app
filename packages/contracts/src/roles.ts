import { z } from 'zod';

export const Role = z.enum(['ADMIN', 'PROFISSIONAL', 'RECEPCAO']);
export type Role = z.infer<typeof Role>;

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  PROFISSIONAL: 'Profissional',
  RECEPCAO: 'Recepção',
};

/**
 * Permissões por papel. Fonte única para a API (guards) e para o front (esconder ações).
 * Quem garante é a API; o front só evita mostrar o que vai falhar.
 */
export const PERMISSIONS = {
  'patients.read': ['ADMIN', 'PROFISSIONAL', 'RECEPCAO'],
  'patients.write': ['ADMIN', 'PROFISSIONAL', 'RECEPCAO'],
  'patients.delete': ['ADMIN'],
  'consents.write': ['ADMIN', 'PROFISSIONAL', 'RECEPCAO'],
  'consents.revoke': ['ADMIN', 'PROFISSIONAL'],
  'users.manage': ['ADMIN'],
  'clinic.manage': ['ADMIN'],
  'audit.read': ['ADMIN'],
  'simulations.write': ['ADMIN', 'PROFISSIONAL'],
  'simulations.export': ['ADMIN', 'PROFISSIONAL'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
