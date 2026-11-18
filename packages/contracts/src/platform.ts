import { z } from 'zod';
import { optionalText } from './common.js';
import type { ClinicRole } from './roles.js';

/** Dias entre agendar a exclusão de uma clínica e o expurgo (cancelável durante a carência). */
export const CLINIC_DELETION_GRACE_DAYS = 30;

export type ClinicStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION' | 'DELETED';

/** Teto da janela de suporte. */
export const SUPPORT_MAX_MINUTES = 120;

/** Modo suporte: motivo escrito e duração limitada; só leitura (docs/CONTAS-CLINICAS-PERMISSOES.md, 4.8). */
export const SupportAccessStart = z.object({
  clinicId: z.uuid(),
  reason: z.string().trim().min(10, 'Explique o motivo (ao menos 10 caracteres)').max(500),
  minutes: z.number().int().min(5).max(SUPPORT_MAX_MINUTES).default(60),
});
export type SupportAccessStart = z.infer<typeof SupportAccessStart>;

export interface SupportAccessEntry {
  id: string;
  admin: { id: string; name: string };
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  active: boolean;
}

/** O administrador da plataforma cria a clínica e já convida a dona pelo e-mail. */
export const PlatformClinicCreate = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120),
  cnpj: optionalText(18),
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email('E-mail da dona inválido')),
});
export type PlatformClinicCreate = z.infer<typeof PlatformClinicCreate>;

/** Para agendar a exclusão é preciso digitar o nome da clínica. */
export const PlatformClinicDeletion = z.object({ confirmName: z.string().min(1) });
export type PlatformClinicDeletion = z.infer<typeof PlatformClinicDeletion>;

export interface PlatformClinic {
  id: string;
  name: string;
  cnpj: string | null;
  status: ClinicStatus;
  createdAt: string;
  deletionScheduledAt: string | null;
  members: number;
  patients: number;
  pendingInvitations: number;
}

export interface PlatformClinicDetail extends PlatformClinic {
  team: { userId: string; name: string; email: string; role: ClinicRole; status: 'ACTIVE' | 'SUSPENDED'; lastLoginAt: string | null }[];
  invitations: { id: string; email: string; role: ClinicRole; status: string; expiresAt: string }[];
}

export interface PlatformAccount {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  clinics: { id: string; name: string; role: ClinicRole; status: string }[];
}

export interface PlatformMetrics {
  clinics: { total: number; active: number; suspended: number; pendingDeletion: number };
  accounts: { total: number; unverified: number; platformAdmins: number };
  patients: number;
  pendingInvitations: number;
  reconstructions: { queued: number; processing: number; failed: number };
}
