import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@sim/contracts';
import type { Request } from 'express';

/** Quem está chamando. Preenchido pelo JwtAuthGuard a partir do token, nunca do body. */
export interface AuthContext {
  userId: string;
  clinicId: string;
  role: Role;
  ip: string | null;
}

export type AuthedRequest = Request & { auth?: AuthContext };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('CurrentUser usado em rota pública');
  return req.auth;
});

export const IS_PUBLIC = 'isPublic';
/** Rota sem autenticação (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/** Exige a permissão (ver PERMISSIONS em @sim/contracts). */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export function requestIp(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}
