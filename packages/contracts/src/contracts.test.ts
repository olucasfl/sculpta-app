import { describe, expect, it } from 'vitest';
import {
  ConsentCreate,
  CURRENT_TERM,
  LoginRequest,
  PatientCreate,
  PatientUpdate,
  PERMISSIONS,
  SimulationParams,
  can,
  canAssignRole,
  canManageMember,
  hasActiveSimulationConsent,
  type Permission,
} from './index.js';

const signature = 'data:image/png;base64,iVBORw0KGgo=';

describe('LoginRequest', () => {
  it('normaliza o e-mail', () => {
    expect(LoginRequest.parse({ email: '  Admin@Demo.LOCAL ', password: 'x' }).email).toBe(
      'admin@demo.local',
    );
  });
});

describe('PatientCreate', () => {
  it('exige só o nome e descarta campos vazios', () => {
    const r = PatientCreate.parse({ name: '  Ana Souza ', phone: '', birthDate: '', notes: ' ' });
    expect(r).toEqual({ name: 'Ana Souza' });
  });

  it('rejeita data no futuro e telefone inválido', () => {
    const r = PatientCreate.safeParse({ name: 'Ana', birthDate: '2999-01-01', phone: 'abc' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => String(i.path[0])).sort()).toEqual(['birthDate', 'phone']);
  });

  it('na edição, null apaga o campo', () => {
    expect(PatientUpdate.parse({ phone: null })).toEqual({ phone: null });
  });
});

describe('ConsentCreate', () => {
  const base = {
    termVersion: CURRENT_TERM.version,
    scopes: ['SIMULATION'],
    signerName: 'Ana Souza',
    signerRelation: 'PACIENTE',
    signatureDataUrl: signature,
  };

  it('aceita o termo vigente com o escopo obrigatório', () => {
    expect(ConsentCreate.safeParse(base).success).toBe(true);
  });

  it('exige o escopo SIMULATION', () => {
    expect(ConsentCreate.safeParse({ ...base, scopes: ['MARKETING'] }).success).toBe(false);
  });

  it('rejeita versão antiga do termo', () => {
    expect(ConsentCreate.safeParse({ ...base, termVersion: 'v0' }).success).toBe(false);
  });

  it('rejeita assinatura que não é PNG', () => {
    expect(
      ConsentCreate.safeParse({ ...base, signatureDataUrl: 'data:text/html,<x>' }).success,
    ).toBe(false);
  });
});

describe('hasActiveSimulationConsent', () => {
  it('ignora termos revogados e escopos opcionais', () => {
    expect(hasActiveSimulationConsent([{ scopes: ['SIMULATION'], revokedAt: '2026-01-01' }])).toBe(
      false,
    );
    expect(hasActiveSimulationConsent([{ scopes: ['MARKETING'], revokedAt: null }])).toBe(false);
    expect(
      hasActiveSimulationConsent([{ scopes: ['SIMULATION', 'MARKETING'], revokedAt: null }]),
    ).toBe(true);
  });
});

describe('permissões', () => {
  /**
   * Matriz da seção 3.3 de docs/CONTAS-CLINICAS-PERMISSOES.md, escrita de novo aqui de propósito:
   * se alguém mudar PERMISSIONS sem mudar o documento, este teste falha.
   * Ordem das colunas: OWNER, GERENTE, PROFISSIONAL, AUXILIAR, RECEPCAO, VISUALIZADOR.
   */
  const ROLES = ['OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR', 'RECEPCAO', 'VISUALIZADOR'] as const;
  const MATRIX: Record<string, readonly [boolean, boolean, boolean, boolean, boolean, boolean]> = {
    'patients.read': [true, true, true, true, true, true],
    'patients.write': [true, true, true, true, true, false],
    'patients.delete': [true, true, false, false, false, false],
    'consents.write': [true, true, true, true, true, false],
    'consents.revoke': [true, true, true, false, false, false],
    'captures.write': [true, true, true, true, false, false],
    'captures.read': [true, true, true, true, false, true],
    'simulations.read': [true, true, true, true, false, true],
    'simulations.write': [true, true, true, false, false, false],
    'simulations.export': [true, true, true, false, false, false],
    'reports.generate': [true, true, true, false, false, false],
    'members.read': [true, true, false, false, false, false],
    'members.manage': [true, true, false, false, false, false],
    'members.manage_owner': [true, false, false, false, false, false],
    'clinic.manage': [true, true, false, false, false, false],
    'clinic.retention': [true, false, false, false, false, false],
    'audit.read': [true, true, false, false, false, false],
  };

  it('cada permissão e cada papel batem com a matriz do documento', () => {
    for (const [permission, row] of Object.entries(MATRIX)) {
      ROLES.forEach((role, i) => {
        expect(can(role, permission as Permission), `${role} × ${permission}`).toBe(row[i]);
      });
    }
  });

  it('não existe permissão fora da matriz', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it('dona mexe em qualquer um; gerente não mexe em dona nem concede papel de dona', () => {
    expect(canManageMember('OWNER', 'OWNER')).toBe(true);
    expect(canManageMember('GERENTE', 'OWNER')).toBe(false);
    expect(canManageMember('GERENTE', 'RECEPCAO')).toBe(true);
    expect(canManageMember('PROFISSIONAL', 'RECEPCAO')).toBe(false);
    expect(canAssignRole('OWNER', 'OWNER')).toBe(true);
    expect(canAssignRole('GERENTE', 'OWNER')).toBe(false);
    expect(canAssignRole('GERENTE', 'GERENTE')).toBe(true);
    expect(canAssignRole('RECEPCAO', 'VISUALIZADOR')).toBe(false);
  });
});

describe('SimulationParams', () => {
  it('aceita só sliders conhecidos entre -1 e 1', () => {
    expect(SimulationParams.safeParse({ 'nose.tipProjection': 0.3 }).success).toBe(true);
    expect(SimulationParams.safeParse({ 'nose.tipProjection': 1.5 }).success).toBe(false);
    expect(SimulationParams.safeParse({ 'nose.inexistente': 0.1 }).success).toBe(false);
  });
});
