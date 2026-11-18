// Dados de DEMONSTRAÇÃO (fictícios). Nunca rode em produção.
// Cria uma clínica, membros com papéis diferentes, um admin da plataforma e pacientes fictícios
// sem termo assinado.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed de demonstração não roda em produção.');
}
if (process.env.DB_TARGET === 'supabase') {
  throw new Error('O seed de demonstração não roda no banco real (DB_TARGET=supabase): ele cria usuários com senha conhecida.');
}

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
const password = process.env.SEED_PASSWORD ?? 'Simulador#2026';

const USERS = [
  { email: 'admin@demo.local', name: 'Dona Demonstração', role: 'OWNER' },
  { email: 'gerente@demo.local', name: 'Gerente Demonstração', role: 'GERENTE' },
  { email: 'profissional@demo.local', name: 'Dra. Demonstração', role: 'PROFISSIONAL' },
  { email: 'recepcao@demo.local', name: 'Recepção Demonstração', role: 'RECEPCAO' },
] as const;

const PLATFORM_ADMIN = { email: 'plataforma@demo.local', name: 'Admin da Plataforma (demo)' };

const PATIENTS = [
  { name: 'Paciente Fictícia A', internalCode: 'DEMO-001', notes: 'Cadastro de demonstração.' },
  { name: 'Paciente Fictício B', internalCode: 'DEMO-002' },
  { name: 'Paciente Fictícia C', internalCode: 'DEMO-003', phone: '(11) 90000-0000' },
];

async function main() {
  const passwordHash = await hashPassword(password);
  const existing = await prisma.clinic.findFirst({ where: { name: 'Clínica Demonstração' } });
  const clinic = existing ?? (await prisma.clinic.create({ data: { name: 'Clínica Demonstração' } }));

  // Idempotente: cria o que falta e redefine a senha de demonstração do que já existe.
  for (const u of USERS) {
    const account = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, passwordHash, emailVerifiedAt: new Date() },
      update: { passwordHash, active: true },
    });
    await prisma.membership.upsert({
      where: { userId_clinicId: { userId: account.id, clinicId: clinic.id } },
      create: { userId: account.id, clinicId: clinic.id, role: u.role },
      update: { status: 'ACTIVE' },
    });
  }
  await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN.email },
    create: { ...PLATFORM_ADMIN, passwordHash, emailVerifiedAt: new Date(), isPlatformAdmin: true },
    update: { passwordHash, active: true, isPlatformAdmin: true },
  });

  let patients = 0;
  if ((await prisma.patient.count({ where: { clinicId: clinic.id } })) === 0) {
    for (const p of PATIENTS) await prisma.patient.create({ data: { ...p, clinicId: clinic.id } });
    patients = PATIENTS.length;
  }
  console.log(`[seed] Clínica ${existing ? 'já existia' : 'criada'}; ${USERS.length} membros, 1 admin da plataforma e ${patients} pacientes fictícios garantidos.`);
  console.log('[seed] Logins: ' + [...USERS, PLATFORM_ADMIN].map((u) => u.email).join(', ') + ' (senha: SEED_PASSWORD do .env)');
}

await main().finally(() => prisma.$disconnect());
