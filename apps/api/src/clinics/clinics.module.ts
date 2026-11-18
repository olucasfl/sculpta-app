import { Body, Controller, Get, Injectable, Module, Patch } from '@nestjs/common';
import { ClinicUpdate, type Clinic } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(clinicId: string): Promise<Clinic> {
    const c = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    return { id: c.id, name: c.name, cnpj: c.cnpj, retentionDays: c.retentionDays, createdAt: c.createdAt.toISOString() };
  }

  async update(me: AuthContext, input: ClinicUpdate): Promise<Clinic> {
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id: me.clinicId }, data: input });
      await this.audit.log(me, 'CLINIC_UPDATE', 'clinic', me.clinicId, tx);
    });
    return this.get(me.clinicId);
  }
}

@Controller('clinic')
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  @Get()
  get(@CurrentUser() me: AuthContext) {
    return this.clinics.get(me.clinicId);
  }

  @Patch()
  @RequirePermission('clinic.manage')
  update(@CurrentUser() me: AuthContext, @Body(new ZodPipe(ClinicUpdate)) body: ClinicUpdate) {
    return this.clinics.update(me, body);
  }
}

@Module({ controllers: [ClinicsController], providers: [ClinicsService] })
export class ClinicsModule {}
