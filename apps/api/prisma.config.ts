import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Só os comandos de migração usam isto. `generate` funciona sem banco.
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/postgres',
  },
});
