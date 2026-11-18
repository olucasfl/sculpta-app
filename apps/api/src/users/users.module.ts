import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserCreate, UserUpdate, type User } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const select = { id: true, name: true, email: true, role: true, active: true, createdAt: true } as const;
const toUser = (u: { createdAt: Date } & Omit<User, 'createdAt'>): User => ({
  ...u,
  createdAt: u.createdAt.toISOString(),
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(clinicId: string): Promise<User[]> {
    const rows = await this.prisma.user.findMany({ where: { clinicId }, select, orderBy: { name: 'asc' } });
    return rows.map(toUser);
  }

  async create(me: AuthContext, input: UserCreate): Promise<User> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { clinicId: me.clinicId, name: input.name, email: input.email, role: input.role, passwordHash },
        select,
      });
      await this.audit.log(me, 'USER_CREATE', 'user', u.id, tx);
      return u;
    });
    return toUser(user);
  }

  async update(me: AuthContext, id: string, input: UserUpdate): Promise<User> {
    const target = await this.prisma.user.findFirst({ where: { id, clinicId: me.clinicId } });
    if (!target) throw new NotFoundException('Usuário não encontrado');
    if (id === me.userId && (input.active === false || (input.role && input.role !== 'ADMIN'))) {
      throw new BadRequestException('Você não pode desativar nem rebaixar o próprio usuário');
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: input, select });
      if (input.active === false) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log(me, 'USER_UPDATE', 'user', id, tx);
      return u;
    });
    return toUser(user);
  }
}

@Controller('users')
@RequirePermission('users.manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() me: AuthContext) {
    return this.users.list(me.clinicId);
  }

  @Post()
  create(@CurrentUser() me: AuthContext, @Body(new ZodPipe(UserCreate)) body: UserCreate) {
    return this.users.create(me, body);
  }

  @Patch(':id')
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
