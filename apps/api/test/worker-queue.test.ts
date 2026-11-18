import { CURRENT_TERM, PhotoAngle, ReconstructRequest, WORKER_SIGNATURE_HEADER, WORKER_TIMESTAMP_HEADER } from '@sim/contracts';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconstructionQueue } from '../src/reconstructions/reconstruction-queue.js';
import { verifyWorkerBody } from '../src/reconstructions/worker-signature.js';
import { auth, login, seedClinic, SIGNATURE, startHarness, type Harness } from './harness.js';

const SECRET = 'segredo-do-worker-com-pelo-menos-32-caracteres';
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(64, 1)]);
type Mode = 'ok' | 'face-not-found' | 'internal' | 'no-upload';

/** Worker falso que segue o contrato: confere HMAC, baixa as fotos e sobe o .glb. */
function fakeWorker() {
  const state = { mode: 'ok' as Mode, calls: 0, badSignatures: 0, downloaded: 0 };
  const server: Server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const ok = verifyWorkerBody(SECRET, req.headers[WORKER_TIMESTAMP_HEADER] as string, req.headers[WORKER_SIGNATURE_HEADER] as string, body);
    if (!ok) {
      state.badSignatures++;
      res.writeHead(401).end();
      return;
    }
    state.calls++;
    const job = ReconstructRequest.parse(JSON.parse(body));
    const reply = (o: object) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jobId: job.jobId, ...o }));
    if (state.mode === 'face-not-found') return reply({ status: 'FAILED', code: 'FACE_NOT_FOUND', detail: 'Foto LEFT_90 sem rosto' });
    if (state.mode === 'internal') return reply({ status: 'FAILED', code: 'INTERNAL', detail: 'GPU indisponível' });
    for (const p of job.photos) {
      const r = await fetch(p.url);
      if (r.ok) state.downloaded++;
    }
    if (state.mode !== 'no-upload') {
      await fetch(job.output.meshUploadUrl, { method: 'PUT', headers: { 'Content-Type': 'model/gltf-binary' }, body: GLB });
    }
    reply({ status: 'DONE', source: 'VGGTFACE', metrics: { durationMs: 1234, vertices: 5023, qualityScore: 0.87 } });
  });
  return { server, state };
}

let h: Harness;
let worker: ReturnType<typeof fakeWorker>;
let tok: { pro: string; recep: string };
let queue: ReconstructionQueue;

beforeAll(async () => {
  worker = fakeWorker();
  await new Promise<void>((r) => worker.server.listen(0, '127.0.0.1', r));
  const port = (worker.server.address() as AddressInfo).port;
  h = await startHarness({ listen: true, env: { WORKER_URL: `http://127.0.0.1:${port}`, WORKER_SECRET: SECRET, WORKER_TIMEOUT_MS: '5000' } });
  const A = await seedClinic(h, 'Clinica W');
  tok = { pro: (await login(h, A.pro.email)).token, recep: (await login(h, A.recep.email)).token };
  queue = h.app.get(ReconstructionQueue);
});
afterAll(async () => {
  await h?.close();
  worker?.server.close();
});

async function completedCapture() {
  const p = await h.http().post('/api/patients').set(auth(tok.pro)).send({ name: 'Paciente Worker' }).expect(201);
  await h.http().post(`/api/patients/${p.body.id}/consents`).set(auth(tok.pro)).send({
    termVersion: CURRENT_TERM.version, scopes: ['SIMULATION'], signerName: 'Paciente Worker', signerRelation: 'PACIENTE', signatureDataUrl: SIGNATURE,
  }).expect(201);
  const s = await h.http().post(`/api/patients/${p.body.id}/captures`).set(auth(tok.pro)).expect(201);
  for (const a of PhotoAngle.options) {
    const t = await h.http().post(`/api/captures/${s.body.id}/uploads/${a}`).set(auth(tok.pro)).expect(200);
    await h.http().put(t.body.url).set('Content-Type', 'image/jpeg').send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256)])).expect(200);
    await h.http().put(`/api/captures/${s.body.id}/photos/${a}`).set(auth(tok.pro)).send({
      key: t.body.key, width: 1000, height: 1000, yawDeg: 0, sharpness: 100, faceDetected: true, faceHeightRatio: 0.5, validation: 'AUTO', source: 'UPLOAD',
    }).expect(200);
  }
  const rec = await h.http().post(`/api/captures/${s.body.id}/complete`).set(auth(tok.pro)).expect(200);
  expect(rec.body.source).toBe('VGGTFACE');
  return rec.body.id as string;
}

const get = (id: string) => h.http().get(`/api/reconstructions/${id}`).set(auth(tok.pro)).expect(200).then((r) => r.body);
const releaseRetry = (id: string) => h.prisma.reconstruction.update({ where: { id }, data: { nextRunAt: new Date() } });

describe('fila + worker', () => {
  it('assina com HMAC, entrega URLs pré-assinadas e grava o .glb', async () => {
    worker.state.mode = 'ok';
    const id = await completedCapture();
    await queue.drain();
    const r = await get(id);
    expect(r).toMatchObject({ status: 'DONE', source: 'VGGTFACE', qualityScore: 0.87, attempts: 1 });
    expect(worker.state.downloaded).toBe(PhotoAngle.options.length);
    expect(worker.state.badSignatures).toBe(0);
    const mesh = await h.http().get(r.meshUrl).responseType('blob').expect(200);
    expect(mesh.headers['content-type']).toBe('model/gltf-binary');
    expect(Buffer.from(mesh.body).subarray(0, 4).toString()).toBe('glTF');
  });

  it('erro de entrada falha direto, sem nova tentativa', async () => {
    worker.state.mode = 'face-not-found';
    const id = await completedCapture();
    await queue.drain();
    expect(await get(id)).toMatchObject({ status: 'FAILED', error: 'FACE_NOT_FOUND', errorDetail: 'Foto LEFT_90 sem rosto', attempts: 1 });
  });

  it('erro interno tenta de novo até 3 vezes e então falha', async () => {
    worker.state.mode = 'internal';
    const id = await completedCapture();
    await queue.drain();
    expect(await get(id)).toMatchObject({ status: 'QUEUED', error: 'INTERNAL', attempts: 1 });
    await queue.drain(); // ainda no backoff
    expect((await get(id)).attempts).toBe(1);
    await releaseRetry(id);
    await queue.drain();
    await releaseRetry(id);
    await queue.drain();
    expect(await get(id)).toMatchObject({ status: 'FAILED', error: 'INTERNAL', attempts: 3 });
  });

  it('worker que diz DONE sem enviar o .glb não é aceito', async () => {
    worker.state.mode = 'no-upload';
    const id = await completedCapture();
    await queue.drain();
    expect(await get(id)).toMatchObject({ status: 'QUEUED', error: 'INTERNAL' });
    worker.state.mode = 'ok';
    await releaseRetry(id);
    await queue.drain();
    expect(await get(id)).toMatchObject({ status: 'DONE', attempts: 2 });
  });

  it('job travado em PROCESSING volta para a fila', async () => {
    worker.state.mode = 'ok';
    const id = await completedCapture();
    await h.prisma.reconstruction.update({ where: { id }, data: { status: 'PROCESSING', lockedAt: new Date(Date.now() - 60 * 60_000) } });
    await queue.drain();
    expect((await get(id)).status).toBe('DONE');
  });
});
