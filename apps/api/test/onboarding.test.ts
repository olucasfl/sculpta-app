import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, login, makeUser, PASSWORD, seedClinic, startHarness, type Harness } from './harness.js';

/**
 * Criar conta, convites por e-mail e console da plataforma
 * (docs/CONTAS-CLINICAS-PERMISSOES.md, seções 4 e 6). Cobre os testes 5, 7 (parcial), 8 e 10 (parcial).
 * Sem verificação de e-mail por enquanto (decisão de 18/11/2026).
 */
let h: Harness;
let A: Awaited<ReturnType<typeof seedClinic>>;
let admin: { token: string };

const tokenOf = async (email: string) => (await login(h, email)).token;
/** Envia a confirmação igual à senha, a menos que o teste passe `confirmPassword`. */
const signup = (body: Record<string, unknown>) =>
  h.http().post('/api/auth/signup').send({ confirmPassword: body.password, ...body });
const NEW_PASSWORD = 'uma-senha-bem-longa-1';

beforeAll(async () => {
  process.env.SIGNUP_RATE_LIMIT = '1000';
  h = await startHarness();
  A = await seedClinic(h, 'Clinica Onboarding');
  await makeUser(h, 'plataforma@teste.test', { platformAdmin: true });
  admin = { token: await tokenOf('plataforma@teste.test') };
});
afterAll(() => h?.close());

describe('criar conta', () => {
  it('cria a conta já ativa, abre a sessão e não dá acesso a nenhuma clínica', async () => {
    const r = await signup({ name: 'Maria Nova', email: 'Maria@Nova.TEST', password: NEW_PASSWORD }).expect(201);
    expect(r.body.user).toMatchObject({ email: 'maria@nova.test', clinics: [], clinicId: null, isPlatformAdmin: false });
    expect(String(r.headers['set-cookie'])).toMatch(/sim_rt=.+HttpOnly/);
    // Sem clínica: as rotas de clínica respondem 403 NO_CLINIC.
    const blocked = await h.http().get('/api/patients').set(auth(r.body.accessToken)).expect(403);
    expect(blocked.body.code).toBe('NO_CLINIC');
    // E entra normalmente depois.
    await h.http().post('/api/auth/login').send({ email: 'maria@nova.test', password: NEW_PASSWORD }).expect(200);
  });

  it('e-mail já usado é recusado; senha curta e e-mail inválido são validados', async () => {
    await signup({ name: 'Outra', email: 'maria@nova.test', password: NEW_PASSWORD }).expect(409);
    const curta = await signup({ name: 'Ana Silva', email: 'ana@x.test', password: 'curta' }).expect(400);
    expect(curta.body.code).toBe('VALIDATION_ERROR');
  });

  it('exige digitar a senha duas vezes: confirmação diferente ou ausente é recusada e nada é criado', async () => {
    const diff = await signup({ name: 'Dupla Senha', email: 'dupla@x.test', password: NEW_PASSWORD, confirmPassword: 'outra-senha-longa-9' }).expect(400);
    expect(diff.body.code).toBe('VALIDATION_ERROR');
    expect(diff.body.details).toEqual([{ path: 'confirmPassword', message: 'As senhas não conferem' }]);
    // Sem o campo de confirmação (cliente antigo ou chamada direta à API): também recusa.
    await h.http().post('/api/auth/signup').send({ name: 'Dupla Senha', email: 'dupla@x.test', password: NEW_PASSWORD }).expect(400);
    expect(await h.prisma.user.findUnique({ where: { email: 'dupla@x.test' } })).toBeNull();
    await signup({ name: 'Dupla Senha', email: 'dupla@x.test', password: NEW_PASSWORD }).expect(201);
    await signup({ name: 'Ana Silva', email: 'nao-e-email', password: NEW_PASSWORD }).expect(400);
  });

  it('trocar a senha exige a atual e encerra as outras sessões, mas não a atual', async () => {
    await signup({ name: 'Troca Senha', email: 'troca@x.test', password: NEW_PASSWORD }).expect(201);
    const a = await h.http().post('/api/auth/login').send({ email: 'troca@x.test', password: NEW_PASSWORD }).expect(200);
    const b = await h.http().post('/api/auth/login').send({ email: 'troca@x.test', password: NEW_PASSWORD }).expect(200);
    const cookieA = String(a.headers['set-cookie']).split(';')[0]!;
    const cookieB = String(b.headers['set-cookie']).split(';')[0]!;

    await h.http().post('/api/auth/change-password').set(auth(a.body.accessToken)).set('Cookie', cookieA)
      .send({ currentPassword: 'errada-errada', newPassword: 'outra-senha-longa-2', confirmNewPassword: 'outra-senha-longa-2' }).expect(401);
    // Confirmação diferente: recusa antes de mexer em qualquer coisa.
    const mismatch = await h.http().post('/api/auth/change-password').set(auth(a.body.accessToken)).set('Cookie', cookieA)
      .send({ currentPassword: NEW_PASSWORD, newPassword: 'outra-senha-longa-2', confirmNewPassword: 'outra-senha-longa-3' }).expect(400);
    expect(mismatch.body.details[0].path).toBe('confirmNewPassword');
    await h.http().post('/api/auth/change-password').set(auth(a.body.accessToken)).set('Cookie', cookieA)
      .send({ currentPassword: NEW_PASSWORD, newPassword: 'outra-senha-longa-2', confirmNewPassword: 'outra-senha-longa-2' }).expect(204);

    await h.http().post('/api/auth/refresh').set('Cookie', cookieA).expect(200); // sessão atual segue
    await h.http().post('/api/auth/refresh').set('Cookie', cookieB).expect(401); // a outra foi encerrada
    await h.http().post('/api/auth/login').send({ email: 'troca@x.test', password: NEW_PASSWORD }).expect(401);
    await h.http().post('/api/auth/login').send({ email: 'troca@x.test', password: 'outra-senha-longa-2' }).expect(200);
  });
});

describe('convites por e-mail', () => {
  const invite = (token: string, body: Record<string, unknown>, clinicId = A.clinic.id) =>
    h.http().post('/api/clinic/invitations').set(auth(token, clinicId)).send(body);

  it('quem se cadastra com o e-mail convidado entra na clínica sozinho, com o papel do convite', async () => {
    const owner = await tokenOf(A.admin.email);
    const inv = await invite(owner, { email: 'Nova.Pessoa@X.test', role: 'PROFISSIONAL' }).expect(201);
    expect(inv.body).toMatchObject({ email: 'nova.pessoa@x.test', role: 'PROFISSIONAL', status: 'PENDING' });

    const r = await signup({ name: 'Nova Pessoa', email: 'nova.pessoa@x.test', password: NEW_PASSWORD }).expect(201);
    expect(r.body.user.clinics).toEqual([{ id: A.clinic.id, name: 'Clinica Onboarding', role: 'PROFISSIONAL' }]);
    expect(r.body.user.joined).toEqual([{ id: A.clinic.id, name: 'Clinica Onboarding', role: 'PROFISSIONAL' }]);
    await h.http().get('/api/patients').set(auth(r.body.accessToken)).expect(200);

    const list = await h.http().get('/api/clinic/invitations').set(auth(owner)).expect(200);
    expect(list.body.find((i: { email: string }) => i.email === 'nova.pessoa@x.test')).toMatchObject({ status: 'ACCEPTED' });
    // Aparece na equipe e na auditoria da clínica.
    const team = await h.http().get('/api/users').set(auth(owner)).expect(200);
    expect(team.body.map((u: { email: string }) => u.email)).toContain('nova.pessoa@x.test');
    const audit = await h.http().get('/api/audit?pageSize=100').set(auth(owner)).expect(200);
    expect(audit.body.items.map((e: { action: string }) => e.action)).toContain('MEMBER_JOINED');
  });

  it('conta que já existe recebe o convite no próximo login, e passa a ter duas clínicas', async () => {
    const owner = await tokenOf(A.admin.email);
    const existing = await makeUser(h, 'ja-existe@x.test'); // conta sem clínica
    const before = await h.http().post('/api/auth/login').send({ email: existing.email, password: PASSWORD }).expect(200);
    expect(before.body.user.clinics).toEqual([]);
    await invite(owner, { email: 'ja-existe@x.test', role: 'AUXILIAR' }).expect(201);
    const after = await h.http().post('/api/auth/login').send({ email: existing.email, password: PASSWORD }).expect(200);
    expect(after.body.user.clinics).toEqual([{ id: A.clinic.id, name: 'Clinica Onboarding', role: 'AUXILIAR' }]);
    expect(after.body.user.joined).toHaveLength(1);
  });

  it('regras: só dona/gerente convidam; gerente não convida dona; duplicado e já-membro são recusados', async () => {
    const owner = await tokenOf(A.admin.email);
    const gerente = await tokenOf(A.gerente.email);
    const pro = await tokenOf(A.pro.email);
    await invite(pro, { email: 'x1@x.test', role: 'AUXILIAR' }).expect(403);
    await invite(gerente, { email: 'x2@x.test', role: 'OWNER' }).expect(403);
    await invite(gerente, { email: 'x2@x.test', role: 'GERENTE' }).expect(201);
    const dup = await invite(owner, { email: 'x2@x.test', role: 'AUXILIAR' }).expect(409);
    expect(dup.body.code).toBe('INVITATION_EXISTS');
    const member = await invite(owner, { email: A.pro.email, role: 'AUXILIAR' }).expect(409);
    expect(member.body.code).toBe('ALREADY_MEMBER');
  });

  it('revogado e vencido não valem; reenviar reabre o prazo', async () => {
    const owner = await tokenOf(A.admin.email);
    const rev = await invite(owner, { email: 'revogado@x.test', role: 'AUXILIAR' }).expect(201);
    await h.http().delete(`/api/clinic/invitations/${rev.body.id}`).set(auth(owner)).expect(204);
    const a = await signup({ name: 'Revogado', email: 'revogado@x.test', password: NEW_PASSWORD }).expect(201);
    expect(a.body.user.clinics).toEqual([]);

    const old = await invite(owner, { email: 'vencido@x.test', role: 'AUXILIAR' }).expect(201);
    await h.prisma.invitation.update({ where: { id: old.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const b = await signup({ name: 'Vencido', email: 'vencido@x.test', password: NEW_PASSWORD }).expect(201);
    expect(b.body.user.clinics).toEqual([]);
    const listed = await h.http().get('/api/clinic/invitations').set(auth(owner)).expect(200);
    expect(listed.body.find((i: { id: string }) => i.id === old.body.id).status).toBe('EXPIRED');

    await h.http().post(`/api/clinic/invitations/${old.body.id}/resend`).set(auth(owner)).expect(200);
    const again = await h.http().post('/api/auth/login').send({ email: 'vencido@x.test', password: NEW_PASSWORD }).expect(200);
    expect(again.body.user.clinics.map((c: { id: string }) => c.id)).toEqual([A.clinic.id]);
  });

  it('convite é por clínica: gerente de uma clínica não vê nem revoga convites de outra', async () => {
    const B = await seedClinic(h, 'Clinica Outra');
    const ownerB = await tokenOf(B.admin.email);
    const inv = await invite(ownerB, { email: 'so-da-b@x.test', role: 'AUXILIAR' }, B.clinic.id).expect(201);
    const ownerA = await tokenOf(A.admin.email);
    const listA = await h.http().get('/api/clinic/invitations').set(auth(ownerA)).expect(200);
    expect(listA.body.map((i: { id: string }) => i.id)).not.toContain(inv.body.id);
    await h.http().delete(`/api/clinic/invitations/${inv.body.id}`).set(auth(ownerA)).expect(404);
  });
});

describe('console da plataforma', () => {
  it('só administrador da plataforma entra', async () => {
    const owner = await tokenOf(A.admin.email);
    await h.http().get('/api/platform/clinics').set(auth(owner)).expect(403);
    await h.http().get('/api/platform/metrics').set(auth(owner)).expect(403);
    await h.http().get('/api/platform/clinics').expect(401);
    await h.http().get('/api/platform/clinics').set(auth(admin.token)).expect(200);
  });

  it('o admin da plataforma NÃO lê dados de pacientes pelas rotas de clínica', async () => {
    const r = await h.http().get('/api/patients').set(auth(admin.token, A.clinic.id)).expect(403);
    expect(r.body.code).toBe('CLINIC_FORBIDDEN');
    const clinic = await h.http().get(`/api/platform/clinics/${A.clinic.id}`).set(auth(admin.token)).expect(200);
    expect(JSON.stringify(clinic.body)).not.toMatch(/Paciente/);
  });

  it('cria a clínica e convida a dona; a dona entra sozinha ao criar a conta', async () => {
    const created = await h.http().post('/api/platform/clinics').set(auth(admin.token))
      .send({ name: 'Clínica Nova Estética', ownerEmail: 'DONA@Nova.test' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Clínica Nova Estética', status: 'ACTIVE', members: 0, pendingInvitations: 1 });
    expect(created.body.invitations[0]).toMatchObject({ email: 'dona@nova.test', role: 'OWNER', status: 'PENDING' });

    const r = await signup({ name: 'Dona Nova', email: 'dona@nova.test', password: NEW_PASSWORD }).expect(201);
    expect(r.body.user.clinics).toEqual([{ id: created.body.id, name: 'Clínica Nova Estética', role: 'OWNER' }]);
    // E a dona já pode convidar a equipe.
    await h.http().post('/api/clinic/invitations').set(auth(r.body.accessToken))
      .send({ email: 'func@nova.test', role: 'RECEPCAO' }).expect(201);
  });

  it('suspender bloqueia a equipe na hora; reativar libera; excluir exige o nome e é cancelável', async () => {
    const created = await h.http().post('/api/platform/clinics').set(auth(admin.token))
      .send({ name: 'Clínica Ciclo de Vida', ownerEmail: 'ciclo@x.test' }).expect(201);
    const id = created.body.id as string;
    const owner = (await signup({ name: 'Dona Ciclo', email: 'ciclo@x.test', password: NEW_PASSWORD }).expect(201)).body.accessToken as string;
    await h.http().get('/api/patients').set(auth(owner)).expect(200);

    await h.http().post(`/api/platform/clinics/${id}/suspend`).set(auth(admin.token)).expect(200);
    const blocked = await h.http().get('/api/patients').set(auth(owner, id)).expect(403);
    expect(blocked.body.code).toBe('CLINIC_SUSPENDED');
    await h.http().post(`/api/platform/clinics/${id}/reactivate`).set(auth(admin.token)).expect(200);
    await h.http().get('/api/patients').set(auth(owner)).expect(200);

    const bad = await h.http().post(`/api/platform/clinics/${id}/deletion`).set(auth(admin.token)).send({ confirmName: 'outro nome' }).expect(400);
    expect(bad.body.code).toBe('CONFIRM_MISMATCH');
    const sched = await h.http().post(`/api/platform/clinics/${id}/deletion`).set(auth(admin.token)).send({ confirmName: 'Clínica Ciclo de Vida' }).expect(200);
    expect(sched.body.status).toBe('PENDING_DELETION');
    expect(sched.body.deletionScheduledAt).toBeTruthy();
    await h.http().get('/api/patients').set(auth(owner, id)).expect(403);
    const back = await h.http().delete(`/api/platform/clinics/${id}/deletion`).set(auth(admin.token)).expect(200);
    expect(back.body.status).toBe('ACTIVE');
    await h.http().get('/api/patients').set(auth(owner)).expect(200);
  });

  it('suspender a conta derruba as sessões e impede o login; o admin não suspende a si mesmo', async () => {
    const u = await makeUser(h, 'suspensa@x.test', { clinicId: A.clinic.id, role: 'AUXILIAR' });
    const s = await login(h, u.email);
    await h.http().post(`/api/platform/accounts/${u.id}/suspend`).set(auth(admin.token)).expect(204);
    await h.http().get('/api/patients').set(auth(s.token)).expect(401);
    await h.http().post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
    await h.http().post('/api/auth/login').send({ email: u.email, password: PASSWORD }).expect(401);
    const me = await h.prisma.user.findUniqueOrThrow({ where: { email: 'plataforma@teste.test' } });
    await h.http().post(`/api/platform/accounts/${me.id}/suspend`).set(auth(admin.token)).expect(400);
    await h.http().post(`/api/platform/accounts/${u.id}/reactivate`).set(auth(admin.token)).expect(204);
    await login(h, u.email);
  });

  it('lista contas com vínculos e mostra métricas', async () => {
    const accounts = await h.http().get('/api/platform/accounts?search=ciclo').set(auth(admin.token)).expect(200);
    expect(accounts.body.items[0]).toMatchObject({ email: 'ciclo@x.test', clinics: [{ role: 'OWNER' }] });
    const m = await h.http().get('/api/platform/metrics').set(auth(admin.token)).expect(200);
    expect(m.body.clinics.total).toBeGreaterThanOrEqual(3);
    expect(m.body.accounts.platformAdmins).toBe(1);
  });

  it('exclusão e criação ficam na auditoria da clínica', async () => {
    const created = await h.http().post('/api/platform/clinics').set(auth(admin.token))
      .send({ name: 'Clínica Auditada', ownerEmail: 'aud@x.test' }).expect(201);
    const owner = (await signup({ name: 'Dona Aud', email: 'aud@x.test', password: NEW_PASSWORD }).expect(201)).body.accessToken as string;
    await h.http().post(`/api/platform/clinics/${created.body.id}/suspend`).set(auth(admin.token)).expect(200);
    await h.http().post(`/api/platform/clinics/${created.body.id}/reactivate`).set(auth(admin.token)).expect(200);
    const audit = await h.http().get('/api/audit?pageSize=100').set(auth(owner)).expect(200);
    const actions = audit.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['CLINIC_CREATE', 'CLINIC_SUSPEND', 'CLINIC_REACTIVATE', 'MEMBER_JOINED']));
  });
});
