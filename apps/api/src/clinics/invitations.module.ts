import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { canAssignRole, INVITATION_TTL_DAYS, InvitationCreate, type Invitation } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const expiry = () => new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

/**
 * Convite por e-mail (docs/CONTAS-CLINICAS-PERMISSOES.md, 4.3). O convite não manda e-mail: quem convida
 * avisa a pessoa, que cria a conta (ou entra) com ESTE e-mail e cai na clínica sozinha.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(clinicId: string): Promise<Invitation[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { clinicId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const inviterIds = [...new Set(rows.map((r) => r.invitedById))];
    const inviters = await this.prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true } });
    const nameOf = new Map(inviters.map((u) => [u.id, u.name]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: r.status === 'PENDING' && r.expiresAt < now ? 'EXPIRED' : r.status,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      invitedBy: nameOf.has(r.invitedById) ? { id: r.invitedById, name: nameOf.get(r.invitedById)! } : null,
    }));
  }

  async create(me: AuthContext, input: InvitationCreate): Promise<Invitation> {
    if (!canAssignRole(me.role, input.role)) throw new ForbiddenException('Seu perfil não pode convidar com este papel');

    const alreadyIn = await this.prisma.membership.findFirst({
      where: { clinicId: me.clinicId, status: 'ACTIVE', user: { email: input.email } },
      select: { id: true },
    });
    if (alreadyIn) throw new ConflictException({ code: 'ALREADY_MEMBER', message: 'Esta pessoa já faz parte da clínica' });

    const row = await this.prisma.$transaction(async (tx) => {
      // Convites vencidos saem do caminho (só pode haver um pendente por e-mail/clínica).
      await tx.invitation.updateMany({
        where: { clinicId: me.clinicId, email: input.email, status: 'PENDING', expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      });
      const stillPending = await tx.invitation.findFirst({
        where: { clinicId: me.clinicId, email: input.email, status: 'PENDING' },
        select: { id: true },
      });
      if (stillPending) {
        throw new ConflictException({ code: 'INVITATION_EXISTS', message: 'Já existe um convite pendente para este e-mail' });
      }
      const inv = await tx.invitation.create({
        data: { clinicId: me.clinicId, email: input.email, role: input.role, invitedById: me.userId, expiresAt: expiry() },
      });
      await this.audit.log(me, 'INVITATION_CREATE', 'invitation', inv.id, tx);
      return inv;
    });
    return (await this.list(me.clinicId)).find((i) => i.id === row.id)!;
  }

  /** Reabre o prazo de um convite pendente (ou vencido). */
  async resend(me: AuthContext, id: string): Promise<Invitation> {
    const inv = await this.findOwned(me.clinicId, id);
    if (!['PENDING', 'EXPIRED'].includes(inv.status)) throw new BadRequestException('Só convites pendentes ou vencidos podem ser reenviados');
    if (!canAssignRole(me.role, inv.role)) throw new ForbiddenException('Seu perfil não pode gerenciar este convite');
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { status: 'PENDING', expiresAt: expiry() } });
      await this.audit.log(me, 'INVITATION_RESEND', 'invitation', id, tx);
    });
    return (await this.list(me.clinicId)).find((i) => i.id === id)!;
  }

  async revoke(me: AuthContext, id: string): Promise<void> {
    const inv = await this.findOwned(me.clinicId, id);
    if (inv.status !== 'PENDING') throw new BadRequestException('Só convites pendentes podem ser revogados');
    if (!canAssignRole(me.role, inv.role)) throw new ForbiddenException('Seu perfil não pode gerenciar este convite');
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id }, data: { status: 'REVOKED' } });
      await this.audit.log(me, 'INVITATION_REVOKE', 'invitation', id, tx);
    });
  }

  private async findOwned(clinicId: string, id: string) {
    const inv = await this.prisma.invitation.findFirst({ where: { id, clinicId } });
    if (!inv) throw new NotFoundException('Convite não encontrado');
    return inv;
  }
}

@Controller('clinic/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission('members.read')
  list(@CurrentUser() me: AuthContext) {
    return this.invitations.list(me.clinicId);
  }

  @Post()
  @RequirePermission('members.manage')
  create(@CurrentUser() me: AuthContext, @Body(new ZodPipe(InvitationCreate)) body: InvitationCreate) {
    return this.invitations.create(me, body);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermission('members.manage')
  resend(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.resend(me, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('members.manage')
  revoke(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(me, id);
  }
}

@Module({ controllers: [InvitationsController], providers: [InvitationsService], exports: [InvitationsService] })
export class InvitationsModule {}
