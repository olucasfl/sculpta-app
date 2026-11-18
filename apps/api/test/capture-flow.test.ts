import { CURRENT_TERM, PhotoAngle, type CaptureSession, type UploadTarget } from '@sim/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconstructionQueue } from '../src/reconstructions/reconstruction-queue.js';
import { auth, login, seedClinic, SIGNATURE, startHarness, type Harness } from './harness.js';

let h: Harness;
let A: Awaited<ReturnType<typeof seedClinic>>;
let B: Awaited<ReturnType<typeof seedClinic>>;
let tok: { adminA: string; proA: string; recepA: string; auxA: string; adminB: string };

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const meta = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  width: 1536,
  height: 2048,
  yawDeg: 1.5,
  sharpness: 120,
  faceDetected: true,
  faceHeightRatio: 0.55,
  validation: 'AUTO',
  source: 'CAMERA',
  ...extra,
});

beforeAll(async () => {
  h = await startHarness();
  A = await seedClinic(h, 'Clinica A');
  B = await seedClinic(h, 'Clinica B');
  tok = {
    adminA: (await login(h, A.admin.email)).token,
    proA: (await login(h, A.pro.email)).token,
    recepA: (await login(h, A.recep.email)).token,
    auxA: (await login(h, A.aux.email)).token,
    adminB: (await login(h, B.admin.email)).token,
  };
});
afterAll(() => h?.close());

async function patientWithConsent(token = tok.auxA) {
  const p = await h.http().post('/api/patients').set(auth(token)).send({ name: 'Paciente Captura' }).expect(201);
  await h.http().post(`/api/patients/${p.body.id}/consents`).set(auth(token)).send({
    termVersion: CURRENT_TERM.version,
    scopes: ['SIMULATION'],
    signerName: 'Paciente Captura',
    signerRelation: 'PACIENTE',
    signatureDataUrl: SIGNATURE,
  }).expect(201);
  return p.body.id as string;
}

async function uploadAngle(captureId: string, angle: PhotoAngle, token = tok.auxA, extra = {}) {
  const t = (await h.http().post(`/api/captures/${captureId}/uploads/${angle}`).set(auth(token)).expect(200)).body as UploadTarget;
  expect(t.url).toMatch(/^\/api\/storage\/local\//);
  await h.http().put(t.url).set('Content-Type', 'image/jpeg').send(JPEG).expect(200);
  const r = await h.http().put(`/api/captures/${captureId}/photos/${angle}`).set(auth(token)).send(meta(t.key, extra)).expect(200);
  return r.body as CaptureSession;
}

describe('captura', () => {
  it('é bloqueada sem termo ativo', async () => {
    const p = await h.http().post('/api/patients').set(auth(tok.auxA)).send({ name: 'Sem Termo' }).expect(201);
    const r = await h.http().post(`/api/patients/${p.body.id}/captures`).set(auth(tok.auxA)).expect(403);
    expect(r.body.code).toBe('CONSENT_REQUIRED');
  });

  it('fluxo completo: 5 vistas por upload direto, conclusão e reconstrução com template', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    expect(s).toMatchObject({ status: 'OPEN', photos: [] });

    // Concluir sem as 5 vistas falha e diz quais faltam.
    const early = await h.http().post(`/api/captures/${s.id}/complete`).set(auth(tok.auxA)).expect(400);
    expect(early.body.code).toBe('PHOTOS_MISSING');
    expect(early.body.details).toHaveLength(5);

    for (const a of PhotoAngle.options) {
      await uploadAngle(s.id, a, tok.auxA, a.endsWith('90') ? { validation: 'MANUAL', faceDetected: false, yawDeg: null } : {});
    }
    const full = (await h.http().get(`/api/captures/${s.id}`).set(auth(tok.auxA)).expect(200)).body as CaptureSession;
    expect(full.photos.map((p) => p.angle)).toEqual(PhotoAngle.options);
    expect(full.photos.find((p) => p.angle === 'LEFT_90')?.validation).toBe('MANUAL');

    // A URL de leitura devolve a própria foto.
    const img = await h.http().get(full.photos[0]!.url).expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');

    const rec = await h.http().post(`/api/captures/${s.id}/complete`).set(auth(tok.auxA)).expect(200);
    expect(rec.body).toMatchObject({ status: 'QUEUED', source: 'TEMPLATE', patientId });

    // Sessão encerrada não aceita mais fotos.
    await h.http().post(`/api/captures/${s.id}/uploads/FRONT`).set(auth(tok.auxA)).expect(409);

    expect(await h.app.get(ReconstructionQueue).drain()).toBe(1);
    const done = await h.http().get(`/api/reconstructions/${rec.body.id}`).set(auth(tok.proA)).expect(200);
    expect(done.body).toMatchObject({ status: 'DONE', source: 'TEMPLATE', meshUrl: null, attempts: 1 });

    const list = await h.http().get(`/api/patients/${patientId}/captures`).set(auth(tok.proA)).expect(200);
    expect(list.body[0]).toMatchObject({ status: 'COMPLETED', photoCount: 5 });
    expect(list.body[0].reconstructions[0].status).toBe('DONE');
  });

  it('refazer uma vista substitui o arquivo antigo; descartar apaga', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    await uploadAngle(s.id, 'FRONT');
    const first = await h.prisma.photo.findFirstOrThrow({ where: { captureId: s.id } });
    await uploadAngle(s.id, 'FRONT');
    const second = await h.prisma.photo.findFirstOrThrow({ where: { captureId: s.id } });
    expect(second.storageKey).not.toBe(first.storageKey);
    expect(await h.app.get((await import('../src/storage/storage.service.js')).StorageService).head(first.storageKey)).toBeNull();

    const r = await h.http().delete(`/api/captures/${s.id}/photos/FRONT`).set(auth(tok.auxA)).expect(200);
    expect(r.body.photos).toHaveLength(0);
  });

  it('recusa chave de outra vista, arquivo ausente e arquivo que não é JPEG', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    const t = (await h.http().post(`/api/captures/${s.id}/uploads/FRONT`).set(auth(tok.auxA)).expect(200)).body as UploadTarget;

    const wrong = await h.http().put(`/api/captures/${s.id}/photos/LEFT_45`).set(auth(tok.auxA)).send(meta(t.key)).expect(400);
    expect(wrong.body.code).toBe('INVALID_KEY');
    const missing = await h.http().put(`/api/captures/${s.id}/photos/FRONT`).set(auth(tok.auxA)).send(meta(t.key)).expect(400);
    expect(missing.body.code).toBe('UPLOAD_MISSING');

    await h.http().put(t.url).set('Content-Type', 'image/jpeg').send(Buffer.from('<html>não é foto</html>')).expect(200);
    const notJpeg = await h.http().put(`/api/captures/${s.id}/photos/FRONT`).set(auth(tok.auxA)).send(meta(t.key)).expect(400);
    expect(notJpeg.body.code).toBe('UPLOAD_NOT_JPEG');
  });

  it('URL pré-assinada adulterada ou com método trocado é recusada', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    const t = (await h.http().post(`/api/captures/${s.id}/uploads/FRONT`).set(auth(tok.auxA)).expect(200)).body as UploadTarget;
    await h.http().put(t.url.slice(0, -2) + 'xx').send(JPEG).set('Content-Type', 'image/jpeg').expect(403);
    await h.http().get(t.url).expect(403); // token de PUT não serve para GET
  });

  it('cancelar apaga as fotos já enviadas', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    await uploadAngle(s.id, 'FRONT');
    await h.http().post(`/api/captures/${s.id}/cancel`).set(auth(tok.auxA)).expect(204);
    expect(await h.prisma.photo.count({ where: { captureId: s.id } })).toBe(0);
  });

  it('outra clínica não vê nem envia fotos para a sessão', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    await h.http().get(`/api/captures/${s.id}`).set(auth(tok.adminB)).expect(404);
    await h.http().post(`/api/captures/${s.id}/uploads/FRONT`).set(auth(tok.adminB)).expect(404);
    await h.http().post(`/api/captures/${s.id}/complete`).set(auth(tok.adminB)).expect(404);
    await h.http().get(`/api/patients/${patientId}/captures`).set(auth(tok.adminB)).expect(404);
  });
});

describe('simulações', () => {
  let reconstructionId: string;
  let patientId: string;

  beforeAll(async () => {
    patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    for (const a of PhotoAngle.options) await uploadAngle(s.id, a);
    reconstructionId = (await h.http().post(`/api/captures/${s.id}/complete`).set(auth(tok.auxA)).expect(200)).body.id;
  });

  it('só abre simulação com o modelo pronto', async () => {
    await h.http().post(`/api/reconstructions/${reconstructionId}/simulations`).set(auth(tok.proA)).send({}).expect(409);
    await h.app.get(ReconstructionQueue).drain();
  });

  it('auxiliar vê simulações, mas não cria nem exporta; profissional cria, salva versões e exporta', async () => {
    await h.http().post(`/api/reconstructions/${reconstructionId}/simulations`).set(auth(tok.auxA)).send({}).expect(403);
    const sim = await h.http().post(`/api/reconstructions/${reconstructionId}/simulations`).set(auth(tok.proA)).send({ name: 'Lábios' }).expect(201);
    expect(sim.body).toMatchObject({ name: 'Lábios', patientId, versions: [] });

    const bad = await h.http().post(`/api/simulations/${sim.body.id}/versions`).set(auth(tok.proA)).send({ name: 'x', params: { 'lips.upperVolume': 3 } }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');

    const v = await h.http().post(`/api/simulations/${sim.body.id}/versions`).set(auth(tok.proA)).send({
      name: 'Proposta 1',
      description: 'Conversa inicial',
      params: { 'lips.upperVolume': 0.4, 'lips.contour': 0.2 },
      thumbnailDataUrl: SIGNATURE,
    }).expect(201);
    expect(v.body.versions).toHaveLength(1);
    expect(v.body.versions[0]).toMatchObject({ name: 'Proposta 1', params: { 'lips.upperVolume': 0.4 } });
    await h.http().get(v.body.versions[0].thumbnailUrl).expect(200);

    await h.http().post(`/api/simulations/${sim.body.id}/export-log`).set(auth(tok.auxA)).send({ views: ['FRONT'] }).expect(403);
    await h.http().post(`/api/simulations/${sim.body.id}/export-log`).set(auth(tok.proA)).send({ views: ['FRONT', 'PROFILE'] }).expect(204);

    const list = await h.http().get(`/api/simulations?patientId=${patientId}`).set(auth(tok.auxA)).expect(200);
    expect(list.body[0]).toMatchObject({ id: sim.body.id, versionCount: 1, patientName: 'Paciente Captura' });

    // Outra clínica não enxerga.
    await h.http().get(`/api/simulations/${sim.body.id}`).set(auth(tok.adminB)).expect(404);
    const listB = await h.http().get('/api/simulations').set(auth(tok.adminB)).expect(200);
    expect(listB.body).toHaveLength(0);
    await h.http().get(`/api/reconstructions/${reconstructionId}`).set(auth(tok.adminB)).expect(404);
  });

  it('revogar o termo apaga capturas, reconstruções e simulações', async () => {
    const consents = await h.http().get(`/api/patients/${patientId}/consents`).set(auth(tok.proA)).expect(200);
    await h.http().post(`/api/consents/${consents.body[0].id}/revoke`).set(auth(tok.proA)).expect(200);
    expect(await h.prisma.simulation.count({ where: { patientId } })).toBe(0);
    expect(await h.prisma.reconstruction.count({ where: { patientId } })).toBe(0);
    const list = await h.http().get(`/api/simulations?patientId=${patientId}`).set(auth(tok.proA)).expect(200);
    expect(list.body).toHaveLength(0);
  });
});

describe('retenção', () => {
  it('expurga biométricos de pacientes inativos além do prazo e mantém o cadastro', async () => {
    const patientId = await patientWithConsent();
    const s = (await h.http().post(`/api/patients/${patientId}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    await uploadAngle(s.id, 'FRONT');
    const fresh = await patientWithConsent();
    const s2 = (await h.http().post(`/api/patients/${fresh}/captures`).set(auth(tok.auxA)).expect(201)).body as CaptureSession;
    await uploadAngle(s2.id, 'FRONT');

    await h.http().patch('/api/clinic').set(auth(tok.adminA)).send({ retentionDays: 30 }).expect(200);
    await h.prisma.patient.update({ where: { id: patientId }, data: { lastActivityAt: new Date(Date.now() - 60 * 86_400_000) } });

    await h.http().post('/api/clinic/retention/run').set(auth(tok.proA)).expect(403);
    const r = await h.http().post('/api/clinic/retention/run').set(auth(tok.adminA)).expect(200);
    expect(r.body.purgedPatients).toBe(1);
    expect(await h.prisma.captureSession.count({ where: { patientId } })).toBe(0);
    expect(await h.prisma.captureSession.count({ where: { patientId: fresh } })).toBe(1);
    await h.http().get(`/api/patients/${patientId}`).set(auth(tok.adminA)).expect(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'RETENTION_PURGE', entityId: patientId } })).toBe(1);
  });
});
