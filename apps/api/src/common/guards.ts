import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { CLINIC_HEADER, can, type AccessTokenPayload, type ClinicRole, type Permission } from '@sim/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

/** No modo suporte, o administrador da plataforma só enxerga isto (nada de fotos ou modelos 3D). */
export const SUPPORT_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(['patients.read', 'members.read', 'audit.read']);
import {
  IS_PUBLIC,
  NO_CLINIC,
  PLATFORM_ONLY,
  REQUIRED_PERMISSION,
  requestIp,
  type AuthedRequest,
} from './auth-context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard global: toda rota exige access token, exceto as marcadas com @Public().
 *
 * A clínica ativa NÃO vem do token: vem do cabeçalho `X-Clinic-Id` e é validada a cada chamada
 * contra um vínculo ATIVO no banco. Assim, suspender um vínculo, remover uma pessoa, mudar o papel
 * ou suspender a clínica valem na hora, sem esperar o token expirar. Cabeçalho de clínica sem
 * vínculo e clínica inexistente dão a MESMA resposta (não revela que a clínica existe).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, meta)) return true;

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
      select: { id: true, active: true, isPlatformAdmin: true },
    });
    if (!user || !user.active) throw new UnauthorizedException('Usuário inativo');

    const ip = requestIp(req);
    req.account = { userId: user.id, isPlatformAdmin: user.isPlatformAdmin, ip };

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, meta)) {
      if (!user.isPlatformAdmin) throw new ForbiddenException('Apenas o administrador da plataforma');
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(NO_CLINIC, meta)) return true;

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { clinicId: true, role: true, clinic: { select: { status: true } } },
    });

    const wanted = req.headers[CLINIC_HEADER];
    const wantedId = Array.isArray(wanted) ? wanted[0] : wanted;
    let chosen: { clinicId: string; role: ClinicRole; clinic: { status: string } } | undefined;
    let support: { id: string; expiresAt: Date } | undefined;

    if (wantedId) {
      chosen = UUID.test(wantedId) ? memberships.find((m) => m.clinicId === wantedId.toLowerCase()) : undefined;
      // Administrador da plataforma sem vínculo: só entra com uma janela de suporte ativa (motivo + prazo).
      if (!chosen && user.isPlatformAdmin && UUID.test(wantedId)) {
        const win = await this.prisma.supportAccess.findFirst({
          where: { adminId: user.id, clinicId: wantedId.toLowerCase(), endedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, expiresAt: true, clinicId: true },
        });
        const c = win && (await this.prisma.clinic.findUnique({ where: { id: win.clinicId }, select: { status: true } }));
        if (win && c) {
          chosen = { clinicId: win.clinicId, role: 'VISUALIZADOR', clinic: { status: c.status } };
          support = { id: win.id, expiresAt: win.expiresAt };
        }
      }
      if (!chosen) throw new ForbiddenException({ code: 'CLINIC_FORBIDDEN', message: 'Sem acesso a esta clínica' });
    } else if (memberships.length === 1) {
      chosen = memberships[0];
    } else if (memberships.length === 0) {
      throw new ForbiddenException({ code: 'NO_CLINIC', message: 'Você ainda não foi adicionado a nenhuma clínica' });
    } else {
      throw new BadRequestException({ code: 'CLINIC_REQUIRED', message: 'Escolha a clínica (cabeçalho X-Clinic-Id)' });
    }

    // No modo suporte dá para olhar clínicas suspensas ou com exclusão agendada, não as já expurgadas.
    const open = support ? chosen!.clinic.status !== 'DELETED' : chosen!.clinic.status === 'ACTIVE';
    if (!open) {
      throw new ForbiddenException({ code: 'CLINIC_SUSPENDED', message: 'Esta clínica está suspensa ou foi excluída' });
    }
    if (support && req.method !== 'GET') {
      throw new ForbiddenException({ code: 'SUPPORT_READ_ONLY', message: 'No modo suporte só é possível consultar' });
    }

    req.auth = {
      userId: user.id,
      clinicId: chosen!.clinicId,
      role: chosen!.role,
      isPlatformAdmin: user.isPlatformAdmin,
      ...(support ? { support } : {}),
      ip,
    };
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
    // No modo suporte valem só as permissões de leitura de SUPPORT_PERMISSIONS, não a matriz do papel.
    if (auth?.support) {
      if (!SUPPORT_PERMISSIONS.has(permission)) {
        throw new ForbiddenException({ code: 'SUPPORT_RESTRICTED', message: 'No modo suporte você não acessa fotos nem modelos 3D' });
      }
      return true;
    }
    if (!auth || !can(auth.role, permission)) {
      throw new ForbiddenException('Seu perfil não tem permissão para esta ação');
    }
    return true;
  }
}
