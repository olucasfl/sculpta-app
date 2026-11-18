import { z } from 'zod';
import { ClinicRole } from './roles.js';

export const INVITATION_TTL_DAYS = 7;

export const InvitationCreate = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido')),
  role: ClinicRole,
});
export type InvitationCreate = z.infer<typeof InvitationCreate>;

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: string;
  email: string;
  role: ClinicRole;
  /** `PENDING` já vencido aparece como `EXPIRED`. */
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string } | null;
}
