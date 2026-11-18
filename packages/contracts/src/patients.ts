import { z } from 'zod';
import { optional, optionalText, PageQuery } from './common.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Dados mínimos do paciente (minimização LGPD): só o nome é obrigatório. */
export const PatientCreate = z.object({
  name: z.string().trim().min(2, 'Informe o nome (mín. 2 letras)').max(120),
  internalCode: optionalText(40),
  phone: optional(
    z
      .string()
      .trim()
      .regex(/^[+()\d\s-]{8,20}$/, 'Telefone inválido'),
  ),
  birthDate: optional(
    z.iso.date('Data inválida').refine((d) => d <= today(), 'A data não pode estar no futuro'),
  ),
  notes: optionalText(2000),
});
export type PatientCreate = z.infer<typeof PatientCreate>;

/** Na edição, `null` apaga um campo opcional. */
export const PatientUpdate = z.object({
  name: PatientCreate.shape.name.optional(),
  internalCode: PatientCreate.shape.internalCode.nullable(),
  phone: PatientCreate.shape.phone.nullable(),
  birthDate: PatientCreate.shape.birthDate.nullable(),
  notes: PatientCreate.shape.notes.nullable(),
});
export type PatientUpdate = z.infer<typeof PatientUpdate>;

export const PatientListQuery = PageQuery.extend({
  search: optionalText(120),
  /** `active` = com termo obrigatório ativo; `pending` = sem termo ou revogado. */
  consent: optional(z.enum(['active', 'pending'])),
  /** Cadastrados a partir desta data (AAAA-MM-DD), inclusive. */
  createdFrom: optional(z.iso.date()),
  /** Cadastrados até esta data (AAAA-MM-DD), inclusive. */
  createdTo: optional(z.iso.date()),
  /** Pacientes que esta pessoa da equipe já capturou ou simulou. */
  professionalId: optional(z.uuid()),
});
export type PatientListQuery = z.infer<typeof PatientListQuery>;

export type ConsentState = 'ACTIVE' | 'REVOKED' | 'NONE';

export interface Patient {
  id: string;
  name: string;
  internalCode: string | null;
  phone: string | null;
  birthDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Situação do consentimento obrigatório (escopo SIMULATION). */
  consentState: ConsentState;
}
