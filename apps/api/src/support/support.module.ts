import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SUPPORT_MAX_MINUTES, SupportAccessStart, type SupportAccessEntry } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import {
  CurrentAccount,
  CurrentUser,
  PlatformOnly,
  RequirePermission,
  type AccountContext,
  type AuthContext,
} from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * MODO SUPORTE (docs/CONTAS-CLINICAS-PERMISSOES.md, 4.8): o administrador da plataforma só entra nos
 * dados de uma clínica com MOTIVO escrito e por tempo limitado, em modo SOMENTE LEITURA, e a janela fica na
 * auditoria da clínica, visível à dona. O guard (common/guards.ts) é quem aplica a janela e o somente-leitura.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async start(admin: AccountContext, input: SupportAccessStart): Promise<SupportAccessEntry> {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { id: true, status: true } });
    if (!clinic) throw new NotFoundException('Clínica não encontrada');
    if (clinic.status === 'DELETED') throw new BadRequestException('Clínica já expurgada');
    const row = await this.prisma.$transaction(async (tx) => {
      // Uma janela aberta por vez por administrador e clínica: a anterior é encerrada.
      await tx.supportAccess.updateMany({
        where: { adminId: admin.userId, clinicId: clinic.id, endedAt: null, expiresAt: { gt: new Date() } },
        data: { endedAt: new Date() },
      });
      const s = await tx.supportAccess.create({
        data: {
          adminId: admin.userId,
          clinicId: clinic.id,
          reason: input.reason,
          expiresAt: new Date(Date.now() + input.minutes * 60_000),
        },
      });
      await this.audit.log({ clinicId: clinic.id, userId: admin.userId, ip: admin.ip }, 'SUPPORT_START', 'support_access', s.id, tx);
      return s;
    });
    return (await this.listFor(clinic.id)).find((e) => e.id === row.id)!;
  }

  async end(admin: AccountContext, id: string): Promise<void> {
    const s = await this.prisma.supportAccess.findFirst({ where: { id, adminId: admin.userId } });
    if (!s) throw new NotFoundException('Janela de suporte não encontrada');
    if (s.endedAt) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.supportAccess.update({ where: { id }, data: { endedAt: new Date() } });
      await this.audit.log({ clinicId: s.clinicId, userId: admin.userId, ip: admin.ip }, 'SUPPORT_END', 'support_access', id, tx);
    });
  }

  /** Janelas de suporte de uma clínica, para a dona ver quem entrou, quando e por quê. */
  async listFor(clinicId: string): Promise<SupportAccessEntry[]> {
    const rows = await this.prisma.supportAccess.findMany({ where: { clinicId }, orderBy: { startedAt: 'desc' }, take: 100 });
    const admins = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } },
      select: { id: true, name: true },
    });
    const name = new Map(admins.map((a) => [a.id, a.name]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      admin: { id: r.adminId, name: name.get(r.adminId) ?? '—' },
      reason: r.reason,
      startedAt: r.startedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      active: !r.endedAt && r.expiresAt > now,
    }));
  }
}

@Controller('platform/support-access')
@PlatformOnly()
export class PlatformSupportController {
  constructor(private readonly support: SupportService) {}

  /** Abre a janela. O motivo é obrigatório; a duração tem teto (SUPPORT_MAX_MINUTES). */
  @Post()
  start(@CurrentAccount() me: AccountContext, @Body(new ZodPipe(SupportAccessStart)) body: SupportAccessStart) {
    return this.support.start(me, body);
  }

  @Delete(':id')
  @HttpCode(204)
  end(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.end(me, id);
  }
}

@Controller('clinic/support-access')
export class ClinicSupportController {
  constructor(private readonly support: SupportService) {}

  /** Quem do suporte da plataforma entrou na clínica (visível à dona e à gerência). */
  @Get()
  @RequirePermission('audit.read')
  list(@CurrentUser() me: AuthContext) {
    return this.support.listFor(me.clinicId);
  }
}

export { SUPPORT_MAX_MINUTES };

@Module({
  controllers: [PlatformSupportController, ClinicSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
