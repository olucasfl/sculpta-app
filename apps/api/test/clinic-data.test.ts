import { CURRENT_TERM } from '@sim/contracts';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, login, seedClinic, SIGNATURE, startHarness, type Harness } from './harness.js';

let h: Harness;
let A: Awaited<ReturnType<typeof seedClinic>>;
let B: Awaited<ReturnType<typeof seedClinic>>;
let tok: { adminA: string; proA: string; recepA: string; adminB: string };

const consentBody = (scopes = ['SIMULATION']) => ({
  termVersion: CURRENT_TERM.version,
  scopes,
  signerName: 'Paciente Teste',
  signerRelation: 'PACIENTE',
  signatureDataUrl: SIGNATURE,
});

beforeAll(async () => {
  h = await startHarness();
  A = await seedClinic(h, 'Clinica A');
  B = await seedClinic(h, 'Clinica B');
  tok = {
    adminA: (await login(h, A.admin.email)).token,
    proA: (await login(h, A.pro.email)).token,
    recepA: (await login(h, A.recep.email)).token,
    adminB: (await login(h, B.admin.email)).token,
  };
});
afterAll(() => h?.close());

async function createPatient(token: string, body: Record<string, unknown> = { name: 'Maria Teste' }) {
  const res = await h.http().post('/api/patients').set(auth(token)).send(body).expect(201);
  return res.body as { id: string; consentState: string };
}

describe('pacientes', () => {
  it('cadastra só com o nome, busca e edita', async () => {
    const p = await createPatient(tok.recepA, { name: 'Joana Buscável', internalCode: 'INT-77', phone: '' });
    expect(p).toMatchObject({ name: 'Joana Buscável', phone: null, consentState: 'NONE' });

    const byName = await h.http().get('/api/patients?search=buscÁvel').set(auth(tok.recepA)).expect(200);
    expect(byName.body.items.map((x: { id: string }) => x.id)).toContain(p.id);
    const byCode = await h.http().get('/api/patients?search=int-77').set(auth(tok.recepA)).expect(200);
    expect(byCode.body.total).toBe(1);

    const upd = await h.http().patch(`/api/patients/${p.id}`).set(auth(tok.proA)).send({ phone: '(11) 98888-7777', internalCode: null }).expect(200);
    expect(upd.body).toMatchObject({ phone: '(11) 98888-7777', internalCode: null });
  });

  it('rejeita dados inválidos', async () => {
    const res = await h.http().post('/api/patients').set(auth(tok.adminA)).send({ name: 'X', birthDate: '2999-01-01' }).expect(400);
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(['birthDate', 'name']);
  });

  it('recepção e profissional não excluem; admin exclui e anonimiza', async () => {
    const p = await createPatient(tok.adminA, { name: 'Para Excluir', phone: '(11) 90000-1111' });
    await h.http().delete(`/api/patients/${p.id}`).set(auth(tok.recepA)).expect(403);
    await h.http().delete(`/api/patients/${p.id}`).set(auth(tok.proA)).expect(403);
    await h.http().delete(`/api/patients/${p.id}`).set(auth(tok.adminA)).expect(204);
    await h.http().get(`/api/patients/${p.id}`).set(auth(tok.adminA)).expect(404);

    const row = await h.prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ name: 'Paciente excluído', phone: null });
    expect(row.deletedAt).not.toBeNull();
  });
});

describe('isolamento entre clínicas', () => {
  it('a clínica B não vê, não edita, não exclui e não assina termo de paciente da A', async () => {
    const p = await createPatient(tok.adminA, { name: 'Segredo da Clínica A' });

    const list = await h.http().get('/api/patients?search=Segredo').set(auth(tok.adminB)).expect(200);
    expect(list.body.total).toBe(0);

    await h.http().get(`/api/patients/${p.id}`).set(auth(tok.adminB)).expect(404);
    await h.http().patch(`/api/patients/${p.id}`).set(auth(tok.adminB)).send({ name: 'Hackeado' }).expect(404);
    await h.http().delete(`/api/patients/${p.id}`).set(auth(tok.adminB)).expect(404);
    await h.http().get(`/api/patients/${p.id}/consents`).set(auth(tok.adminB)).expect(404);
    await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.adminB)).send(consentBody()).expect(404);

    const still = await h.http().get(`/api/patients/${p.id}`).set(auth(tok.adminA)).expect(200);
    expect(still.body.name).toBe('Segredo da Clínica A');
  });

  it('clinicId do body é ignorado: o paciente vai para a clínica do token', async () => {
    const res = await h.http().post('/api/patients').set(auth(tok.adminB)).send({ name: 'Tentativa', clinicId: A.clinic.id }).expect(201);
    const row = await h.prisma.patient.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.clinicId).toBe(B.clinic.id);
  });

  it('a clínica B não revoga nem vê assinatura de termo da A', async () => {
    const p = await createPatient(tok.adminA);
    const c = await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.adminA)).send(consentBody()).expect(201);
    await h.http().post(`/api/consents/${c.body.id}/revoke`).set(auth(tok.adminB)).expect(404);
    await h.http().get(`/api/consents/${c.body.id}/signature`).set(auth(tok.adminB)).expect(404);
  });

  it('usuários e auditoria são por clínica', async () => {
    const users = await h.http().get('/api/users').set(auth(tok.adminB)).expect(200);
    expect(users.body.every((u: { email: string }) => u.email.endsWith('@clinicab.test'))).toBe(true);
    await h.http().patch(`/api/users/${A.recep.id}`).set(auth(tok.adminB)).send({ active: false }).expect(404);
    const logs = await h.http().get('/api/audit').set(auth(tok.adminB)).expect(200);
    const ids = logs.body.items.map((l: { user: { id: string } | null }) => l.user?.id);
    expect(ids).not.toContain(A.admin.id);
  });
});

describe('termo de consentimento', () => {
  it('assina com escopos, guarda a assinatura e ativa o paciente', async () => {
    const p = await createPatient(tok.recepA);
    const c = await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.recepA)).send(consentBody(['SIMULATION', 'MARKETING'])).expect(201);
    expect(c.body).toMatchObject({ scopes: ['SIMULATION', 'MARKETING'], revokedAt: null, termVersion: CURRENT_TERM.version });
    expect(c.body.collectedBy.id).toBe(A.recep.id);

    const patient = await h.http().get(`/api/patients/${p.id}`).set(auth(tok.recepA)).expect(200);
    expect(patient.body.consentState).toBe('ACTIVE');

    const active = await h.http().get('/api/patients?consent=active&pageSize=100').set(auth(tok.recepA)).expect(200);
    const pending = await h.http().get('/api/patients?consent=pending&pageSize=100').set(auth(tok.recepA)).expect(200);
    expect(active.body.items.map((x: { id: string }) => x.id)).toContain(p.id);
    expect(pending.body.items.map((x: { id: string }) => x.id)).not.toContain(p.id);

    const sig = await h.http().get(`/api/consents/${c.body.id}/signature`).set(auth(tok.proA)).expect(200);
    expect(sig.headers['content-type']).toBe('image/png');
    expect(sig.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(sig.body).subarray(1, 4).toString()).toBe('PNG');
  });

  it('sem o escopo obrigatório ou com assinatura falsa, recusa', async () => {
    const p = await createPatient(tok.recepA);
    await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.recepA)).send(consentBody(['MARKETING'])).expect(400);
    const fake = { ...consentBody(), signatureDataUrl: 'data:image/png;base64,' + Buffer.alloc(100).toString('base64') };
    const r = await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.recepA)).send(fake).expect(400);
    expect(r.body.code).toBe('INVALID_SIGNATURE');
  });

  it('assinar de novo substitui o termo anterior', async () => {
    const p = await createPatient(tok.proA);
    await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.proA)).send(consentBody(['SIMULATION', 'RESEARCH'])).expect(201);
    await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.proA)).send(consentBody()).expect(201);
    const list = await h.http().get(`/api/patients/${p.id}/consents`).set(auth(tok.proA)).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((c: { revokedAt: string | null }) => c.revokedAt === null)).toHaveLength(1);
  });

  it('recepção não revoga; revogar apaga os biométricos e mantém o registro', async () => {
    const p = await createPatient(tok.adminA);
    const c = await h.http().post(`/api/patients/${p.id}/consents`).set(auth(tok.adminA)).send(consentBody()).expect(201);

    // Simula uma captura com foto já gravada (endpoints de captura chegam na Fase 2).
    const key = `clinics/${A.clinic.id}/captures/teste/FRONT.jpg`;
    await mkdir(join(h.storageDir, `clinics/${A.clinic.id}/captures/teste`), { recursive: true });
    await writeFile(join(h.storageDir, key), 'foto');
    await h.prisma.captureSession.create({
      data: { clinicId: A.clinic.id, patientId: p.id, capturedById: A.admin.id, photos: { create: { angle: 'FRONT', storageKey: key } } },
    });

    await h.http().post(`/api/consents/${c.body.id}/revoke`).set(auth(tok.recepA)).expect(403);
    const r = await h.http().post(`/api/consents/${c.body.id}/revoke`).set(auth(tok.proA)).expect(200);
    expect(r.body).toEqual({ revoked: true, biometricsPurged: true });

    expect(existsSync(join(h.storageDir, key))).toBe(false);
    expect(await h.prisma.photo.count({ where: { storageKey: key } })).toBe(0);
    expect(await h.prisma.captureSession.count({ where: { patientId: p.id } })).toBe(0);

    const patient = await h.http().get(`/api/patients/${p.id}`).set(auth(tok.adminA)).expect(200);
    expect(patient.body.consentState).toBe('REVOKED');
    const list = await h.http().get(`/api/patients/${p.id}/consents`).set(auth(tok.adminA)).expect(200);
    expect(list.body[0].revokedAt).not.toBeNull();

    await h.http().post(`/api/consents/${c.body.id}/revoke`).set(auth(tok.proA)).expect(409);
  });

  it('grava auditoria das ações sensíveis', async () => {
    const logs = await h.prisma.auditLog.findMany({ where: { clinicId: A.clinic.id } });
    const actions = new Set(logs.map((l) => l.action));
    for (const a of ['AUTH_LOGIN', 'PATIENT_CREATE', 'PATIENT_VIEW', 'PATIENT_DELETE', 'CONSENT_SIGN', 'CONSENT_REVOKE', 'CONSENT_SIGNATURE_VIEW', 'BIOMETRIC_PURGE']) {
      expect(actions, a).toContain(a);
    }
  });
});
