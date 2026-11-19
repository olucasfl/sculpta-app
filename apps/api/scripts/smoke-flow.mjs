// Teste de fumaça do fluxo completo contra uma API rodando (dev):
// login → termo → captura das 5 vistas (upload direto) → fila/worker → simulação.
// Uso: node scripts/smoke-flow.mjs [baseUrl] (padrão http://localhost:3000)
// Fotos reais (dev local, nada é versionado): SMOKE_PHOTOS_DIR=<pasta com ANGULO-xxxx.jpg> e, com o worker FLAME
// (~1 min em CPU), SMOKE_WAIT_S=240. Sem SMOKE_PHOTOS_DIR usa JPEGs de mentira (só o contrato).
// Credenciais: SMOKE_EMAIL / SMOKE_PASSWORD (padrão: usuário profissional do seed).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:3000';
const photosDir = process.env.SMOKE_PHOTOS_DIR;
const waitS = Number(process.env.SMOKE_WAIT_S ?? 30);
const email = process.env.SMOKE_EMAIL ?? 'profissional@demo.local';
const password = process.env.SMOKE_PASSWORD ?? process.env.SEED_PASSWORD;
if (!password) throw new Error('Defina SMOKE_PASSWORD (ou SEED_PASSWORD)');

const json = async (res) => {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
};
const login = await json(await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}));
const auth = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
const api = (path, init = {}) => fetch(`${base}/api${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) } }).then(json);

const patient = await api('/patients', { method: 'POST', body: JSON.stringify({ name: photosDir ? 'Paciente de teste (fotos reais, local)' : 'Paciente Fumaça (fictício)' }) });
// PNG 1x1 como assinatura de teste
const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const { CURRENT_TERM } = await import('@sim/contracts');
await api(`/patients/${patient.id}/consents`, {
  method: 'POST',
  body: JSON.stringify({ termVersion: CURRENT_TERM.version, scopes: ['SIMULATION'], signerName: patient.name, signerRelation: 'PACIENTE', signatureDataUrl: sig }),
});
const capture = await api(`/patients/${patient.id}/captures`, { method: 'POST' });
const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 9)]);
const real = new Map(
  photosDir ? readdirSync(photosDir).filter((n) => n.endsWith('.jpg')).map((n) => [n.split('-')[0], readFileSync(join(photosDir, n))]) : [],
);
const angles = photosDir ? [...real.keys()] : ['FRONT', 'LEFT_45', 'RIGHT_45', 'LEFT_90', 'RIGHT_90'];
for (const angle of angles) {
  const jpeg = real.get(angle) ?? fake;
  const t = await api(`/captures/${capture.id}/uploads/${angle}`, { method: 'POST' });
  const put = await fetch(t.url.startsWith('http') ? t.url : `${base}${t.url}`, { method: 'PUT', headers: t.headers, body: jpeg });
  if (!put.ok) throw new Error(`upload ${angle}: ${put.status}`);
  await api(`/captures/${capture.id}/photos/${angle}`, {
    method: 'PUT',
    body: JSON.stringify({ key: t.key, width: 1200, height: 1600, yawDeg: null, sharpness: null, faceDetected: false, faceHeightRatio: null, validation: 'MANUAL', source: 'UPLOAD' }),
  });
}
const rec = await api(`/captures/${capture.id}/complete`, { method: 'POST' });
let r = rec;
for (let i = 0; i < waitS && !['DONE', 'FAILED'].includes(r.status); i++) {
  await new Promise((ok) => setTimeout(ok, 1000));
  r = await api(`/reconstructions/${rec.id}`);
}
if (r.status !== 'DONE') throw new Error(`reconstrução terminou em ${r.status}: ${r.error}`);
const sim = await api(`/reconstructions/${rec.id}/simulations`, { method: 'POST', body: JSON.stringify({ name: 'Fumaça' }) });
console.log(
  JSON.stringify({
    patient: patient.id,
    reconstruction: { status: r.status, source: r.source, qualityScore: r.qualityScore ?? null, mesh: Boolean(r.meshUrl) },
    simulation: sim.id,
  }),
);
