import { z } from 'zod';
import { PhotoAngle, ReconstructionSource } from './captures.js';

/**
 * Contrato API → worker (planejamento §4 e doc técnico §7.2).
 * Autenticação: `X-Worker-Timestamp` (segundos) + `X-Worker-Signature` =
 * hex(HMAC-SHA256(WORKER_SECRET, `${timestamp}.${body}`)). Janela de 5 minutos.
 */
export const WORKER_SIGNATURE_HEADER = 'x-worker-signature';
export const WORKER_TIMESTAMP_HEADER = 'x-worker-timestamp';
export const WORKER_MAX_SKEW_SECONDS = 300;

export const ReconstructRequest = z.object({
  jobId: z.string(),
  photos: z.array(z.object({ angle: PhotoAngle, url: z.url() })).length(5),
  output: z.object({ meshUploadUrl: z.url() }),
});
export type ReconstructRequest = z.infer<typeof ReconstructRequest>;

export const ReconstructDone = z.object({
  jobId: z.string(),
  status: z.literal('DONE'),
  source: ReconstructionSource,
  metrics: z.object({
    durationMs: z.number(),
    vertices: z.number().int(),
    qualityScore: z.number().min(0).max(1).nullable(),
  }),
});

export const ReconstructFailed = z.object({
  jobId: z.string(),
  status: z.literal('FAILED'),
  code: z.enum(['FACE_NOT_FOUND', 'LOW_QUALITY', 'TIMEOUT', 'INTERNAL']),
  detail: z.string().optional(),
});

export const ReconstructResponse = z.discriminatedUnion('status', [ReconstructDone, ReconstructFailed]);
export type ReconstructResponse = z.infer<typeof ReconstructResponse>;
