import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../common/auth-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Apaga DE FATO os dados biométricos de um paciente: fotos, malhas, miniaturas e
 * simulações (arquivos no storage e linhas no banco). Disparado pela exclusão do
 * paciente e pela revogação do consentimento obrigatório.
 *
 * O registro do termo (quem assinou, quando, revogação) é mantido como prova.
 */
@Injectable()
export class BiometricPurgeService {
  private readonly logger = new Logger(BiometricPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async purgePatient(
    actor: Pick<AuthContext, 'clinicId' | 'ip'> & { userId: string | null },
    patientId: string,
    action: 'BIOMETRIC_PURGE' | 'RETENTION_PURGE' = 'BIOMETRIC_PURGE',
  ): Promise<{ files: number; captures: number }> {
    const captures = await this.prisma.captureSession.findMany({
      where: { patientId, clinicId: actor.clinicId },
      select: {
        id: true,
        photos: { select: { storageKey: true } },
        reconstructions: {
          select: {
            meshKey: true,
            simulations: { select: { versions: { select: { thumbnailKey: true, meshKey: true } } } },
          },
        },
      },
    });

    const keys = captures.flatMap((c) => [
      ...c.photos.map((p) => p.storageKey),
      ...c.reconstructions.flatMap((r) => [
        r.meshKey,
        ...r.simulations.flatMap((s) => s.versions.flatMap((v) => [v.thumbnailKey, v.meshKey])),
      ]),
    ]).filter((k): k is string => !!k);

    // Arquivos primeiro: se o storage falhar, nada é apagado do banco e dá pra repetir.
    for (const key of keys) await this.storage.delete(key);

    await this.prisma.$transaction(async (tx) => {
      await tx.captureSession.deleteMany({ where: { patientId, clinicId: actor.clinicId } });
      await this.audit.log(actor, action, 'patient', patientId, tx);
    });

    this.logger.log(`Biométricos do paciente ${patientId} apagados (${keys.length} arquivos)`);
    return { files: keys.length, captures: captures.length };
  }
}

@Global()
@Module({ providers: [BiometricPurgeService], exports: [BiometricPurgeService] })
export class BiometricsModule {}
