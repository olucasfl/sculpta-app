// Postgres embutido (PGlite) para desenvolvimento sem Docker.
// Fala o protocolo do Postgres na porta 5433, com os dados em apps/api/.data/pglite.
// Para Postgres de verdade, use infra/docker-compose.yml e ajuste DATABASE_URL.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.data', 'pglite');
const port = Number(process.env.PGLITE_PORT ?? 5433);

mkdirSync(dataDir, { recursive: true });
const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 8 });
await server.start();
console.log(`[dev-db] PGlite ouvindo em postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
console.log(`[dev-db] Dados em ${dataDir}. Ctrl+C para parar.`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
