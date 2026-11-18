import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, login, makeUser, seedClinic, startHarness, type Harness } from './harness.js';

/**
 * Contas, vínculos e permissões (docs/CONTAS-CLINICAS-PERMISSOES.md, seção 10).
 * Cobre os testes 1, 2, 3, 4, 8 e 9 da lista: isolamento, cabeçalho forjado, papéis,
 * escalada, multi-clínica e suspensão imediata.
 */
let h: Harness;
let A: Awaited<ReturnType<typeof seedClinic>>;
let B: Awaited<ReturnType<typeof seedClinic>>;
let multi: Awaited<ReturnType<typeof makeUser>>;

const tokenOf = async (email: string) => (await login(h, email)).token;

beforeAll(async () => {
  h = await startHarness();
  A = await seedClinic(h, 'Clinica Alfa');
  B = await seedClinic(h, 'Clinica Beta');
  // Mesma conta em duas clínicas, com papéis diferentes em cada uma.
  multi = await makeUser(h, 'multi@teste.test', { clinicId: A.clinic.id, role: 'PROFISSIONAL' });
  await h.prisma.membership.create({ data: { userId: multi.id, clinicId: B.clinic.id, role: 'RECEPCAO' } });
});
afterAll(() => h?.close());

describe('clínica ativa (X-Clinic-Id)', () => {
  it('quem tem uma clínica só entra direto, sem cabeçalho', async () => {
    const t = await tokenOf(A.pro.email);
    await h.http().get('/api/patients').set(auth(t)).expect(200);
  });

  it('cabeçalho de clínica sem vínculo e de clínica inexistente dão a MESMA resposta', async () => {
    const t = await tokenOf(A.pro.email);
    const other = await h.http().get('/api/patients').set(auth(t, B.clinic.id)).expect(403);
    const ghost = await h.http().get('/api/patients').set(auth(t, '00000000-0000-4000-8000-000000000000')).expect(403);
    const junk = await h.http().get('/api/patients').set(auth(t, 'nao-e-uuid')).expect(403);
    expect(other.body).toEqual(ghost.body);
    expect(other.body).toEqual(junk.body);
    expect(other.body.code).toBe('CLINIC_FORBIDDEN');
  });

  it('quem está em duas clínicas precisa escolher; cada escolha mostra só os dados da clínica', async () => {
    const owner = await tokenOf(A.admin.email);
    const ownerB = await tokenOf(B.admin.email);
    const pa = await h.http().post('/api/patients').set(auth(owner)).send({ name: 'Paciente da Alfa' }).expect(201);
    const pb = await h.http().post('/api/patients').set(auth(ownerB)).send({ name: 'Paciente da Beta' }).expect(201);

    const t = await tokenOf('multi@teste.test');
    const need = await h.http().get('/api/patients').set(auth(t)).expect(400);
    expect(need.body.code).toBe('CLINIC_REQUIRED');

    const inA = await h.http().get('/api/patients').set(auth(t, A.clinic.id)).expect(200);
    expect(inA.body.items.map((p: { name: string }) => p.name)).toEqual(['Paciente da Alfa']);
    const inB = await h.http().get('/api/patients').set(auth(t, B.clinic.id)).expect(200);
    expect(inB.body.items.map((p: { name: string }) => p.name)).toEqual(['Paciente da Beta']);

    // Paciente da outra clínica: 404, mesmo sabendo o id e tendo vínculo nas duas.
    await h.http().get(`/api/patients/${pb.body.id}`).set(auth(t, A.clinic.id)).expect(404);
    await h.http().get(`/api/patients/${pa.body.id}`).set(auth(t, B.clinic.id)).expect(404);
  });

  it('o papel vale por clínica: profissional na Alfa, recepção na Beta', async () => {
    const t = await tokenOf('multi@teste.test');
    const me = await h.http().get('/api/auth/me').set(auth(t)).expect(200);
    expect(me.body.clinics).toEqual([
      { id: A.clinic.id, name: 'Clinica Alfa', role: 'PROFISSIONAL' },
      { id: B.clinic.id, name: 'Clinica Beta', role: 'RECEPCAO' },
    ]);
    expect(me.body.clinicId).toBeNull();
    const chosen = await h.http().get('/api/auth/me').set(auth(t, B.clinic.id)).expect(200);
    expect(chosen.body).toMatchObject({ clinicId: B.clinic.id, role: 'RECEPCAO' });
    // Profissional pode capturar na Alfa; recepção não pode na Beta.
    const pat = await h.http().post('/api/patients').set(auth(t, B.clinic.id)).send({ name: 'Paciente Beta Recepção' }).expect(201);
    await h.http().post(`/api/patients/${pat.body.id}/captures`).set(auth(t, B.clinic.id)).expect(403);
  });

  it('suspender o vínculo vale na próxima chamada, sem esperar o token expirar', async () => {
    const u = await makeUser(h, 'susp@teste.test', { clinicId: A.clinic.id, role: 'AUXILIAR' });
    const t = await tokenOf('susp@teste.test');
    await h.http().get('/api/patients').set(auth(t)).expect(200);
    await h.prisma.membership.update({
      where: { userId_clinicId: { userId: u.id, clinicId: A.clinic.id } },
      data: { status: 'SUSPENDED' },
    });
    await h.http().get('/api/patients').set(auth(t)).expect(403);
  });

  it('clínica suspensa bloqueia todos os membros', async () => {
    const C = await seedClinic(h, 'Clinica Gama');
    const t = await tokenOf(C.pro.email);
    await h.http().get('/api/patients').set(auth(t)).expect(200);
    await h.prisma.clinic.update({ where: { id: C.clinic.id }, data: { status: 'SUSPENDED' } });
    // Com a clínica suspensa, o vínculo deixa de contar: a conta aparece sem clínicas.
    const r = await h.http().get('/api/patients').set(auth(t, C.clinic.id)).expect(403);
    expect(r.body.code).toBe('CLINIC_SUSPENDED');
  });
});

describe('permissões na API (por papel)', () => {
  it('recepção cadastra paciente e termo, mas não faz captura nem vê fotos', async () => {
    const t = await tokenOf(A.recep.email);
    const p = await h.http().post('/api/patients').set(auth(t)).send({ name: 'Cadastro Recepção' }).expect(201);
    await h.http().post(`/api/patients/${p.body.id}/captures`).set(auth(t)).expect(403);
    await h.http().get(`/api/patients/${p.body.id}/captures`).set(auth(t)).expect(403);
    await h.http().get('/api/simulations').set(auth(t)).expect(403);
  });

  it('visualizador só lê: não cadastra nem edita', async () => {
    const t = await tokenOf(A.viewer.email);
    await h.http().get('/api/patients').set(auth(t)).expect(200);
    await h.http().post('/api/patients').set(auth(t)).send({ name: 'Nao' }).expect(403);
    await h.http().get('/api/simulations').set(auth(t)).expect(200);
  });

  it('equipe e auditoria: só dona e gerente', async () => {
    for (const email of [A.pro.email, A.aux.email, A.recep.email, A.viewer.email]) {
      const t = await tokenOf(email);
      await h.http().get('/api/users').set(auth(t)).expect(403);
      await h.http().get('/api/audit').set(auth(t)).expect(403);
    }
    for (const email of [A.admin.email, A.gerente.email]) {
      const t = await tokenOf(email);
      await h.http().get('/api/users').set(auth(t)).expect(200);
      await h.http().get('/api/audit').set(auth(t)).expect(200);
    }
  });

  it('retenção da clínica: só a dona', async () => {
    await h.http().post('/api/clinic/retention/run').set(auth(await tokenOf(A.gerente.email))).expect(403);
    await h.http().post('/api/clinic/retention/run').set(auth(await tokenOf(A.admin.email))).expect(200);
  });
});

describe('equipe: escalada e última dona', () => {
  const body = (email: string, role: string) => ({ name: 'Pessoa Teste', email, password: 'senha-longa-123', role });

  it('gerente não cria dona; dona cria qualquer papel', async () => {
    const g = await tokenOf(A.gerente.email);
    await h.http().post('/api/users').set(auth(g)).send(body('nova-dona@x.test', 'OWNER')).expect(403);
    await h.http().post('/api/users').set(auth(g)).send(body('novo-gerente@x.test', 'GERENTE')).expect(201);
    const o = await tokenOf(A.admin.email);
    await h.http().post('/api/users').set(auth(o)).send(body('nova-dona@x.test', 'OWNER')).expect(201);
  });

  it('e-mail que já tem conta não é adicionado por aqui (sem revelar nada além do conflito)', async () => {
    const o = await tokenOf(A.admin.email);
    const r = await h.http().post('/api/users').set(auth(o)).send(body(B.pro.email, 'PROFISSIONAL')).expect(409);
    expect(r.body.code).toBe('EMAIL_IN_USE');
  });

  it('gerente não mexe em dona, e ninguém promove a si mesmo', async () => {
    const g = await tokenOf(A.gerente.email);
    await h.http().patch(`/api/users/${A.admin.id}`).set(auth(g)).send({ active: false }).expect(403);
    await h.http().patch(`/api/users/${A.admin.id}`).set(auth(g)).send({ role: 'RECEPCAO' }).expect(403);
    await h.http().patch(`/api/users/${A.gerente.id}`).set(auth(g)).send({ role: 'OWNER' }).expect(403);
    await h.http().patch(`/api/users/${A.pro.id}`).set(auth(g)).send({ role: 'OWNER' }).expect(403);
  });

  it('papéis sem permissão de equipe não mexem em ninguém', async () => {
    const p = await tokenOf(A.pro.email);
    await h.http().patch(`/api/users/${A.recep.id}`).set(auth(p)).send({ role: 'OWNER' }).expect(403);
  });

  it('a dona não se rebaixa nem se suspende sozinha, e o gerente não a alcança', async () => {
    const D = await seedClinic(h, 'Clinica Delta');
    const second = await makeUser(h, 'dona2@delta.test', { clinicId: D.clinic.id, role: 'OWNER' });
    const o2 = await tokenOf(second.email);
    // Há duas donas: rebaixar a primeira é permitido...
    await h.http().patch(`/api/users/${D.admin.id}`).set(auth(o2)).send({ role: 'GERENTE' }).expect(200);
    // ...agora só resta uma: ela não pode ser rebaixada por outra dona que não existe,
    // e a própria dona não pode rebaixar nem suspender a si mesma.
    await h.http().patch(`/api/users/${second.id}`).set(auth(o2)).send({ active: false }).expect(400);
    await h.http().patch(`/api/users/${second.id}`).set(auth(o2)).send({ role: 'GERENTE' }).expect(400);
    // Um gerente não consegue tocar na dona (403), então ela fica protegida.
    const g = await tokenOf(D.admin.email);
    await h.http().patch(`/api/users/${second.id}`).set(auth(g)).send({ active: false }).expect(403);
  });

  it('a lista de equipe mostra só a própria clínica', async () => {
    const o = await tokenOf(A.admin.email);
    const list = await h.http().get('/api/users').set(auth(o)).expect(200);
    const emails = list.body.map((u: { email: string }) => u.email);
    expect(emails).toContain(A.pro.email);
    expect(emails).not.toContain(B.pro.email);
  });
});
