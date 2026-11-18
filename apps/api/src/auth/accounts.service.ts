import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ChangePasswordRequest, SignupRequest } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { InvitationActivationService } from './invitation-activation.service.js';
import { hashPassword, verifyPassword } from './password.js';

/**
 * Criar conta e trocar a senha. Versão SIMPLES (18/11/2026): sem verificação de e-mail e sem
 * recuperação por e-mail. Quem esquece a senha pede ao administrador (comando `admin:create`).
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly activation: InvitationActivationService,
  ) {}

  /** Cria a conta já ativa, aplica convites pendentes desse e-mail e abre a sessão. */
  async signup(input: SignupRequest, ip: string | null): Promise<IssuedSession> {
    if (await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'Este e-mail já tem conta. Entre com ele.' });
    }
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        // Sem verificação de e-mail por enquanto: a conta nasce "verificada".
        emailVerifiedAt: new Date(),
      },
    });
    await this.audit.log({ clinicId: null, userId: user.id, ip }, 'AUTH_SIGNUP', 'user', user.id);
    const joined = await this.activation.activate(user, ip);
    return this.auth.startSession(user.id, undefined, joined);
  }

  /** Troca a senha da conta logada e encerra as OUTRAS sessões (a atual continua). */
  async changePassword(userId: string, input: ChangePasswordRequest, ip: string | null, keepFamilyId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Senha atual incorreta' });
    }
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } });
    await this.auth.revokeAllSessions(userId, keepFamilyId);
    await this.audit.log({ clinicId: null, userId, ip }, 'AUTH_PASSWORD_CHANGE', 'user', userId);
  }
}
