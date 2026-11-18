import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ClinicRole, Permission } from '@sim/contracts';
import type { Request } from 'express';

/**
 * Quem está chamando, dentro de UMA clínica. Preenchido pelo JwtAuthGuard a partir do token e do
 * vínculo no banco, nunca do body. `clinicId` aqui já foi validado contra um vínculo ativo.
 */
export interface AuthContext {
  userId: string;
  clinicId: string;
  role: ClinicRole;
  isPlatformAdmin: boolean;
  ip: string | null;
}

/** A conta, sem clínica (rotas marcadas com @NoClinic ou @PlatformOnly). */
export interface AccountContext {
  userId: string;
  isPlatformAdmin: boolean;
  ip: string | null;
}

export type AuthedRequest = Request & { auth?: AuthContext; account?: AccountContext };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('CurrentUser usado em rota sem clínica');
  return req.auth;
});

export const CurrentAccount = createParamDecorator((_: unknown, ctx: ExecutionContext): AccountContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.account) throw new Error('CurrentAccount usado em rota pública');
  return req.account;
});

export const IS_PUBLIC = 'isPublic';
/** Rota sem autenticação (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const NO_CLINIC = 'noClinic';
/** Exige sessão, mas não uma clínica ativa (ex.: `/auth/me`, que lista as clínicas da pessoa). */
export const NoClinic = () => SetMetadata(NO_CLINIC, true);

export const PLATFORM_ONLY = 'platformOnly';
/** Só administrador da plataforma; sem clínica ativa. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/** Exige a permissão (ver PERMISSIONS em @sim/contracts). */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export function requestIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}
