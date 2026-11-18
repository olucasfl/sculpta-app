import { z } from 'zod';
import { optionalText } from './common.js';

export interface Clinic {
  id: string;
  name: string;
  cnpj: string | null;
  /** Dias de retenção de fotos e malhas após a última atividade do paciente. */
  retentionDays: number;
  createdAt: string;
}

export const ClinicUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  cnpj: optionalText(18),
  retentionDays: z.number().int().min(30).max(3650).optional(),
});
export type ClinicUpdate = z.infer<typeof ClinicUpdate>;
