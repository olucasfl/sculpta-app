import { Injectable } from '@nestjs/common';
import type { ClinicMembership } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Convite vira vínculo ativo quando a conta tem e-mail VERIFICADO e coincidente (docs/CONTAS-CLINICAS-PERMISSOES.md, 4.3).
 * Chamado no login e ao verificar o e-mail. Só o e-mail verificado libera: criar uma conta com o e-mail
 * de outra pessoa, sem acesso à caixa dela, nunca ativa convite.
 */
@Injectable()
export class InvitationActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async activate(user: { id: string; email: string; emailVerifiedAt: Date | null }, ip: string | null): Promise<ClinicMembership[]> {
    if (!user.emailVerifiedAt) return [];
    const pending = await this.prisma.invitation.findMany({
      where: { email: user.email, status: 'PENDING', expiresAt: { gt: new Date() }, clinic: { status: 'ACTIVE' } },
      include: { clinic: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const joined: ClinicMembership[] = [];
    for (const inv of pending) {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.membership.findUnique({
          where: { userId_clinicId: { userId: user.id, clinicId: inv.clinicId } },
        });
        // Vínculo já ativo não é alterado pelo convite (evita rebaixar/escalar por convite antigo).
        if (!existing || existing.status !== 'ACTIVE') {
          await tx.membership.upsert({
            where: { userId_clinicId: { userId: user.id, clinicId: inv.clinicId } },
            create: { userId: user.id, clinicId: inv.clinicId, role: inv.role, invitedById: inv.invitedById },
            update: { role: inv.role, status: 'ACTIVE', invitedById: inv.invitedById },
          });
          joined.push({ id: inv.clinic.id, name: inv.clinic.name, role: inv.role });
          await this.audit.log({ clinicId: inv.clinicId, userId: user.id, ip }, 'MEMBER_JOINED', 'user', user.id, tx);
        }
        await tx.invitation.update({
          where: { id: inv.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id },
        });
      });
    }
    return joined;
  }
}
