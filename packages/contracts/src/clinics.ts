import { z } from 'zod';
import { optionalText } from './common.js';

export interface Clinic {
  id: string;
  name: string;
  cnpj: string | null;
  /** Dias de retenção de fotos e malhas após a última atividade do paciente. */
  retentionDays: number;
  createdAt: string;
  /** A clínica tem logo enviado (buscar em GET /clinic/logo). */
  hasLogo: boolean;
}

/** Logo: PNG ou JPEG, até 400 KB. */
export const LOGO_MAX_BYTES = 400 * 1024;
export const LogoUpload = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Envie uma imagem PNG ou JPEG').max(700_000),
});
export type LogoUpload = z.infer<typeof LogoUpload>;

export const ClinicUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  cnpj: optionalText(18),
  retentionDays: z.number().int().min(30).max(3650).optional(),
});
export type ClinicUpdate = z.infer<typeof ClinicUpdate>;
