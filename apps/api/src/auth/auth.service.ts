import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, AuthUser, LoginRequest, LoginResponse } from '@sim/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { verifyPassword } from './password.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface IssuedSession {
  response: LoginResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginRequest, ip: string | null): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { clinic: { select: { name: true } } },
    });
    const ok = await verifyPassword(user?.active ? user.passwordHash : null, input.password);
    if (!user || !ok) {
      if (user) {
        await this.audit.log({ clinicId: user.clinicId, userId: user.id, ip }, 'AUTH_LOGIN_FAILED', 'user', user.id);
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos' });
    }
    await this.audit.log({ clinicId: user.clinicId, userId: user.id, ip }, 'AUTH_LOGIN', 'user', user.id);
    return this.issue(user.id, randomUUID());
  }

  /**
   * Troca um refresh token por um novo (rotação). Reusar um token já trocado revoga
   * a família inteira: alguém além do dono pode ter o token.
   */
  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException('Sessão ausente');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row) throw new UnauthorizedException('Sessão inválida');

    if (row.rotatedAt || row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException({ code: 'REFRESH_REUSED', message: 'Sessão encerrada por segurança' });
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Sessão expirada');

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count === 0) throw new UnauthorizedException('Sessão inválida');
    return this.issue(row.userId, row.familyId);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { clinic: { select: { name: true } } },
    });
    return this.toAuthUser(user);
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(userId: string, familyId: string): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { clinic: { select: { name: true } } },
    });
    if (!user.active) throw new UnauthorizedException('Usuário inativo');

    const payload: AccessTokenPayload = { sub: user.id, clinicId: user.clinicId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.config.JWT_ACCESS_TTL_SECONDS });

    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.config.REFRESH_TTL_DAYS * 86_400_000);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt },
    });

    return {
      response: { accessToken, expiresIn: this.config.JWT_ACCESS_TTL_SECONDS, user: this.toAuthUser(user) },
      refreshToken,
      refreshExpiresAt,
    };
  }

  private toAuthUser(user: {
    id: string;
    name: string;
    email: string;
    role: AuthUser['role'];
    clinicId: string;
    clinic: { name: string };
  }): AuthUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clinicId: user.clinicId,
      clinicName: user.clinic.name,
    };
  }
}
