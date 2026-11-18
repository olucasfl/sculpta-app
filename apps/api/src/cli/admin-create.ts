// Cria (ou atualiza) uma conta de ADMINISTRADOR DA PLATAFORMA, direto no banco.
//
// Uso:   pnpm --filter @sim/api admin:create -- --email voce@exemplo.com --name "Seu Nome"
// A senha é pedida no terminal (não aparece na tela). Para automação: ADMIN_PASSWORD no ambiente.
// Com DB_TARGET=supabase no .env, grava no banco real. É também o jeito de redefinir a senha de
// qualquer conta enquanto não existe recuperação por e-mail.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { createInterface } from 'node:readline';
import { PASSWORD_MIN } from '@sim/contracts';
import { hashPassword } from '../auth/password.js';
import { resolveDatabaseUrl } from '../config/app-config.js';
import { PrismaClient } from '../generated/prisma/client.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Lê uma linha sem ecoar o que é digitado. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = (arg('email') ?? '').trim().toLowerCase();
  const name = (arg('name') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Informe --email com um e-mail válido');

  const url = resolveDatabaseUrl(process.env);
  if (!url) throw new Error('DATABASE_URL (ou DB_TARGET=supabase com SUPABASE_DB_SESSION_URL) não configurado');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing && name.length < 2) throw new Error('Conta nova: informe --name "Seu Nome"');

    let password = process.env.ADMIN_PASSWORD ?? '';
    if (!password) {
      password = await askHidden(`Senha para ${email} (mín. ${PASSWORD_MIN} caracteres${existing ? '; vazio mantém a atual' : ''}): `);
      if (password && password === (await askHidden('Repita a senha: '))) {
        /* confere */
      } else if (password) {
        throw new Error('As senhas não conferem');
      }
    }
    if (!existing && !password) throw new Error('Conta nova precisa de senha');
    if (password && password.length < PASSWORD_MIN) throw new Error(`A senha precisa de ao menos ${PASSWORD_MIN} caracteres`);

    const passwordHash = password ? await hashPassword(password) : undefined;
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash, emailVerifiedAt: new Date(), isPlatformAdmin: true },
      update: { isPlatformAdmin: true, active: true, emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(), ...(passwordHash ? { passwordHash } : {}), ...(name ? { name } : {}) },
    });
    if (passwordHash && existing) {
      // Senha trocada: derruba as sessões abertas dessa conta.
      await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await prisma.auditLog.create({
      data: { clinicId: null, userId: user.id, action: 'USER_UPDATE', entity: 'user', entityId: user.id, ip: 'cli' },
    });
    console.log(`${existing ? 'Atualizada' : 'Criada'} a conta de administrador da plataforma: ${user.email}`);
    console.log(`Banco: ${process.env.DB_TARGET === 'supabase' ? 'SUPABASE (real)' : 'local'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`Erro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
