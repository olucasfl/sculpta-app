import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ExportLog,
  SimulationCreate,
  SimulationParams,
  SimulationVersionCreate,
  type Simulation,
  type SimulationSummary,
} from '@sim/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PatientsModule } from '../patients/patients.module.js';
import { PatientsService } from '../patients/patients.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReconstructionsModule, ReconstructionsService } from '../reconstructions/reconstructions.module.js';
import { StorageService, storageKeys } from '../storage/storage.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG = Buffer.from([0xff, 0xd8, 0xff]);

@Injectable()
export class SimulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly reconstructions: ReconstructionsService,
  ) {}

  private async findOwned(clinicId: string, id: string) {
    const s = await this.prisma.simulation.findFirst({ where: { id, clinicId } });
    if (!s) throw new NotFoundException('Simulação não encontrada');
    return s;
  }

  async create(me: AuthContext, reconstructionId: string, input: SimulationCreate): Promise<Simulation> {
    const r = await this.reconstructions.findOwned(me.clinicId, reconstructionId);
    if (r.status !== 'DONE') throw new ConflictException('O modelo 3D ainda não está pronto');
    const s = await this.prisma.$transaction(async (tx) => {
      const created = await tx.simulation.create({
        data: { clinicId: me.clinicId, patientId: r.patientId, reconstructionId, createdById: me.userId, name: input.name },
      });
      await this.audit.log(me, 'SIMULATION_CREATE', 'simulation', created.id, tx);
      return created;
    });
    return this.get(me, s.id);
  }

  async list(clinicId: string, patientId?: string): Promise<SimulationSummary[]> {
    if (patientId) await this.patients.findOwned(clinicId, patientId);
    const rows = await this.prisma.simulation.findMany({
      where: { clinicId, ...(patientId ? { patientId } : {}) },
      include: { versions: { select: { createdAt: true }, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const names = await this.patientNames(clinicId, rows.map((r) => r.patientId));
    return rows
      .filter((r) => names.has(r.patientId))
      .map((r) => ({
        id: r.id,
        reconstructionId: r.reconstructionId,
        patientId: r.patientId,
        patientName: names.get(r.patientId)!,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        versionCount: r.versions.length,
        lastVersionAt: r.versions[0]?.createdAt.toISOString() ?? null,
      }));
  }

  async get(me: AuthContext, id: string): Promise<Simulation> {
    const s = await this.findOwned(me.clinicId, id);
    const versions = await this.prisma.simulationVersion.findMany({ where: { simulationId: id }, orderBy: { createdAt: 'desc' } });
    const userIds = [...new Set([s.createdById, ...versions.map((v) => v.createdById)])];
    const users = new Map(
      (await this.prisma.user.findMany({ where: { clinicId: me.clinicId, id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u]),
    );
    const who = (uid: string) => users.get(uid) ?? { id: uid, name: '—' };
    const patient = await this.patients.findOwned(me.clinicId, s.patientId);
    return {
      id: s.id,
      reconstructionId: s.reconstructionId,
      patientId: s.patientId,
      patientName: patient.name,
      name: s.name,
      createdAt: s.createdAt.toISOString(),
      createdBy: who(s.createdById),
      versions: await Promise.all(
        versions.map(async (v) => ({
          id: v.id,
          name: v.name,
          description: v.description,
          params: SimulationParams.catch({}).parse(v.params),
          createdAt: v.createdAt.toISOString(),
          createdBy: who(v.createdById),
          thumbnailUrl: v.thumbnailKey ? await this.storage.presign(v.thumbnailKey, { method: 'GET' }) : null,
        })),
      ),
    };
  }

  async saveVersion(me: AuthContext, id: string, input: SimulationVersionCreate): Promise<Simulation> {
    const s = await this.findOwned(me.clinicId, id);
    const versionId = randomUUID();
    let thumbnailKey: string | null = null;
    if (input.thumbnailDataUrl) {
      const isPng = input.thumbnailDataUrl.startsWith('data:image/png');
      const buf = Buffer.from(input.thumbnailDataUrl.split(',')[1] ?? '', 'base64');
      if (!buf.subarray(0, isPng ? 4 : 3).equals(isPng ? PNG : JPG)) throw new BadRequestException('Miniatura inválida');
      thumbnailKey = storageKeys.thumbnail(me.clinicId, id, versionId, isPng ? 'png' : 'jpg');
      await this.storage.put(thumbnailKey, buf, isPng ? 'image/png' : 'image/jpeg');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.simulationVersion.create({
        data: {
          id: versionId,
          simulationId: id,
          name: input.name,
          description: input.description ?? null,
          params: input.params,
          thumbnailKey,
          createdById: me.userId,
        },
      });
      await tx.patient.update({ where: { id: s.patientId }, data: { lastActivityAt: new Date() } });
      await this.audit.log(me, 'SIMULATION_VERSION_SAVE', 'simulation', id, tx);
    });
    return this.get(me, id);
  }

  async logExport(me: AuthContext, id: string, _input: ExportLog) {
    await this.findOwned(me.clinicId, id);
    await this.audit.log(me, 'SIMULATION_EXPORT', 'simulation', id);
  }

  private async patientNames(clinicId: string, ids: string[]) {
    const rows = await this.prisma.patient.findMany({
      where: { clinicId, id: { in: [...new Set(ids)] }, deletedAt: null },
      select: { id: true, name: true },
    });
    return new Map(rows.map((p) => [p.id, p.name]));
  }
}

const ListQuery = z.object({ patientId: z.uuid().optional() });

@Controller()
export class SimulationsController {
  constructor(private readonly simulations: SimulationsService) {}

  @Post('reconstructions/:id/simulations')
  @RequirePermission('simulations.write')
  create(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SimulationCreate)) body: SimulationCreate,
  ) {
    return this.simulations.create(me, id, body);
  }

  @Get('simulations')
  @RequirePermission('patients.read')
  list(@CurrentUser() me: AuthContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.simulations.list(me.clinicId, q.patientId);
  }

  @Get('simulations/:id')
  @RequirePermission('patients.read')
  get(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.simulations.get(me, id);
  }

  @Post('simulations/:id/versions')
  @RequirePermission('simulations.write')
  saveVersion(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SimulationVersionCreate)) body: SimulationVersionCreate,
  ) {
    return this.simulations.saveVersion(me, id, body);
  }

  @Post('simulations/:id/export-log')
  @HttpCode(204)
  @RequirePermission('simulations.export')
  async logExport(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ExportLog)) body: ExportLog,
  ) {
    await this.simulations.logExport(me, id, body);
  }
}

@Module({
  imports: [PatientsModule, ReconstructionsModule],
  controllers: [SimulationsController],
  providers: [SimulationsService],
})
export class SimulationsModule {}
