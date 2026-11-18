import {
  BadRequestException,
  Body,
  ConflictException,
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
  Query,
} from '@nestjs/common';
import {
  CLINIC_DELETION_GRACE_DAYS,
  INVITATION_TTL_DAYS,
  PageQuery,
  PlatformClinicCreate,
  PlatformClinicDeletion,
  type Paginated,
  type PlatformAccount,
  type PlatformClinic,
  type PlatformClinicDetail,
  type PlatformMetrics,
} from '@sim/contracts';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAccount, PlatformOnly, type AccountContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClinicPurgeService } from './clinic-purge.service.js';

const ListQuery = PageQuery.extend({ search: z.string().trim().max(120).optional() });
type ListQuery = z.infer<typeof ListQuery>;

const clinicInclude = {
  _count: { select: { memberships: { where: { status: 'ACTIVE' } }, patients: { where: { deletedAt: null } } } },
} as const satisfies Prisma.ClinicInclude;

type ClinicRow = Prisma.ClinicGetPayload<{ include: typeof clinicInclude }>;

/**
 * Console da plataforma (docs/CONTAS-CLINICAS-PERMISSOES.md, seções 3.1 e 4). Só administrador da plataforma.
 * Vê clínicas, contas, vínculos e contagens. NÃO lê dados de pacientes (nomes, fotos, modelos): isso
 * só existirá no "modo suporte", com motivo e auditoria (etapa 1B.7).
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async pendingInvites(clinicIds: string[]) {
    const rows = await this.prisma.invitation.groupBy({
      by: ['clinicId'],
      where: { clinicId: { in: clinicIds }, status: 'PENDING', expiresAt: { gt: new Date() } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.clinicId, r._count._all]));
  }

  private toClinic(c: ClinicRow, pending: number): PlatformClinic {
    return {
      id: c.id,
      name: c.name,
      cnpj: c.cnpj,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      deletionScheduledAt: c.deletionScheduledAt?.toISOString() ?? null,
      members: c._count.memberships,
      patients: c._count.patients,
      pendingInvitations: pending,
    };
  }

  async listClinics(q: ListQuery): Promise<Paginated<PlatformClinic>> {
    const where: Prisma.ClinicWhereInput = q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.clinic.findMany({ where, include: clinicInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.clinic.count({ where }),
    ]);
    const pending = await this.pendingInvites(rows.map((r) => r.id));
    return { items: rows.map((r) => this.toClinic(r, pending.get(r.id) ?? 0)), total, page: q.page, pageSize: q.pageSize };
  }

  async getClinic(id: string): Promise<PlatformClinicDetail> {
    const c = await this.prisma.clinic.findUnique({ where: { id }, include: clinicInclude });
    if (!c) throw new NotFoundException('Clínica não encontrada');
    const [members, invitations, pending] = await Promise.all([
      this.prisma.membership.findMany({
        where: { clinicId: id, status: { not: 'REMOVED' } },
        select: { role: true, status: true, user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
        orderBy: { user: { name: 'asc' } },
      }),
      this.prisma.invitation.findMany({ where: { clinicId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.pendingInvites([id]),
    ]);
    return {
      ...this.toClinic(c, pending.get(id) ?? 0),
      team: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        status: m.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status === 'PENDING' && i.expiresAt < new Date() ? 'EXPIRED' : i.status,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  /** Cria a clínica e já convida a dona pelo e-mail. */
  async createClinic(admin: AccountContext, input: PlatformClinicCreate): Promise<PlatformClinicDetail> {
    if (input.cnpj && (await this.prisma.clinic.findUnique({ where: { cnpj: input.cnpj }, select: { id: true } }))) {
      throw new ConflictException({ code: 'CNPJ_IN_USE', message: 'Já existe uma clínica com este CNPJ' });
    }
    const clinic = await this.prisma.$transaction(async (tx) => {
      const c = await tx.clinic.create({ data: { name: input.name, cnpj: input.cnpj, createdById: admin.userId } });
      await tx.invitation.create({
        data: {
          clinicId: c.id,
          email: input.ownerEmail,
          role: 'OWNER',
          invitedById: admin.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
        },
      });
      await this.audit.log({ clinicId: c.id, userId: admin.userId, ip: admin.ip }, 'CLINIC_CREATE', 'clinic', c.id, tx);
      return c;
    });
    return this.getClinic(clinic.id);
  }

  private async setStatus(admin: AccountContext, id: string, from: ('ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION' | 'DELETED')[], to: 'ACTIVE' | 'SUSPENDED', action: 'CLINIC_SUSPEND' | 'CLINIC_REACTIVATE') {
    const c = await this.prisma.clinic.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new NotFoundException('Clínica não encontrada');
    if (!from.includes(c.status)) throw new BadRequestException('Esta ação não vale para o estado atual da clínica');
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id }, data: { status: to, deletionScheduledAt: null } });
      await this.audit.log({ clinicId: id, userId: admin.userId, ip: admin.ip }, action, 'clinic', id, tx);
    });
    return this.getClinic(id);
  }

  suspend(admin: AccountContext, id: string) {
    return this.setStatus(admin, id, ['ACTIVE'], 'SUSPENDED', 'CLINIC_SUSPEND');
  }

  reactivate(admin: AccountContext, id: string) {
    return this.setStatus(admin, id, ['SUSPENDED'], 'ACTIVE', 'CLINIC_REACTIVATE');
  }

  /**
   * Agenda a exclusão: bloqueia a clínica e marca a data do expurgo (carência). O expurgo
   * automático AINDA NÃO existe: por ora a data é só um marcador e os dados são preservados.
   */
  async scheduleDeletion(admin: AccountContext, id: string, input: PlatformClinicDeletion) {
    const c = await this.prisma.clinic.findUnique({ where: { id }, select: { name: true, status: true } });
    if (!c) throw new NotFoundException('Clínica não encontrada');
    if (input.confirmName !== c.name) throw new BadRequestException({ code: 'CONFIRM_MISMATCH', message: 'Digite o nome da clínica exatamente como está' });
    if (c.status === 'DELETED') throw new BadRequestException('Esta clínica já foi expurgada');
    if (c.status === 'PENDING_DELETION') throw new BadRequestException('A exclusão já está agendada');
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({
        where: { id },
        data: { status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() + CLINIC_DELETION_GRACE_DAYS * 86_400_000) },
      });
      await this.audit.log({ clinicId: id, userId: admin.userId, ip: admin.ip }, 'CLINIC_DELETION_SCHEDULE', 'clinic', id, tx);
    });
    return this.getClinic(id);
  }

  async cancelDeletion(admin: AccountContext, id: string) {
    const c = await this.prisma.clinic.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new NotFoundException('Clínica não encontrada');
    if (c.status !== 'PENDING_DELETION') throw new BadRequestException('Não há exclusão agendada');
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id }, data: { status: 'ACTIVE', deletionScheduledAt: null } });
      await this.audit.log({ clinicId: id, userId: admin.userId, ip: admin.ip }, 'CLINIC_DELETION_CANCEL', 'clinic', id, tx);
    });
    return this.getClinic(id);
  }

  async listAccounts(q: ListQuery): Promise<Paginated<PlatformAccount>> {
    const where: Prisma.UserWhereInput = q.search
      ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, name: true, email: true, emailVerifiedAt: true, isPlatformAdmin: true, active: true, lastLoginAt: true, createdAt: true,
          memberships: { where: { status: { not: 'REMOVED' } }, select: { role: true, status: true, clinic: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: !!u.emailVerifiedAt,
        isPlatformAdmin: u.isPlatformAdmin,
        active: u.active,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        clinics: u.memberships.map((m) => ({ id: m.clinic.id, name: m.clinic.name, role: m.role, status: m.status })),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Suspender a CONTA corta todas as clínicas dela e derruba as sessões. */
  async setAccountActive(admin: AccountContext, id: string, active: boolean) {
    if (id === admin.userId) throw new BadRequestException('Você não pode suspender a própria conta');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!u) throw new NotFoundException('Conta não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { active } });
      if (!active) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ clinicId: null, userId: admin.userId, ip: admin.ip }, 'USER_UPDATE', 'user', id, tx);
    });
  }

  async metrics(): Promise<PlatformMetrics> {
    const now = new Date();
    const [byStatus, accounts, unverified, admins, patients, pending, recon] = await Promise.all([
      this.prisma.clinic.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerifiedAt: null } }),
      this.prisma.user.count({ where: { isPlatformAdmin: true } }),
      this.prisma.patient.count({ where: { deletedAt: null } }),
      this.prisma.invitation.count({ where: { status: 'PENDING', expiresAt: { gt: now } } }),
      this.prisma.reconstruction.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const n = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const r = (s: string) => recon.find((x) => x.status === s)?._count._all ?? 0;
    return {
      clinics: { total: byStatus.reduce((a, b) => a + b._count._all, 0), active: n('ACTIVE'), suspended: n('SUSPENDED'), pendingDeletion: n('PENDING_DELETION') },
      accounts: { total: accounts, unverified, platformAdmins: admins },
      patients,
      pendingInvitations: pending,
      reconstructions: { queued: r('QUEUED'), processing: r('PROCESSING'), failed: r('FAILED') },
    };
  }
}

@Controller('platform')
@PlatformOnly()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly purge: ClinicPurgeService,
  ) {}

  /** Expurga agora as clínicas cuja carência de exclusão já venceu (também roda sozinho, 1x por dia). */
  @Post('clinics/purge-due')
  @HttpCode(200)
  async purgeDue(@CurrentAccount() me: AccountContext) {
    return { purged: await this.purge.runDue(me.userId, me.ip) };
  }

  @Get('metrics')
  metrics() {
    return this.platform.metrics();
  }

  @Get('clinics')
  clinics(@Query(new ZodPipe(ListQuery)) q: ListQuery) {
    return this.platform.listClinics(q);
  }

  @Post('clinics')
  createClinic(@CurrentAccount() me: AccountContext, @Body(new ZodPipe(PlatformClinicCreate)) body: PlatformClinicCreate) {
    return this.platform.createClinic(me, body);
  }

  @Get('clinics/:id')
  clinic(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getClinic(id);
  }

  @Post('clinics/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.suspend(me, id);
  }

  @Post('clinics/:id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.reactivate(me, id);
  }

  @Post('clinics/:id/deletion')
  @HttpCode(200)
  schedule(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PlatformClinicDeletion)) body: PlatformClinicDeletion) {
    return this.platform.scheduleDeletion(me, id, body);
  }

  @Delete('clinics/:id/deletion')
  cancel(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.cancelDeletion(me, id);
  }

  @Get('accounts')
  accounts(@Query(new ZodPipe(ListQuery)) q: ListQuery) {
    return this.platform.listAccounts(q);
  }

  @Post('accounts/:id/suspend')
  @HttpCode(204)
  suspendAccount(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.setAccountActive(me, id, false);
  }

  @Post('accounts/:id/reactivate')
  @HttpCode(204)
  reactivateAccount(@CurrentAccount() me: AccountContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.setAccountActive(me, id, true);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService, ClinicPurgeService] })
export class PlatformModule {}
