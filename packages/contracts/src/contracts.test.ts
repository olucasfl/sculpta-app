import { describe, expect, it } from 'vitest';
import {
  ConsentCreate,
  CURRENT_TERM,
  LoginRequest,
  PatientCreate,
  PatientUpdate,
  SimulationParams,
  can,
  hasActiveSimulationConsent,
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
  it('só admin exclui paciente; recepção não exporta', () => {
    expect(can('ADMIN', 'patients.delete')).toBe(true);
    expect(can('PROFISSIONAL', 'patients.delete')).toBe(false);
    expect(can('RECEPCAO', 'simulations.export')).toBe(false);
  });
});

describe('SimulationParams', () => {
  it('aceita só sliders conhecidos entre -1 e 1', () => {
    expect(SimulationParams.safeParse({ 'nose.tipProjection': 0.3 }).success).toBe(true);
    expect(SimulationParams.safeParse({ 'nose.tipProjection': 1.5 }).success).toBe(false);
    expect(SimulationParams.safeParse({ 'nose.inexistente': 0.1 }).success).toBe(false);
  });
});
