import { CURRENT_TERM, REQUIRED_ANGLES, type CaptureSession, type DashboardStats, type PatientNote, type TimelineItem, type UploadTarget } from '@sim/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconstructionQueue } from '../src/reconstructions/reconstruction-queue.js';
import { auth, login, seedClinic, SIGNATURE, startHarness, type Harness } from './harness.js';

let h: Harness;
let A: Awaited<ReturnType<typeof seedClinic>>;
let B: Awaited<ReturnType<typeof seedClinic>>;
let tok: { adminA: string; gerA: string; proA: string; recepA: string; auxA: string; adminB: string };
let patientId = '';
let simulationId = '';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);

beforeAll(async () => {
  h = await startHarness();
  A = await seedClinic(h, 'Clinica Produto A');
  B = await seedClinic(h, 'Clinica Produto B');
  tok = {
    adminA: (await login(h, A.admin.email)).token,
    gerA: (await login(h, A.gerente.email)).token,
    proA: (await login(h, A.pro.email)).token,
    recepA: (await login(h, A.recep.email)).token,
    auxA: (await login(h, A.aux.email)).token,
    adminB: (await login(h, B.admin.email)).token,
  };

  // Um paciente com termo, captura concluída, modelo pronto e simulação com uma versão.
  const p = await h.http().post('/api/patients').set(auth(tok.auxA)).send({ name: 'Paciente Produto' }).expect(201);
  patientId = p.body.id;
  await h.http().post(`/api/patients/${patientId}/consents`).set(auth(tok.auxA)).send({
    termVersion: CURRENT_TERM.version, scopes: ['SIMULATION'], signerName: 'Paciente Produto', signerRelation: 'PACIENTE', signatureDataUrl: SIGNATURE,
  }).expect(201);
  const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
  for (const a of REQUIRED_ANGLES) {
    const t = (await h.http().post(`/api/captures/${s.id}/uploads/${a}`).set(auth(tok.auxA)).expect(200)).body as UploadTarget;
    await h.http().put(t.url).set('Content-Type', 'image/jpeg').send(JPEG).expect(200);
    await h.http().put(`/api/captures/${s.id}/photos/${a}`).set(auth(tok.auxA)).send({
      key: t.key, width: 1000, height: 1000, yawDeg: 0, sharpness: 100, faceDetected: true, faceHeightRatio: 0.5, validation: 'AUTO', source: 'UPLOAD',
    }).expect(200);
  }
  const rec = (await h.http().post(`/api/captures/${s.id}/complete`).set(auth(tok.auxA)).expect(200)).body;
  await h.app.get(ReconstructionQueue).drain();
  const sim = await h.http().post(`/api/reconstructions/${rec.id}/simulations`).set(auth(tok.proA)).send({ name: 'Lábios e mento' }).expect(201);
  simulationId = sim.body.id;
  await h.http().post(`/api/simulations/${simulationId}/versions`).set(auth(tok.proA)).send({
    name: 'Proposta 1', description: 'Conversa inicial com a paciente.', params: { 'lips.upperVolume': 0.4, 'chin.projection': -0.3 }, thumbnailDataUrl: SIGNATURE,
  }).expect(201);
});
afterAll(() => h?.close());

describe('painel', () => {
  it('conta pacientes, termos, capturas e simulações só da própria clínica', async () => {
    const r = await h.http().get('/api/dashboard').set(auth(tok.proA)).expect(200);
    const d = r.body as DashboardStats;
    expect(d.patients).toMatchObject({ total: 1, withActiveConsent: 1, pendingConsent: 0, newThisMonth: 1 });
    expect(d.captures.thisMonth).toBe(1);
    expect(d.simulations).toMatchObject({ total: 1, thisMonth: 1, versionsThisMonth: 1 });
    expect(d.recent.map((x) => x.kind).sort()).toEqual(['CAPTURE', 'SIMULATION']);
    const other = (await h.http().get('/api/dashboard').set(auth(tok.adminB)).expect(200)).body as DashboardStats;
    expect(other.patients.total).toBe(0);
    expect(other.recent).toEqual([]);
  });

  it('recepção vê os números, mas não a atividade com fotos e modelos', async () => {
    const d = (await h.http().get('/api/dashboard').set(auth(tok.recepA)).expect(200)).body as DashboardStats;
    expect(d.patients.total).toBe(1);
    expect(d.recent).toEqual([]);
  });
});

describe('filtros de pacientes', () => {
  it('por data de cadastro e por profissional', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const get = async (q: string) => (await h.http().get(`/api/patients?${q}`).set(auth(tok.proA)).expect(200)).body.total as number;
    expect(await get(`createdFrom=${today}&createdTo=${today}`)).toBe(1);
    expect(await get('createdTo=2020-01-01')).toBe(0);
    expect(await get('createdFrom=2999-01-01')).toBe(0);
    // O profissional simulou; a auxiliar capturou; a recepção não fez nada.
    expect(await get(`professionalId=${A.pro.id}`)).toBe(1);
    expect(await get(`professionalId=${A.aux.id}`)).toBe(1);
    expect(await get(`professionalId=${A.recep.id}`)).toBe(0);
    await h.http().get('/api/patients?createdFrom=ontem').set(auth(tok.proA)).expect(400);
  });
});

describe('anotações e linha do tempo', () => {
  let noteId = '';
  it('quem captura escreve e lê; recepção não vê anotações', async () => {
    const r = await h.http().post(`/api/patients/${patientId}/notes`).set(auth(tok.auxA)).send({ text: 'Prefere conversar sobre o queixo.' }).expect(201);
    noteId = (r.body as PatientNote).id;
    expect(r.body).toMatchObject({ text: 'Prefere conversar sobre o queixo.', author: { id: A.aux.id } });
    await h.http().post(`/api/patients/${patientId}/notes`).set(auth(tok.auxA)).send({ text: '   ' }).expect(400);
    await h.http().post(`/api/patients/${patientId}/notes`).set(auth(tok.recepA)).send({ text: 'x' }).expect(403);
    await h.http().get(`/api/patients/${patientId}/notes`).set(auth(tok.recepA)).expect(403);
    const list = await h.http().get(`/api/patients/${patientId}/notes`).set(auth(tok.proA)).expect(200);
    expect(list.body).toHaveLength(1);
    // Outra clínica não enxerga o paciente.
    await h.http().get(`/api/patients/${patientId}/notes`).set(auth(tok.adminB)).expect(404);
    await h.http().get(`/api/patients/${patientId}/timeline`).set(auth(tok.adminB)).expect(404);
  });

  it('a linha do tempo junta cadastro, termo, captura, simulação e anotação, do mais novo ao mais antigo', async () => {
    const t = (await h.http().get(`/api/patients/${patientId}/timeline`).set(auth(tok.proA)).expect(200)).body as TimelineItem[];
    expect(t.map((x) => x.kind).sort()).toEqual(['CAPTURE', 'CONSENT', 'NOTE', 'PATIENT', 'SIMULATION']);
    expect([...t].sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.id)).toEqual(t.map((x) => x.id));
    expect(t.find((x) => x.kind === 'SIMULATION')?.ref).toMatchObject({ type: 'simulation', id: simulationId });
    // Recepção vê só cadastro e termo.
    const r = (await h.http().get(`/api/patients/${patientId}/timeline`).set(auth(tok.recepA)).expect(200)).body as TimelineItem[];
    expect(r.map((x) => x.kind).sort()).toEqual(['CONSENT', 'PATIENT']);
  });

  it('só quem escreveu ou a gerência apaga a anotação', async () => {
    await h.http().delete(`/api/notes/${noteId}`).set(auth(tok.proA)).expect(403);
    await h.http().delete(`/api/notes/${noteId}`).set(auth(tok.adminB)).expect(404);
    await h.http().delete(`/api/notes/${noteId}`).set(auth(tok.gerA)).expect(204);
    expect((await h.http().get(`/api/patients/${patientId}/notes`).set(auth(tok.proA)).expect(200)).body).toHaveLength(0);
  });

  it('excluir o paciente apaga as anotações', async () => {
    await h.http().post(`/api/patients/${patientId}/notes`).set(auth(tok.proA)).send({ text: 'Anotação a apagar' }).expect(201);
    expect(await h.prisma.patientNote.count({ where: { patientId } })).toBe(1);
    // Cria outro paciente só para esta prova, para não mexer nos demais testes.
    const p = (await h.http().post('/api/patients').set(auth(tok.auxA)).send({ name: 'Para excluir' }).expect(201)).body;
    await h.http().post(`/api/patients/${p.id}/notes`).set(auth(tok.proA)).send({ text: 'some junto' }).expect(201);
    await h.http().delete(`/api/patients/${p.id}`).set(auth(tok.adminA)).expect(204);
    expect(await h.prisma.patientNote.count({ where: { patientId: p.id } })).toBe(0);
  });
});

describe('relatório em PDF', () => {
  it('profissional gera o PDF; auxiliar e outra clínica não; fica registrado na auditoria', async () => {
    const r = await h.http().get(`/api/simulations/${simulationId}/report.pdf`).set(auth(tok.proA)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const bytes = r.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);
    await h.http().get(`/api/simulations/${simulationId}/report.pdf`).set(auth(tok.auxA)).expect(403);
    await h.http().get(`/api/simulations/${simulationId}/report.pdf`).set(auth(tok.adminB)).expect(404);
    expect(await h.prisma.auditLog.count({ where: { action: 'REPORT_GENERATE', entityId: simulationId } })).toBe(1);
  });

  it('simulação sem versão salva não gera relatório', async () => {
    const rec = await h.prisma.reconstruction.findFirstOrThrow({ where: { patientId } });
    const empty = await h.http().post(`/api/reconstructions/${rec.id}/simulations`).set(auth(tok.proA)).send({ name: 'Vazia' }).expect(201);
    await h.http().get(`/api/simulations/${empty.body.id}/report.pdf`).set(auth(tok.proA)).expect(404);
  });
});
