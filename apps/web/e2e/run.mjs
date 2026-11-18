// Sobe uma pilha ISOLADA (banco PGlite em pasta temporária, API na porta 3100, web na 5174),
// roda o Playwright e derruba tudo. Nunca toca no banco real (Supabase): as variáveis passadas
// aqui têm precedência sobre o apps/api/.env.
//
// Uso: pnpm --filter @sim/web e2e [argumentos do playwright]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(web, '..', 'api');
const tmp = mkdtempSync(join(tmpdir(), 'sculpta-e2e-'));
const DB_PORT = 5434;
const API_PORT = 3100;
const WEB_PORT = 5174;

const baseEnv = {
  ...process.env,
  DB_TARGET: 'local',
  // O banco local (PGlite) aceita poucas conexões ao mesmo tempo; um pool maior que isso trava a API.
  DATABASE_POOL_MAX: '4',
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  LOGIN_RATE_LIMIT: '1000',
  SIGNUP_RATE_LIMIT: '1000',
  // Os testes de tela vêm todos do mesmo IP e recarregam muito: sem isso o limite de produção derruba a sessão.
  REFRESH_RATE_LIMIT: '100000',
  GLOBAL_RATE_LIMIT: '1000000',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(tmp, 'storage'),
  PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
  QUEUE_ENABLED: 'false',
  RETENTION_ENABLED: 'false',
  SEED_PASSWORD: 'Simulador#2026',
};

const children = [];
function start(name, args, opts) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  child.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}
function run(name, args, opts) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${name} falhou (código ${r.status})`);
}
const waitPort = (port, label, ms = 60_000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const s = createConnection({ port, host: '127.0.0.1' }, () => {
        s.destroy();
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > ms) reject(new Error(`${label} não subiu na porta ${port}`));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });

async function waitHttp(url, label, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} não respondeu em ${url}`);
}

function stopAll() {
  for (const c of children) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch {
      /* já encerrou */
    }
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* arquivos ainda em uso: o sistema limpa a pasta temporária depois */
  }
}

let code = 1;
try {
  start('db', [join(api, 'scripts', 'dev-db.mjs')], { cwd: api, env: { ...baseEnv, PGLITE_PORT: String(DB_PORT), PGLITE_DIR: join(tmp, 'pglite') } });
  await waitPort(DB_PORT, 'banco');
  const prismaCli = join(api, 'node_modules', 'prisma', 'build', 'index.js');
  run('migrações', [prismaCli, 'migrate', 'deploy'], { cwd: api, env: baseEnv });
  run('seed', ['--import', 'tsx', join(api, 'prisma', 'seed.ts')], { cwd: api, env: baseEnv });
  run('build da API', [join(api, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], { cwd: api, env: baseEnv });
  start('api', ['dist/main.js'], { cwd: api, env: baseEnv });
  await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`, 'API');
  start('web', [join(web, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(WEB_PORT), '--strictPort'], {
    cwd: web,
    env: { ...baseEnv, API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
  });
  await waitHttp(`http://localhost:${WEB_PORT}/`, 'web');
  const pw = join(web, 'node_modules', '@playwright', 'test', 'cli.js');
  const r = spawnSync(process.execPath, [pw, 'test', ...process.argv.slice(2)], {
    cwd: web,
    stdio: 'inherit',
    env: { ...baseEnv, BASE_URL: `http://localhost:${WEB_PORT}` },
  });
  code = r.status ?? 1;
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
} finally {
  stopAll();
}
process.exit(code);
