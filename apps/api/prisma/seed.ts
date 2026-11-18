// Dados de DEMONSTRAÇÃO (fictícios). Nunca rode em produção.
// Cria uma clínica, três usuários (um por papel) e pacientes fictícios sem termo assinado.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed de demonstração não roda em produção.');
}

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
const password = process.env.SEED_PASSWORD ?? 'Simulador#2026';

const USERS = [
  { email: 'admin@demo.local', name: 'Admin Demonstração', role: 'ADMIN' },
  { email: 'profissional@demo.local', name: 'Dra. Demonstração', role: 'PROFISSIONAL' },
  { email: 'recepcao@demo.local', name: 'Recepção Demonstração', role: 'RECEPCAO' },
] as const;

const PATIENTS = [
  { name: 'Paciente Fictícia A', internalCode: 'DEMO-001', notes: 'Cadastro de demonstração.' },
  { name: 'Paciente Fictício B', internalCode: 'DEMO-002' },
  { name: 'Paciente Fictícia C', internalCode: 'DEMO-003', phone: '(11) 90000-0000' },
];

async function main() {
  const passwordHash = await hashPassword(password);
  const existing = await prisma.clinic.findFirst({ where: { name: 'Clínica Demonstração' } });
  if (existing) {
    const r = await prisma.user.updateMany({
      where: { clinicId: existing.id, email: { in: USERS.map((u) => u.email) } },
      data: { passwordHash, active: true },
    });
    console.log(`[seed] Clínica de demonstração já existe; senha de ${r.count} usuários redefinida.`);
    return;
  }
  const clinic = await prisma.clinic.create({ data: { name: 'Clínica Demonstração' } });
  for (const u of USERS) {
    await prisma.user.create({ data: { ...u, clinicId: clinic.id, passwordHash } });
  }
  for (const p of PATIENTS) {
    await prisma.patient.create({ data: { ...p, clinicId: clinic.id } });
  }
  console.log(`[seed] Clínica, ${USERS.length} usuários e ${PATIENTS.length} pacientes fictícios criados.`);
  console.log('[seed] Logins: ' + USERS.map((u) => u.email).join(', ') + ' (senha: SEED_PASSWORD do .env)');
}

await main().finally(() => prisma.$disconnect());
