import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, type AccessTokenPayload, type Permission } from '@sim/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC, REQUIRED_PERMISSION, requestIp, type AuthedRequest } from './auth-context.js';

/**
 * Guard global: toda rota exige access token, exceto as marcadas com @Public().
 * O papel e a clínica são relidos do banco, para que desativar um usuário ou mudar
 * o papel valha na hora, sem esperar o token expirar.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Sessão ausente');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Sessão expirada' });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, clinicId: true, role: true, active: true },
    });
    if (!user || !user.active || user.clinicId !== payload.clinicId) {
      throw new UnauthorizedException('Usuário inativo');
    }

    req.auth = { userId: user.id, clinicId: user.clinicId, role: user.role, ip: requestIp(req) };
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!permission) return true;
    const { auth } = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!auth || !can(auth.role, permission)) {
      throw new ForbiddenException('Seu perfil não tem permissão para esta ação');
    }
    return true;
  }
}
