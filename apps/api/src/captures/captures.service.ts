import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PHOTO_MAX_BYTES,
  PhotoAngle,
  type CapturePhoto,
  type CaptureSession,
  type CaptureSummary,
  type PhotoRegister,
  type Reconstruction,
  type UploadTarget,
} from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../common/auth-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ConsentsService } from '../consents/consents.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PatientsService } from '../patients/patients.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toReconstructionSummary } from '../reconstructions/reconstruction-mapper.js';
import { StorageService, storageKeys } from '../storage/storage.service.js';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const include = {
  photos: true,
  reconstructions: { orderBy: { createdAt: 'desc' } },
} as const satisfies Prisma.CaptureSessionInclude;

type SessionRow = Prisma.CaptureSessionGetPayload<{ include: typeof include }>;

@Injectable()
export class CapturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsService,
    private readonly consents: ConsentsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Única porta de entrada para uma sessão: sempre filtra pela clínica do token. */
  private async findOwned(clinicId: string, id: string) {
    const s = await this.prisma.captureSession.findFirst({ where: { id, clinicId }, include });
    if (!s) throw new NotFoundException('Sessão de captura não encontrada');
    return s;
  }

  private assertOpen(s: { status: string }) {
    if (s.status !== 'OPEN') throw new ConflictException('Esta sessão de captura já foi encerrada');
  }

  async create(me: AuthContext, patientId: string): Promise<CaptureSession> {
    await this.patients.findOwned(me.clinicId, patientId);
    await this.consents.assertActive(me.clinicId, patientId);
    const s = await this.prisma.$transaction(async (tx) => {
      const created = await tx.captureSession.create({
        data: { clinicId: me.clinicId, patientId, capturedById: me.userId },
        include,
      });
      await this.audit.log(me, 'CAPTURE_CREATE', 'capture', created.id, tx);
      return created;
    });
    return this.toSession(s);
  }

  async listForPatient(clinicId: string, patientId: string): Promise<CaptureSummary[]> {
    await this.patients.findOwned(clinicId, patientId);
    const rows = await this.prisma.captureSession.findMany({
      where: { clinicId, patientId },
      include: { _count: { select: { photos: true } }, reconstructions: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      photoCount: r._count.photos,
      reconstructions: r.reconstructions.map(toReconstructionSummary),
    }));
  }

  async get(me: AuthContext, id: string): Promise<CaptureSession> {
    const s = await this.findOwned(me.clinicId, id);
    if (s.photos.length > 0) await this.audit.log(me, 'PHOTO_VIEW', 'capture', id);
    return this.toSession(s);
  }

  /** URL de upload direto ao storage para uma vista. A API não recebe a foto. */
  async uploadTarget(me: AuthContext, id: string, angle: PhotoAngle): Promise<UploadTarget> {
    const s = await this.findOwned(me.clinicId, id);
    this.assertOpen(s);
    await this.consents.assertActive(me.clinicId, s.patientId);
    const key = storageKeys.photo(me.clinicId, id, angle);
    const ttl = this.config.S3_PRESIGN_TTL_SECONDS;
    return {
      angle,
      key,
      method: 'PUT',
      url: await this.storage.presign(key, { method: 'PUT', contentType: 'image/jpeg', ttl }),
      headers: { 'Content-Type': 'image/jpeg' },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /** Registra a foto depois do upload: confere chave, tamanho e formato JPEG. */
  async registerPhoto(me: AuthContext, id: string, angle: PhotoAngle, input: PhotoRegister): Promise<CaptureSession> {
    const s = await this.findOwned(me.clinicId, id);
    this.assertOpen(s);
    await this.consents.assertActive(me.clinicId, s.patientId);

    if (!input.key.startsWith(storageKeys.photoPrefix(me.clinicId, id, angle))) {
      throw new BadRequestException({ code: 'INVALID_KEY', message: 'Chave de upload não pertence a esta vista' });
    }
    const head = await this.storage.head(input.key);
    if (!head) throw new BadRequestException({ code: 'UPLOAD_MISSING', message: 'O arquivo não chegou ao storage' });
    if (head.size > PHOTO_MAX_BYTES) {
      await this.storage.delete(input.key);
      throw new BadRequestException({ code: 'UPLOAD_TOO_LARGE', message: 'Foto grande demais' });
    }
    const bytes = await this.storage.get(input.key);
    if (!bytes || !bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
      await this.storage.delete(input.key);
      throw new BadRequestException({ code: 'UPLOAD_NOT_JPEG', message: 'A foto precisa estar em JPEG' });
    }
    if (input.landmarks && angle !== 'FRONT') {
      throw new BadRequestException('Landmarks só são guardados na vista frontal');
    }

    const previous = s.photos.find((p) => p.angle === angle);
    const data = {
      storageKey: input.key,
      width: input.width,
      height: input.height,
      yawDeg: input.yawDeg,
      sharpness: input.sharpness,
      faceDetected: input.faceDetected,
      faceHeightRatio: input.faceHeightRatio,
      validation: input.validation,
      source: input.source,
      landmarks: input.landmarks ?? undefined,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.photo.upsert({
        where: { captureId_angle: { captureId: id, angle } },
        create: { captureId: id, angle, ...data },
        update: { ...data, createdAt: new Date() },
      });
      await this.audit.log(me, 'PHOTO_UPLOAD', 'capture', id, tx);
    });
    if (previous && previous.storageKey !== input.key) await this.storage.delete(previous.storageKey);
    return this.toSession(await this.findOwned(me.clinicId, id));
  }

  async deletePhoto(me: AuthContext, id: string, angle: PhotoAngle): Promise<CaptureSession> {
    const s = await this.findOwned(me.clinicId, id);
    this.assertOpen(s);
    const photo = s.photos.find((p) => p.angle === angle);
    if (!photo) throw new NotFoundException('Foto não encontrada');
    await this.storage.delete(photo.storageKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.photo.delete({ where: { id: photo.id } });
      await this.audit.log(me, 'PHOTO_DELETE', 'capture', id, tx);
    });
    return this.toSession(await this.findOwned(me.clinicId, id));
  }

  /** Fecha a sessão e enfileira a reconstrução. */
  async complete(me: AuthContext, id: string): Promise<Reconstruction> {
    const s = await this.findOwned(me.clinicId, id);
    this.assertOpen(s);
    await this.consents.assertActive(me.clinicId, s.patientId);
    const missing = PhotoAngle.options.filter((a) => !s.photos.some((p) => p.angle === a));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'PHOTOS_MISSING',
        message: 'Faltam vistas para concluir a captura',
        details: missing.map((a) => ({ path: a, message: 'Foto ausente' })),
      });
    }
    const rec = await this.prisma.$transaction(async (tx) => {
      await tx.captureSession.update({ where: { id }, data: { status: 'COMPLETED' } });
      await tx.patient.update({ where: { id: s.patientId }, data: { lastActivityAt: new Date() } });
      const r = await tx.reconstruction.create({
        data: {
          clinicId: me.clinicId,
          patientId: s.patientId,
          captureId: id,
          source: this.config.WORKER_URL ? 'VGGTFACE' : 'TEMPLATE',
        },
      });
      await this.audit.log(me, 'CAPTURE_COMPLETE', 'capture', id, tx);
      return r;
    });
    return {
      id: rec.id,
      captureId: id,
      patientId: s.patientId,
      status: rec.status,
      source: rec.source,
      qualityScore: null,
      error: null,
      errorDetail: null,
      attempts: 0,
      createdAt: rec.createdAt.toISOString(),
      finishedAt: null,
      meshUrl: null,
    };
  }

  /** Cancelar apaga as fotos já enviadas (minimização). */
  async cancel(me: AuthContext, id: string) {
    const s = await this.findOwned(me.clinicId, id);
    this.assertOpen(s);
    for (const p of s.photos) await this.storage.delete(p.storageKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.photo.deleteMany({ where: { captureId: id } });
      await tx.captureSession.update({ where: { id }, data: { status: 'CANCELED' } });
      await this.audit.log(me, 'CAPTURE_CANCEL', 'capture', id, tx);
    });
  }

  private async toSession(s: SessionRow): Promise<CaptureSession> {
    const user = await this.prisma.user.findUnique({ where: { id: s.capturedById }, select: { id: true, name: true } });
    const photos: CapturePhoto[] = await Promise.all(
      [...s.photos]
        .sort((a, b) => PhotoAngle.options.indexOf(a.angle) - PhotoAngle.options.indexOf(b.angle))
        .map(async (p) => ({
          id: p.id,
          angle: p.angle,
          width: p.width,
          height: p.height,
          yawDeg: p.yawDeg,
          sharpness: p.sharpness,
          faceDetected: p.faceDetected,
          validation: p.validation,
          createdAt: p.createdAt.toISOString(),
          url: await this.storage.presign(p.storageKey, { method: 'GET' }),
          ...(p.angle === 'FRONT' ? { landmarks: (p.landmarks as [number, number, number][] | null) ?? null } : {}),
        })),
    );
    return {
      id: s.id,
      patientId: s.patientId,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      capturedBy: user ?? { id: s.capturedById, name: '—' },
      photos,
      reconstructions: s.reconstructions.map(toReconstructionSummary),
    };
  }
}
