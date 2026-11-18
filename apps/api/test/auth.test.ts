import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, login, PASSWORD, seedClinic, startHarness, type Harness } from './harness.js';

let h: Harness;
let seed: Awaited<ReturnType<typeof seedClinic>>;

beforeAll(async () => {
  h = await startHarness();
  seed = await seedClinic(h, 'Clinica Auth');
});
afterAll(() => h?.close());

describe('auth', () => {
  it('health é público', async () => {
    await h.http().get('/api/health').expect(200, { status: 'ok', db: true });
  });

  it('rotas exigem token', async () => {
    const res = await h.http().get('/api/patients').expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('login devolve access token, usuário e cookie httpOnly', async () => {
    const res = await h.http().post('/api/auth/login').send({ email: seed.admin.email.toUpperCase(), password: PASSWORD }).expect(200);
    expect(res.body.user).toMatchObject({ email: seed.admin.email, role: 'OWNER', clinicName: 'Clinica Auth', clinicId: seed.clinic.id, isPlatformAdmin: false });
    expect(res.body.user.clinics).toEqual([{ id: seed.clinic.id, name: 'Clinica Auth', role: 'OWNER' }]);
    // O token não carrega clínica nem papel: isso vem do vínculo, a cada chamada.
    const payload = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString());
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sim_rt=.+HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
    const a = await h.http().post('/api/auth/login').send({ email: seed.admin.email, password: 'errada-1234' }).expect(401);
    const b = await h.http().post('/api/auth/login').send({ email: 'ninguem@x.test', password: 'errada-1234' }).expect(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('valida o body com o contrato', async () => {
    const res = await h.http().post('/api/auth/login').send({ email: 'nao-e-email' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(['email', 'password']);
  });

  it('refresh rotaciona o token e o reuso derruba a família', async () => {
    const s = await login(h, seed.pro.email);
    const r1 = await h.http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(200);
    const newCookie = String(r1.headers['set-cookie']).split(';')[0]!;
    expect(newCookie).not.toBe(s.cookie);

    // Reuso do cookie antigo: sinal de roubo.
    const reuse = await h.http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');
    // O token novo, da mesma família, também morreu.
    await h.http().post('/api/auth/refresh').set('Cookie', newCookie).expect(401);
  });

  it('logout revoga a sessão', async () => {
    const s = await login(h, seed.recep.email);
    await h.http().post('/api/auth/logout').set('Cookie', s.cookie).expect(204);
    await h.http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
  });

  it('membro suspenso perde o acesso à clínica na hora, mesmo com token válido', async () => {
    const admin = await login(h, seed.admin.email);
    const recep = await login(h, seed.recep.email);
    await h.http().get('/api/patients').set(auth(recep.token)).expect(200);
    await h.http().patch(`/api/users/${seed.recep.id}`).set(auth(admin.token)).send({ active: false }).expect(200);
    const blocked = await h.http().get('/api/patients').set(auth(recep.token)).expect(403);
    expect(blocked.body.code).toBe('NO_CLINIC');
    // A conta continua ativa (só o vínculo com a clínica foi suspenso): vê que não tem clínicas.
    const me = await h.http().get('/api/auth/me').set(auth(recep.token)).expect(200);
    expect(me.body.clinics).toEqual([]);
  });

  it('admin não pode se rebaixar', async () => {
    const admin = await login(h, seed.admin.email);
    await h.http().patch(`/api/users/${seed.admin.id}`).set(auth(admin.token)).send({ role: 'RECEPCAO' }).expect(400);
    await h.http().patch(`/api/users/${seed.admin.id}`).set(auth(admin.token)).send({ active: false }).expect(400);
  });

  it('login é limitado por IP', async () => {
    process.env.LOGIN_RATE_LIMIT = '3';
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await h.http().post('/api/auth/login').send({ email: seed.admin.email, password: 'errada-1234' });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
    process.env.LOGIN_RATE_LIMIT = '100';
  });
});
