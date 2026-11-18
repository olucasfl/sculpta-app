import type { Reconstruction, ReconstructionError } from '@sim/contracts';
import type { Reconstruction as Row } from '../generated/prisma/client.js';

export const toReconstructionSummary = (r: Row) => ({
  id: r.id,
  status: r.status,
  source: r.source,
  qualityScore: r.qualityScore,
  createdAt: r.createdAt.toISOString(),
});

export function toReconstruction(r: Row, meshUrl: string | null): Reconstruction {
  return {
    id: r.id,
    captureId: r.captureId,
    patientId: r.patientId,
    status: r.status,
    source: r.source,
    qualityScore: r.qualityScore,
    error: (r.error as ReconstructionError | null) ?? null,
    errorDetail: r.errorDetail,
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    meshUrl,
  };
}
