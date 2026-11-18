import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasActiveSimulationConsent, type Consent, type ConsentCreate } from '@sim/contracts';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { BiometricPurgeService } from '../biometrics/biometric-purge.service.js';
import type { AuthContext } from '../common/auth-context.js';
import { PatientsService } from '../patients/patients.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, storageKeys } from '../storage/storage.service.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodeSignature(dataUrl: string): Buffer {
  const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (buf.length < 64 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'Assinatura inválida' });
  }
  return buf;
}

@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly purge: BiometricPurgeService,
  ) {}

  async list(clinicId: string, patientId: string): Promise<Consent[]> {
    await this.patients.findOwned(clinicId, patientId);
    const rows = await this.prisma.consent.findMany({
      where: { clinicId, patientId },
      orderBy: { signedAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { clinicId, id: { in: [...new Set(rows.map((r) => r.collectedById))] } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      termVersion: r.termVersion,
      scopes: r.scopes,
      signerName: r.signerName,
      signerRelation: r.signerRelation,
      signedAt: r.signedAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      collectedBy: byId.get(r.collectedById) ?? { id: r.collectedById, name: '—' },
    }));
  }

  /** Bloqueio usado pela captura (Fase 2): sem termo ativo, nada de fotos. */
  async assertActive(clinicId: string, patientId: string) {
    const consents = await this.prisma.consent.findMany({
      where: { clinicId, patientId },
      select: { scopes: true, revokedAt: true },
    });
    const list = consents.map((c) => ({ scopes: c.scopes, revokedAt: c.revokedAt?.toISOString() ?? null }));
    if (!hasActiveSimulationConsent(list)) {
      throw new ForbiddenException({ code: 'CONSENT_REQUIRED', message: 'Paciente sem termo de consentimento ativo' });
    }
  }

  async sign(me: AuthContext, patientId: string, input: ConsentCreate, userAgent: string | null) {
    await this.patients.findOwned(me.clinicId, patientId);
    const png = decodeSignature(input.signatureDataUrl);
    const id = randomUUID();
    const signatureKey = storageKeys.consentSignature(me.clinicId, id);

    await this.storage.put(signatureKey, png, 'image/png');
    try {
      await this.prisma.$transaction(async (tx) => {
        // Um termo ativo por vez: o novo substitui o anterior (ex.: mudar os opcionais).
        await tx.consent.updateMany({
          where: { clinicId: me.clinicId, patientId, revokedAt: null },
          data: { revokedAt: new Date(), revokedById: me.userId },
        });
        await tx.consent.create({
          data: {
            id,
            clinicId: me.clinicId,
            patientId,
            termVersion: input.termVersion,
            scopes: input.scopes,
            signerName: input.signerName,
            signerRelation: input.signerRelation,
            signatureKey,
            ip: me.ip,
            userAgent: userAgent?.slice(0, 300) ?? null,
            collectedById: me.userId,
          },
        });
        await this.audit.log(me, 'CONSENT_SIGN', 'consent', id, tx);
      });
    } catch (e) {
      await this.storage.delete(signatureKey);
      throw e;
    }
    const all = await this.list(me.clinicId, patientId);
    return all.find((c) => c.id === id)!;
  }

  /**
   * Revoga o termo. Se não sobrar termo ativo com o escopo obrigatório,
   * os biométricos do paciente são apagados na hora.
   */
  async revoke(me: AuthContext, consentId: string) {
    const consent = await this.prisma.consent.findFirst({ where: { id: consentId, clinicId: me.clinicId } });
    if (!consent) throw new NotFoundException('Termo não encontrado');
    if (consent.revokedAt) throw new ConflictException('Termo já revogado');

    await this.prisma.$transaction(async (tx) => {
      await tx.consent.update({
        where: { id: consentId },
        data: { revokedAt: new Date(), revokedById: me.userId },
      });
      await this.audit.log(me, 'CONSENT_REVOKE', 'consent', consentId, tx);
    });

    const remaining = await this.prisma.consent.findMany({
      where: { clinicId: me.clinicId, patientId: consent.patientId },
      select: { scopes: true, revokedAt: true },
    });
    const stillActive = hasActiveSimulationConsent(
      remaining.map((c) => ({ scopes: c.scopes, revokedAt: c.revokedAt?.toISOString() ?? null })),
    );
    const purged = stillActive ? null : await this.purge.purgePatient(me, consent.patientId);
    return { revoked: true, biometricsPurged: purged !== null };
  }

  async signature(me: AuthContext, consentId: string): Promise<Buffer> {
    const consent = await this.prisma.consent.findFirst({ where: { id: consentId, clinicId: me.clinicId } });
    if (!consent?.signatureKey) throw new NotFoundException('Assinatura não encontrada');
    const png = await this.storage.get(consent.signatureKey);
    if (!png) throw new NotFoundException('Assinatura não encontrada');
    await this.audit.log(me, 'CONSENT_SIGNATURE_VIEW', 'consent', consentId);
    return png;
  }
}
