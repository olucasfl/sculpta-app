import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditEntry, Paginated, PageQuery } from '@sim/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Pick<PrismaService, 'auditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra uma ação sensível. Aceita um client de transação para gravar junto com a mudança. */
  async log(
    actor: { clinicId: string | null; ip: string | null; userId: string | null },
    action: AuditAction,
    entity: string,
    entityId: string,
    tx: Tx = this.prisma,
  ) {
    await tx.auditLog.create({
      data: { clinicId: actor.clinicId, userId: actor.userId, action, entity, entityId, ip: actor.ip },
    });
  }

  async list(clinicId: string, q: PageQuery): Promise<Paginated<AuditEntry>> {
    const where = { clinicId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, clinicId },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action as AuditAction,
        entity: r.entity,
        entityId: r.entityId,
        user: r.userId ? (byId.get(r.userId) ?? null) : null,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
