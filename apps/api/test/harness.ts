import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Test } from '@nestjs/testing';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { configureApp } from '../src/bootstrap.js';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const PASSWORD = 'senha-de-teste-123';

/**
 * Sobe a API inteira contra um Postgres em memória (PGlite via protocolo de rede),
 * aplicando as mesmas migrations de produção.
 */
export async function startHarness(opts: { env?: Record<string, string>; listen?: boolean } = {}) {
  const db = await PGlite.create();
  const migrationsDir = join(import.meta.dirname, '..', 'prisma', 'migrations');
  for (const dir of (await readdir(migrationsDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    await db.exec(await readFile(join(migrationsDir, dir.name, 'migration.sql'), 'utf8'));
  }
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
  await server.start();

  const storageDir = await mkdtemp(join(tmpdir(), 'sim-storage-'));
  const apiPort = 20_000 + Math.floor(Math.random() * 20_000);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    DATABASE_POOL_MAX: '2',
    JWT_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storageDir,
    LOGIN_RATE_LIMIT: '100',
    QUEUE_ENABLED: 'false',
    RETENTION_ENABLED: 'false',
    PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
  });
  delete process.env.WORKER_URL;
  delete process.env.WORKER_SECRET;
  Object.assign(process.env, opts.env ?? {});

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  if (opts.listen) await app.listen(apiPort, '127.0.0.1');
  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    storageDir,
    http: () => request(app.getHttpServer()),
    async close() {
      await app.close();
      await server.stop();
      await db.close();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

export type TestRole = 'OWNER' | 'GERENTE' | 'PROFISSIONAL' | 'AUXILIAR' | 'RECEPCAO' | 'VISUALIZADOR';

/** Cria uma conta (global) e, se `clinicId` e `role` vierem, o vínculo com a clínica. */
export async function makeUser(
  h: Harness,
  email: string,
  opts: { clinicId?: string; role?: TestRole; platformAdmin?: boolean } = {},
) {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await h.prisma.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      passwordHash,
      emailVerifiedAt: new Date(),
      isPlatformAdmin: opts.platformAdmin ?? false,
    },
  });
  if (opts.clinicId && opts.role) {
    await h.prisma.membership.create({ data: { userId: user.id, clinicId: opts.clinicId, role: opts.role } });
  }
  return user;
}

/** Uma clínica com um membro de cada papel. `admin` é a dona (OWNER). */
export async function seedClinic(h: Harness, name: string) {
  const clinic = await h.prisma.clinic.create({ data: { name } });
  const slug = name.toLowerCase().replace(/\W+/g, '');
  const mk = (role: TestRole) => makeUser(h, `${role.toLowerCase()}@${slug}.test`, { clinicId: clinic.id, role });
  return {
    clinic,
    admin: await mk('OWNER'),
    pro: await mk('PROFISSIONAL'),
    recep: await mk('RECEPCAO'),
    gerente: await mk('GERENTE'),
    aux: await mk('AUXILIAR'),
    viewer: await mk('VISUALIZADOR'),
  };
}

export async function login(h: Harness, email: string) {
  const res = await h.http().post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login falhou (${res.status}): ${JSON.stringify(res.body)}`);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sim_rt='));
  return { token: res.body.accessToken as string, cookie: cookie!.split(';')[0]!, body: res.body };
}

/** Cabeçalhos de uma chamada autenticada; `clinicId` vai em X-Clinic-Id (obrigatório para quem tem 2+ clínicas). */
export const auth = (token: string, clinicId?: string) => ({
  Authorization: `Bearer ${token}`,
  ...(clinicId ? { 'X-Clinic-Id': clinicId } : {}),
});

/** PNG 1x1 válido, maior que o mínimo exigido, para simular uma assinatura. */
export const SIGNATURE =
  'data:image/png;base64,' +
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f6e1a40000000049454e44ae426082', 'hex'),
  ]).toString('base64');
