import { Injectable, NotFoundException } from '@nestjs/common';
import {
  hasActiveSimulationConsent,
  type ConsentState,
  type Paginated,
  type Patient,
  type PatientCreate,
  type PatientListQuery,
  type PatientUpdate,
} from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { BiometricPurgeService } from '../biometrics/biometric-purge.service.js';
import type { AuthContext } from '../common/auth-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const withConsents = {
  consents: { select: { scopes: true, revokedAt: true } },
} as const;

type Row = Prisma.PatientGetPayload<{ include: typeof withConsents }>;

function consentState(consents: Row['consents']): ConsentState {
  const list = consents.map((c) => ({ scopes: c.scopes, revokedAt: c.revokedAt?.toISOString() ?? null }));
  if (hasActiveSimulationConsent(list)) return 'ACTIVE';
  return list.some((c) => c.scopes.includes('SIMULATION')) ? 'REVOKED' : 'NONE';
}

export function toPatient(p: Row): Patient {
  return {
    id: p.id,
    name: p.name,
    internalCode: p.internalCode,
    phone: p.phone,
    birthDate: p.birthDate ? p.birthDate.toISOString().slice(0, 10) : null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    consentState: consentState(p.consents),
  };
}

const toDate = (d: string | null | undefined) =>
  d === undefined ? undefined : d === null ? null : new Date(`${d}T00:00:00Z`);

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly purge: BiometricPurgeService,
  ) {}

  /** Única porta de entrada para buscar um paciente: sempre filtra pela clínica do token. */
  async findOwned(clinicId: string, id: string) {
    const p = await this.prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: withConsents,
    });
    if (!p) throw new NotFoundException('Paciente não encontrado');
    return p;
  }

  async list(clinicId: string, q: PatientListQuery): Promise<Paginated<Patient>> {
    const activeConsent = { revokedAt: null, scopes: { has: 'SIMULATION' as const } };
    const where: Prisma.PatientWhereInput = {
      clinicId,
      deletedAt: null,
      ...(q.consent === 'active' ? { consents: { some: activeConsent } } : {}),
      ...(q.consent === 'pending' ? { consents: { none: activeConsent } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { internalCode: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({
        where,
        include: withConsents,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);
    return { items: rows.map(toPatient), total, page: q.page, pageSize: q.pageSize };
  }

  async get(me: AuthContext, id: string): Promise<Patient> {
    const p = await this.findOwned(me.clinicId, id);
    await this.audit.log(me, 'PATIENT_VIEW', 'patient', id);
    return toPatient(p);
  }

  async create(me: AuthContext, input: PatientCreate): Promise<Patient> {
    const p = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: { ...input, birthDate: toDate(input.birthDate), clinicId: me.clinicId },
        include: withConsents,
      });
      await this.audit.log(me, 'PATIENT_CREATE', 'patient', created.id, tx);
      return created;
    });
    return toPatient(p);
  }

  async update(me: AuthContext, id: string, input: PatientUpdate): Promise<Patient> {
    await this.findOwned(me.clinicId, id);
    const p = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patient.update({
        where: { id },
        data: { ...input, birthDate: toDate(input.birthDate) },
        include: withConsents,
      });
      await this.audit.log(me, 'PATIENT_UPDATE', 'patient', id, tx);
      return updated;
    });
    return toPatient(p);
  }

  /**
   * Exclusão: apaga os biométricos de fato e anonimiza o cadastro.
   * Fica só o id, as datas e os registros de consentimento (prova legal).
   */
  async remove(me: AuthContext, id: string) {
    await this.findOwned(me.clinicId, id);
    await this.purge.purgePatient(me, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id },
        data: {
          name: 'Paciente excluído',
          internalCode: null,
          phone: null,
          birthDate: null,
          notes: null,
          deletedAt: new Date(),
        },
      });
      await this.audit.log(me, 'PATIENT_DELETE', 'patient', id, tx);
    });
  }
}
