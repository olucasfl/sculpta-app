import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { BiometricPurgeService } from '../biometrics/biometric-purge.service.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const DAY_MS = 86_400_000;

/**
 * Expurgo de clínica excluída (docs/CONTAS-CLINICAS-PERMISSOES.md, 4.9). Roda para clínicas em
 * PENDING_DELETION cuja carência acabou: apaga fotos, malhas, simulações e capturas (arquivos e banco),
 * anonimiza os cadastros dos pacientes, remove vínculos, convites e o logo, e marca a clínica como DELETED.
 *
 * Mantém (registro mínimo, a validar com o jurídico): o registro da clínica, os termos de consentimento
 * (prova do que foi aceito/revogado) e a auditoria.
 */
@Injectable()
export class ClinicPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Expurgo de clínica');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly biometrics: BiometricPurgeService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.RETENTION_ENABLED) return;
    this.timer = setInterval(() => void this.runDue().catch((e) => this.logger.error(e)), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Expurga todas as clínicas cuja carência venceu. Devolve os ids expurgados. */
  async runDue(actorUserId: string | null = null, ip: string | null = null): Promise<string[]> {
    const due = await this.prisma.clinic.findMany({
      where: { status: 'PENDING_DELETION', deletionScheduledAt: { lte: new Date() } },
      select: { id: true },
    });
    const done: string[] = [];
    for (const c of due) {
      await this.purgeClinic(c.id, actorUserId, ip);
      done.push(c.id);
    }
    return done;
  }

  async purgeClinic(clinicId: string, userId: string | null, ip: string | null) {
    const actor = { clinicId, userId, ip };
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoKey: true } });

    const patients = await this.prisma.patient.findMany({ where: { clinicId }, select: { id: true } });
    for (const p of patients) await this.biometrics.purgePatient(actor, p.id, 'BIOMETRIC_PURGE');
    if (clinic.logoKey) await this.storage.delete(clinic.logoKey);

    await this.prisma.$transaction(async (tx) => {
      // Cadastros viram registros anônimos (os termos ficam ligados a eles).
      await tx.patient.updateMany({
        where: { clinicId },
        data: { name: 'Paciente removido', internalCode: null, phone: null, birthDate: null, notes: null, deletedAt: new Date() },
      });
      await tx.membership.deleteMany({ where: { clinicId } });
      await tx.invitation.deleteMany({ where: { clinicId } });
      await tx.clinic.update({ where: { id: clinicId }, data: { status: 'DELETED', purgedAt: new Date(), logoKey: null } });
      await this.audit.log(actor, 'CLINIC_PURGE', 'clinic', clinicId, tx);
    });
    this.logger.log(`Clínica ${clinicId} expurgada (${patients.length} pacientes anonimizados)`);
  }
}
