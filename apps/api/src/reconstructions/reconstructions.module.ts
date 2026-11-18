import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import type { Reconstruction } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ReconstructionQueue } from './reconstruction-queue.js';
import { toReconstruction } from './reconstruction-mapper.js';

@Injectable()
export class ReconstructionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async findOwned(clinicId: string, id: string) {
    const r = await this.prisma.reconstruction.findFirst({ where: { id, clinicId } });
    if (!r) throw new NotFoundException('Reconstrução não encontrada');
    return r;
  }

  async get(me: AuthContext, id: string): Promise<Reconstruction> {
    const r = await this.findOwned(me.clinicId, id);
    let meshUrl: string | null = null;
    if (r.status === 'DONE' && r.meshKey) {
      meshUrl = await this.storage.presign(r.meshKey, { method: 'GET' });
      await this.audit.log(me, 'MESH_DOWNLOAD', 'reconstruction', id);
    }
    return toReconstruction(r, meshUrl);
  }
}

@Controller('reconstructions')
export class ReconstructionsController {
  constructor(private readonly reconstructions: ReconstructionsService) {}

  @Get(':id')
  @RequirePermission('patients.read')
  get(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reconstructions.get(me, id);
  }
}

@Module({
  controllers: [ReconstructionsController],
  providers: [ReconstructionsService, ReconstructionQueue],
  exports: [ReconstructionsService, ReconstructionQueue],
})
export class ReconstructionsModule {}
