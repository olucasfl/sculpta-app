import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, login, makeUser, seedClinic, SIGNATURE, startHarness, type Harness } from './harness.js';

/**
 * Operações da plataforma (docs/CONTAS-CLINICAS-PERMISSOES.md): modo suporte (4.8), expurgo de clínica (4.9),
 * logo da clínica e RLS por clínica no banco (testes 10, 11 e 13).
 */
let h: Harness;
let A: Awaited<ReturnType<typeof seedClinic>>;
let admin: string;
const tokenOf = async (email: string) => (await login(h, email)).token;

beforeAll(async () => {
  process.env.SIGNUP_RATE_LIMIT = '1000';
  h = await startHarness();
  A = await seedClinic(h, 'Clinica Suporte');
  await makeUser(h, 'plataforma-ops@teste.test', { platformAdmin: true });
  admin = await tokenOf('plataforma-ops@teste.test');
  const owner = await tokenOf(A.admin.email);
  await h.http().post('/api/patients').set(auth(owner)).send({ name: 'Paciente do Suporte' }).expect(201);
});
afterAll(() => h?.close());

describe('modo suporte', () => {
  const open = (body: Record<string, unknown>, token = admin) => h.http().post('/api/platform/support-access').set(auth(token)).send(body);

  it('exige motivo escrito e duração dentro do teto; só administrador da plataforma abre', async () => {
    await open({ clinicId: A.clinic.id }).expect(400);
    await open({ clinicId: A.clinic.id, reason: 'curto' }).expect(400);
    await open({ clinicId: A.clinic.id, reason: 'Investigar erro na captura do paciente', minutes: 600 }).expect(400);
    await open({ clinicId: A.clinic.id, reason: 'Investigar erro na captura do paciente' }, await tokenOf(A.admin.email)).expect(403);
  });

  it('com a janela aberta lê pacientes, equipe e auditoria; não escreve nem vê fotos ou simulações', async () => {
    const win = await open({ clinicId: A.clinic.id, reason: 'Investigar erro na captura do paciente', minutes: 30 }).expect(201);
    expect(win.body).toMatchObject({ active: true, reason: 'Investigar erro na captura do paciente', admin: { name: 'plataforma-ops' } });

    const list = await h.http().get('/api/patients').set(auth(admin, A.clinic.id)).expect(200);
    expect(list.body.items[0].name).toBe('Paciente do Suporte');
    // Abrir um paciente fica registrado na auditoria da clínica, em nome do administrador.
    await h.http().get(`/api/patients/${list.body.items[0].id}`).set(auth(admin, A.clinic.id)).expect(200);
    await h.http().get('/api/users').set(auth(admin, A.clinic.id)).expect(200);
    await h.http().get('/api/audit').set(auth(admin, A.clinic.id)).expect(200);

    // Somente leitura.
    const w = await h.http().post('/api/patients').set(auth(admin, A.clinic.id)).send({ name: 'Nao Pode' }).expect(403);
    expect(w.body.code).toBe('SUPPORT_READ_ONLY');
    // Sem fotos e modelos 3D.
    const sims = await h.http().get('/api/simulations').set(auth(admin, A.clinic.id)).expect(403);
    expect(sims.body.code).toBe('SUPPORT_RESTRICTED');
    // A janela vale só para a clínica dela.
    const B = await seedClinic(h, 'Clinica Outra Suporte');
    await h.http().get('/api/patients').set(auth(admin, B.clinic.id)).expect(403);

    // /auth/me mostra o modo suporte.
    const me = await h.http().get('/api/auth/me').set(auth(admin, A.clinic.id)).expect(200);
    expect(me.body).toMatchObject({ clinicId: A.clinic.id, role: 'VISUALIZADOR', support: { id: win.body.id } });
  });

  it('a dona vê quem entrou, quando e por quê; quem não é da gerência não vê', async () => {
    const owner = await tokenOf(A.admin.email);
    const seen = await h.http().get('/api/clinic/support-access').set(auth(owner)).expect(200);
    expect(seen.body[0]).toMatchObject({ reason: 'Investigar erro na captura do paciente', active: true });
    await h.http().get('/api/clinic/support-access').set(auth(await tokenOf(A.pro.email))).expect(403);
    const audit = await h.http().get('/api/audit?pageSize=100').set(auth(owner)).expect(200);
    const actions = audit.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['SUPPORT_START', 'PATIENT_VIEW']));
  });

  it('encerrar a janela, ou ela vencer, derruba o acesso na hora', async () => {
    const win = await open({ clinicId: A.clinic.id, reason: 'Segunda janela de verificação', minutes: 15 }).expect(201);
    await h.http().get('/api/patients').set(auth(admin, A.clinic.id)).expect(200);
    await h.http().delete(`/api/platform/support-access/${win.body.id}`).set(auth(admin)).expect(204);
    const r = await h.http().get('/api/patients').set(auth(admin, A.clinic.id)).expect(403);
    expect(r.body.code).toBe('CLINIC_FORBIDDEN');

    const again = await open({ clinicId: A.clinic.id, reason: 'Terceira janela, vai vencer', minutes: 5 }).expect(201);
    await h.prisma.supportAccess.update({ where: { id: again.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.http().get('/api/patients').set(auth(admin, A.clinic.id)).expect(403);
  });
});

describe('expurgo de clínica excluída', () => {
  it('só expurga quando a carência venceu; apaga dados, anonimiza e bloqueia a equipe', async () => {
    const created = await h.http().post('/api/platform/clinics').set(auth(admin))
      .send({ name: 'Clínica a Expurgar', ownerEmail: 'expurgo@x.test' }).expect(201);
    const id = created.body.id as string;
    const signed = await h.http().post('/api/auth/signup')
      .send({ name: 'Dona Expurgo', email: 'expurgo@x.test', password: 'uma-senha-bem-longa-1', confirmPassword: 'uma-senha-bem-longa-1' }).expect(201);
    const owner = signed.body.accessToken as string;
    await h.http().post('/api/patients').set(auth(owner)).send({ name: 'Maria da Silva', phone: '(11) 90000-0000' }).expect(201);
    await h.http().put('/api/clinic/logo').set(auth(owner)).send({ dataUrl: SIGNATURE }).expect(200);
    const logoKey = (await h.prisma.clinic.findUniqueOrThrow({ where: { id } })).logoKey!;

    await h.http().post(`/api/platform/clinics/${id}/deletion`).set(auth(admin)).send({ confirmName: 'Clínica a Expurgar' }).expect(200);
    // Carência ainda não venceu: nada é apagado.
    expect((await h.http().post('/api/platform/clinics/purge-due').set(auth(admin)).expect(200)).body.purged).not.toContain(id);
    expect((await h.prisma.patient.findFirst({ where: { clinicId: id } }))!.name).toBe('Maria da Silva');

    await h.prisma.clinic.update({ where: { id }, data: { deletionScheduledAt: new Date(Date.now() - 1000) } });
    expect((await h.http().post('/api/platform/clinics/purge-due').set(auth(admin)).expect(200)).body.purged).toContain(id);

    const clinic = await h.prisma.clinic.findUniqueOrThrow({ where: { id } });
    expect(clinic).toMatchObject({ status: 'DELETED', logoKey: null });
    expect(clinic.purgedAt).toBeTruthy();
    const p = await h.prisma.patient.findFirstOrThrow({ where: { clinicId: id } });
    expect(p).toMatchObject({ name: 'Paciente removido', phone: null });
    expect(p.deletedAt).toBeTruthy();
    expect(await h.prisma.membership.count({ where: { clinicId: id } })).toBe(0);
    expect(await h.prisma.invitation.count({ where: { clinicId: id } })).toBe(0);
    expect(await h.app.get((await import('../src/storage/storage.service.js')).StorageService).head(logoKey)).toBeNull();
    // A equipe perde o acesso; o registro do expurgo fica na auditoria.
    const r = await h.http().get('/api/patients').set(auth(owner)).expect(403);
    expect(r.body.code).toBe('NO_CLINIC');
    expect(await h.prisma.auditLog.count({ where: { clinicId: id, action: 'CLINIC_PURGE' } })).toBe(1);
    // Não dá para agendar de novo nem abrir suporte.
    await h.http().post(`/api/platform/clinics/${id}/deletion`).set(auth(admin)).send({ confirmName: 'Clínica a Expurgar' }).expect(400);
    await h.http().post('/api/platform/support-access').set(auth(admin)).send({ clinicId: id, reason: 'Tentativa em clínica expurgada' }).expect(400);
  });
});

describe('logo da clínica', () => {
  it('dona envia, todos os membros veem; só PNG/JPEG de verdade, até 400 KB; remover apaga', async () => {
    const owner = await tokenOf(A.admin.email);
    const pro = await tokenOf(A.pro.email);
    await h.http().get('/api/clinic/logo').set(auth(owner)).expect(404);

    const ok = await h.http().put('/api/clinic/logo').set(auth(owner)).send({ dataUrl: SIGNATURE }).expect(200);
    expect(ok.body.hasLogo).toBe(true);
    const got = await h.http().get('/api/clinic/logo').set(auth(pro)).expect(200);
    expect(Buffer.from(got.body).subarray(0, 4).toString('hex')).toBe('89504e47');

    await h.http().put('/api/clinic/logo').set(auth(pro)).send({ dataUrl: SIGNATURE }).expect(403);
    // Cabeçalho diz PNG, conteúdo não é: recusa.
    const fake = `data:image/png;base64,${Buffer.alloc(200, 7).toString('base64')}`;
    expect((await h.http().put('/api/clinic/logo').set(auth(owner)).send({ dataUrl: fake }).expect(400)).body.code).toBe('LOGO_FORMAT');
    // Grande demais.
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(450_000)]).toString('base64')}`;
    expect((await h.http().put('/api/clinic/logo').set(auth(owner)).send({ dataUrl: big }).expect(400)).body.code).toBe('LOGO_SIZE');
    // Formato não aceito (SVG pode carregar script).
    await h.http().put('/api/clinic/logo').set(auth(owner)).send({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }).expect(400);

    await h.http().delete('/api/clinic/logo').set(auth(owner)).expect(204);
    await h.http().get('/api/clinic/logo').set(auth(owner)).expect(404);
  });
});

describe('RLS por clínica (papel sculpta_app)', () => {
  it('sem app.clinic_id vê zero linhas; com ele vê só a própria clínica; não escreve em outra', async () => {
    const db = await PGlite.create();
    const dir = join(import.meta.dirname, '..', 'prisma', 'migrations');
    const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const n of names) await db.exec(await readFile(join(dir, n, 'migration.sql'), 'utf8'));

    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    await db.exec(`
      INSERT INTO clinics (id, name) VALUES ('${a}', 'A'), ('${b}', 'B');
      INSERT INTO patients (id, clinic_id, name, updated_at) VALUES
        (gen_random_uuid(), '${a}', 'Paciente A', now()), (gen_random_uuid(), '${b}', 'Paciente B', now());
    `);
    const count = async (sql: string) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`)).rows[0]!.n);

    await db.exec('SET ROLE sculpta_app');
    expect(await count('patients')).toBe(0); // sem clínica definida: nada
    await db.exec(`SELECT set_config('app.clinic_id', '${a}', false)`);
    expect(await count('patients')).toBe(1);
    expect((await db.query<{ name: string }>('SELECT name FROM patients')).rows[0]!.name).toBe('Paciente A');
    // Escrever na clínica B estando na A: a política recusa.
    await expect(db.exec(`INSERT INTO patients (id, clinic_id, name, updated_at) VALUES (gen_random_uuid(), '${b}', 'Invasor', now())`)).rejects.toThrow();
    // Atualizar linha da B não afeta nada (a linha nem é visível).
    await db.exec(`UPDATE patients SET name = 'X' WHERE clinic_id = '${b}'`);
    await db.exec(`SELECT set_config('app.clinic_id', '${b}', false)`);
    expect((await db.query<{ name: string }>('SELECT name FROM patients')).rows[0]!.name).toBe('Paciente B');
    // Contas e clínicas não são acessíveis ao papel restrito.
    await expect(db.query('SELECT 1 FROM users')).rejects.toThrow();
    await db.exec('RESET ROLE');
    expect(await count('patients')).toBe(2);
    await db.close();
  });
});
