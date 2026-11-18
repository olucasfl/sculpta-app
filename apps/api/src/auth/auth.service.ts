import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, AuthUser, ClinicMembership, LoginRequest, LoginResponse } from '@sim/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvitationActivationService } from './invitation-activation.service.js';
import { verifyPassword } from './password.js';
import { sha256 } from './tokens.js';

export interface IssuedSession {
  response: LoginResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Identidade PRÓPRIA (e-mail + senha com argon2, sessão por refresh token rotativo).
 * Decisão D11 (18/11/2026): por enquanto só o banco é do Supabase; o login é nosso.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly activation: InvitationActivationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginRequest, ip: string | null): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await verifyPassword(user?.active ? user.passwordHash : null, input.password);
    if (!user || !ok) {
      if (user) await this.auditAuth(user.id, ip, 'AUTH_LOGIN_FAILED');
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos' });
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirme seu e-mail pelo link que enviamos.' });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const joined = await this.activation.activate(user, ip);
    await this.auditAuth(user.id, ip, 'AUTH_LOGIN');
    return this.startSession(user.id, undefined, joined);
  }

  /**
   * Registra o evento na auditoria de CADA clínica em que a pessoa tem vínculo ativo (a dona vê os
   * acessos da equipe dela); sem clínica, vira evento da plataforma (clinicId nulo).
   */
  async auditAuth(userId: string, ip: string | null, action: 'AUTH_LOGIN' | 'AUTH_LOGIN_FAILED') {
    const clinics = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { clinicId: true },
    });
    for (const clinicId of clinics.length ? clinics.map((c) => c.clinicId) : [null]) {
      await this.audit.log({ clinicId, userId, ip }, action, 'user', userId);
    }
  }

  /**
   * Troca um refresh token por um novo (rotação). Reusar um token já trocado revoga
   * a família inteira: alguém além do dono pode ter o token.
   */
  async refresh(refreshToken: string | undefined, clinicId?: string): Promise<IssuedSession> {
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
    return this.startSession(row.userId, row.familyId, [], clinicId);
  }

  /** Família (sessão) a que o refresh token pertence, para preservá-la ao encerrar as outras. */
  async familyOf(refreshToken: string | undefined): Promise<string | undefined> {
    if (!refreshToken) return undefined;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, select: { familyId: true } });
    return row?.familyId;
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  /** Encerra todas as sessões da conta (troca ou redefinição de senha). `keepFamilyId` preserva a atual. */
  async revokeAllSessions(userId: string, keepFamilyId?: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** A conta, as clínicas em que tem vínculo ativo e a clínica ativa (cabeçalho, ou a única). */
  async me(userId: string, wantedClinicId?: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isPlatformAdmin: true,
        memberships: {
          where: { status: 'ACTIVE', clinic: { status: 'ACTIVE' } },
          select: { role: true, clinic: { select: { id: true, name: true } } },
          orderBy: { clinic: { name: 'asc' } },
        },
      },
    });
    const clinics = user.memberships.map((m) => ({ id: m.clinic.id, name: m.clinic.name, role: m.role }));
    const active = wantedClinicId ? clinics.find((c) => c.id === wantedClinicId) : clinics.length === 1 ? clinics[0] : undefined;

    // Administrador da plataforma dentro de uma clínica em modo suporte (janela ativa, somente leitura).
    if (!active && wantedClinicId && user.isPlatformAdmin) {
      const win = await this.prisma.supportAccess.findFirst({
        where: { adminId: userId, clinicId: wantedClinicId, endedAt: null, expiresAt: { gt: new Date() } },
      });
      const clinic = win && (await this.prisma.clinic.findUnique({ where: { id: wantedClinicId }, select: { name: true } }));
      if (win && clinic) {
        return {
          id: user.id, name: user.name, email: user.email, isPlatformAdmin: true, clinics,
          clinicId: wantedClinicId, clinicName: clinic.name, role: 'VISUALIZADOR',
          support: { id: win.id, expiresAt: win.expiresAt.toISOString(), reason: win.reason },
        };
      }
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      clinics,
      clinicId: active?.id ?? null,
      clinicName: active?.name ?? null,
      role: active?.role ?? null,
    };
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Abre uma sessão (access token + refresh token novo na família indicada). */
  async startSession(
    userId: string,
    familyId: string = randomUUID(),
    joined: ClinicMembership[] = [],
    clinicId?: string,
  ): Promise<IssuedSession> {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { active: true } });
    if (!account.active) throw new UnauthorizedException('Usuário inativo');

    const payload: AccessTokenPayload = { sub: userId };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.config.JWT_ACCESS_TTL_SECONDS });

    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.config.REFRESH_TTL_DAYS * 86_400_000);
    await this.prisma.refreshToken.create({
      data: { userId, familyId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt },
    });

    const user = await this.me(userId, clinicId);
    return {
      response: {
        accessToken,
        expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
        user: joined.length ? { ...user, joined } : user,
      },
      refreshToken,
      refreshExpiresAt,
    };
  }
}
