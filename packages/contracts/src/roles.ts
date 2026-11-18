import { z } from 'zod';

/**
 * Papel de uma pessoa DENTRO de uma clínica (o "vínculo"). A mesma conta pode ter papéis
 * diferentes em clínicas diferentes. O administrador da plataforma é outra coisa
 * (`isPlatformAdmin` na conta) e não aparece aqui.
 * Especificação: docs/CONTAS-CLINICAS-PERMISSOES.md.
 */
export const ClinicRole = z.enum(['OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR', 'RECEPCAO', 'VISUALIZADOR']);
export type ClinicRole = z.infer<typeof ClinicRole>;

/** Nome antigo, mantido para não quebrar importações; vale `ClinicRole`. */
export const Role = ClinicRole;
export type Role = ClinicRole;

export const ROLE_LABEL: Record<ClinicRole, string> = {
  OWNER: 'Dona da clínica',
  GERENTE: 'Gerente',
  PROFISSIONAL: 'Profissional',
  AUXILIAR: 'Auxiliar',
  RECEPCAO: 'Recepção',
  VISUALIZADOR: 'Visualizador',
};

export const ROLE_DESCRIPTION: Record<ClinicRole, string> = {
  OWNER: 'Tudo na clínica: equipe, configurações, auditoria e exclusão de dados.',
  GERENTE: 'Equipe (exceto donas), configurações, auditoria e relatórios.',
  PROFISSIONAL: 'Pacientes, termos, capturas, simulações, exportação e relatórios.',
  AUXILIAR: 'Pacientes e capturas; vê simulações, sem exportar.',
  RECEPCAO: 'Cadastro de pacientes e termo de consentimento; não vê fotos nem modelos 3D.',
  VISUALIZADOR: 'Somente leitura de pacientes, fotos e simulações.',
};

/**
 * Permissões por papel (matriz da seção 3.3 de docs/CONTAS-CLINICAS-PERMISSOES.md).
 * Fonte única para a API (guards) e para o front (esconder ações).
 * Quem garante é a API; o front só evita mostrar o que vai falhar.
 */
const ALL: readonly ClinicRole[] = ['OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR', 'RECEPCAO', 'VISUALIZADOR'];
const STAFF_EDIT = ['OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR', 'RECEPCAO'] as const;
const SEES_PHOTOS = ['OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR', 'VISUALIZADOR'] as const;
const CLINICAL = ['OWNER', 'GERENTE', 'PROFISSIONAL'] as const;
const MANAGEMENT = ['OWNER', 'GERENTE'] as const;

export const PERMISSIONS = {
  'patients.read': ALL,
  'patients.write': STAFF_EDIT,
  'patients.delete': MANAGEMENT,
  'consents.write': STAFF_EDIT,
  'consents.revoke': CLINICAL,
  /** Fazer captura facial (fotos). */
  'captures.write': ['OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR'],
  /** Ver fotos e o modelo 3D. */
  'captures.read': SEES_PHOTOS,
  'simulations.read': SEES_PHOTOS,
  'simulations.write': CLINICAL,
  'simulations.export': CLINICAL,
  'reports.generate': CLINICAL,
  'members.read': MANAGEMENT,
  'members.manage': MANAGEMENT,
  /** Convidar, rebaixar ou remover donas e transferir a titularidade. */
  'members.manage_owner': ['OWNER'],
  'clinic.manage': MANAGEMENT,
  /** Retenção e exclusão de dados da clínica. */
  'clinic.retention': ['OWNER'],
  'audit.read': MANAGEMENT,
} as const satisfies Record<string, readonly ClinicRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: ClinicRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly ClinicRole[]).includes(role);
}

/**
 * Quem pode mexer em quem. Dona mexe em qualquer um; gerente mexe em todos, menos em donas, e
 * não concede papel acima do dele; os demais papéis não gerenciam equipe.
 */
export function canManageMember(actor: ClinicRole, targetCurrent: ClinicRole): boolean {
  if (actor === 'OWNER') return true;
  return can(actor, 'members.manage') && targetCurrent !== 'OWNER';
}

export function canAssignRole(actor: ClinicRole, newRole: ClinicRole): boolean {
  if (actor === 'OWNER') return true;
  return can(actor, 'members.manage') && newRole !== 'OWNER';
}
