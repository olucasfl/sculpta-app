import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '..', 'prisma', 'migrations');

async function apply(db: PGlite, name: string) {
  await db.exec(await readFile(join(dir, name, 'migration.sql'), 'utf8'));
}

/**
 * Teste 12 de docs/CONTAS-CLINICAS-PERMISSOES.md: subir do zero e a partir do banco antigo gera os
 * mesmos vínculos esperados. Aqui: aplica as migrações 0001 e 0002, insere usuários no modelo
 * ANTIGO (uma clínica e um papel por usuário) e só então aplica a 0003.
 */
describe('migração 0003 (usuários → vínculos)', () => {
  it('converte papéis e preserva quem estava ativo', async () => {
    const db = await PGlite.create();
    const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const idx = names.indexOf('0003_accounts_clinics_memberships');
    expect(idx).toBeGreaterThan(0);
    // Só as migrações ANTERIORES à 0003 antes de inserir os dados antigos.
    for (const n of names.slice(0, idx)) await apply(db, n);

    await db.exec(`
      INSERT INTO clinics (id, name) VALUES
        ('11111111-1111-4111-8111-111111111111', 'Clinica Um'),
        ('22222222-2222-4222-8222-222222222222', 'Clinica Dois');
      INSERT INTO users (id, clinic_id, name, email, password_hash, role, active, created_at) VALUES
        ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Primeiro Admin', 'a1@x.test', 'h', 'ADMIN',        true,  '2026-01-01'),
        ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Segundo Admin',  'a2@x.test', 'h', 'ADMIN',        true,  '2026-02-01'),
        ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Profissional',   'p@x.test',  'h', 'PROFISSIONAL', true,  '2026-03-01'),
        ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Recepção',       'r@x.test',  'h', 'RECEPCAO',     false, '2026-04-01'),
        ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Admin Dois',     'a@dois.test','h', 'ADMIN',       true,  '2026-05-01');
    `);

    await apply(db, '0003_accounts_clinics_memberships');

    const rows = (
      await db.query<{ email: string; clinic: string; role: string; status: string }>(`
        SELECT u.email, c.name AS clinic, m.role::text AS role, m.status::text AS status
        FROM memberships m JOIN users u ON u.id = m.user_id JOIN clinics c ON c.id = m.clinic_id
        ORDER BY u.email`)
    ).rows;

    // Sem depender da ordenação (collation) do banco.
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(
      expect.arrayContaining([
        { email: 'a@dois.test', clinic: 'Clinica Dois', role: 'OWNER', status: 'ACTIVE' }, // único admin da clínica
        { email: 'a1@x.test', clinic: 'Clinica Um', role: 'OWNER', status: 'ACTIVE' }, // primeiro admin vira dona
        { email: 'a2@x.test', clinic: 'Clinica Um', role: 'GERENTE', status: 'ACTIVE' }, // demais admins viram gerentes
        { email: 'p@x.test', clinic: 'Clinica Um', role: 'PROFISSIONAL', status: 'ACTIVE' },
        { email: 'r@x.test', clinic: 'Clinica Um', role: 'RECEPCAO', status: 'SUSPENDED' }, // inativo vira suspenso
      ]),
    );

    // Todas as clínicas ficam com ao menos uma dona ativa.
    const withoutOwner = await db.query(`
      SELECT c.id FROM clinics c
      WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.clinic_id = c.id AND m.role = 'OWNER' AND m.status = 'ACTIVE')`);
    expect(withoutOwner.rows).toHaveLength(0);

    // E-mails antigos passam a contar como verificados; ninguém vira admin da plataforma.
    const flags = await db.query<{ unverified: string; platform: string }>(`
      SELECT count(*) FILTER (WHERE email_verified_at IS NULL)::text AS unverified,
             count(*) FILTER (WHERE is_platform_admin)::text AS platform FROM users`);
    expect(flags.rows[0]).toEqual({ unverified: '0', platform: '0' });

    // Um convite PENDENTE por e-mail/clínica (índice parcial).
    await db.exec(`INSERT INTO invitations (id, clinic_id, email, role, invited_by_id, expires_at)
      VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'novo@x.test', 'AUXILIAR', 'a0000000-0000-4000-8000-000000000001', now() + interval '7 days')`);
    await expect(
      db.exec(`INSERT INTO invitations (id, clinic_id, email, role, invited_by_id, expires_at)
        VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'novo@x.test', 'GERENTE', 'a0000000-0000-4000-8000-000000000001', now() + interval '7 days')`),
    ).rejects.toThrow();
    // Depois de revogado, pode convidar de novo.
    await db.exec(`UPDATE invitations SET status = 'REVOKED' WHERE email = 'novo@x.test'`);
    await db.exec(`INSERT INTO invitations (id, clinic_id, email, role, invited_by_id, expires_at)
      VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'novo@x.test', 'GERENTE', 'a0000000-0000-4000-8000-000000000001', now() + interval '7 days')`);

    await db.close();
  });

  it('0004: todas as tabelas do app ficam com RLS ligada (bloqueia a API REST automática do Supabase)', async () => {
    const db = await PGlite.create();
    const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const n of names) await apply(db, n);
    const rows = (
      await db.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`,
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
    await db.close();
  });
});
