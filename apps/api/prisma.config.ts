import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DB_TARGET=supabase usa o pooler em modo sessão (ver src/config/app-config.ts).
const databaseUrl = process.env.DB_TARGET === 'supabase' ? process.env.SUPABASE_DB_SESSION_URL : process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Só os comandos de migração usam isto. `generate` funciona sem banco.
    url: databaseUrl ?? 'postgresql://postgres:postgres@localhost:5433/postgres',
  },
});
