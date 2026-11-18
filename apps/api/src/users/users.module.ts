import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { canAssignRole, canManageMember, UserCreate, UserUpdate, type User } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const memberSelect = {
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

const toMember = (m: MemberRow): User => ({
  id: m.user.id,
  name: m.user.name,
  email: m.user.email,
  role: m.role,
  active: m.status === 'ACTIVE',
  createdAt: m.createdAt.toISOString(),
});

/**
 * Equipe da clínica = vínculos (Membership). Regras (docs/CONTAS-CLINICAS-PERMISSOES.md, seção 3.3):
 * dona mexe em qualquer um; gerente não mexe em dona nem concede papel de dona; ninguém muda o
 * próprio vínculo; a última dona não sai nem é rebaixada.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(clinicId: string): Promise<User[]> {
    const rows = await this.prisma.membership.findMany({
      where: { clinicId, status: { not: 'REMOVED' } },
      select: memberSelect,
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map(toMember);
  }

  /**
   * Cadastro direto de uma conta NOVA com senha inicial (provedor local). Se o e-mail já tem
   * conta, recusa: o caminho para pessoas que já existem é o convite por e-mail (etapa 1B.4).
   */
  async create(me: AuthContext, input: UserCreate): Promise<User> {
    if (!canAssignRole(me.role, input.role)) {
      throw new ForbiddenException('Seu perfil não pode conceder este papel');
    }
    if (await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'Este e-mail já tem conta. Use o convite por e-mail.' });
    }
    const passwordHash = await hashPassword(input.password);
    const row = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { name: input.name, email: input.email, passwordHash, emailVerifiedAt: new Date() },
        select: { id: true },
      });
      const m = await tx.membership.create({
        data: { userId: u.id, clinicId: me.clinicId, role: input.role, invitedById: me.userId },
        select: memberSelect,
      });
      await this.audit.log(me, 'USER_CREATE', 'user', u.id, tx);
      return m;
    });
    return toMember(row);
  }

  async update(me: AuthContext, userId: string, input: UserUpdate): Promise<User> {
    const target = await this.prisma.membership.findFirst({
      where: { userId, clinicId: me.clinicId, status: { not: 'REMOVED' } },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    if (!canManageMember(me.role, target.role)) {
      throw new ForbiddenException('Seu perfil não pode alterar este membro');
    }
    if (input.role && !canAssignRole(me.role, input.role)) {
      throw new ForbiddenException('Seu perfil não pode conceder este papel');
    }
    if (userId === me.userId && (input.active === false || (input.role && input.role !== target.role))) {
      throw new BadRequestException('Você não pode desativar nem alterar o próprio papel');
    }

    const losesOwnership =
      target.role === 'OWNER' && ((input.role && input.role !== 'OWNER') || input.active === false);
    if (losesOwnership) {
      const others = await this.prisma.membership.count({
        where: { clinicId: me.clinicId, role: 'OWNER', status: 'ACTIVE', userId: { not: userId } },
      });
      if (others === 0) {
        throw new BadRequestException({ code: 'LAST_OWNER', message: 'A clínica precisa de ao menos uma dona ativa' });
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: target.id },
        data: {
          ...(input.role ? { role: input.role } : {}),
          ...(input.active === undefined ? {} : { status: input.active ? 'ACTIVE' : 'SUSPENDED' }),
        },
        select: memberSelect,
      });
      // O nome é da CONTA: só muda aqui se a pessoa não tem vínculo em outra clínica.
      if (input.name) {
        const elsewhere = await tx.membership.count({ where: { userId, clinicId: { not: me.clinicId }, status: { not: 'REMOVED' } } });
        if (elsewhere === 0) await tx.user.update({ where: { id: userId }, data: { name: input.name } });
      }
      await this.audit.log(me, 'USER_UPDATE', 'user', userId, tx);
      return tx.membership.findUniqueOrThrow({ where: { id: target.id }, select: memberSelect });
    });
    return toMember(row);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('members.read')
  list(@CurrentUser() me: AuthContext) {
    return this.users.list(me.clinicId);
  }

  @Post()
  @RequirePermission('members.manage')
  create(@CurrentUser() me: AuthContext, @Body(new ZodPipe(UserCreate)) body: UserCreate) {
    return this.users.create(me, body);
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  update(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UserUpdate)) body: UserUpdate,
  ) {
    return this.users.update(me, id, body);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
