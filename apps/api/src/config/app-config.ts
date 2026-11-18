import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(14),
    COOKIE_SECURE: bool.default(false),
    CORS_ORIGIN: z.string().optional(),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.data/storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('simulador'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    /** Host usado nas URLs pré-assinadas, se diferente do interno (ex.: MinIO no compose). */
    S3_PUBLIC_ENDPOINT: z.string().optional(),
    S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /** URL da API vista pelo worker (URLs pré-assinadas absolutas no modo local). */
    PUBLIC_API_URL: z.string().default('http://localhost:3000'),
    /** Sem WORKER_URL, a reconstrução cai no template demonstrativo (planejamento §5.1, item 8). */
    WORKER_URL: z.string().optional(),
    WORKER_SECRET: z.string().optional(),
    WORKER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
    /** Desliga o processador da fila (testes controlam o ciclo manualmente). */
    QUEUE_ENABLED: bool.default(true),
    QUEUE_POLL_MS: z.coerce.number().int().min(100).default(2000),
    /** Expurgo diário por prazo de retenção. */
    RETENTION_ENABLED: bool.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Obrigatório em produção' });
    }
    if (env.WORKER_URL && (!env.WORKER_SECRET || env.WORKER_SECRET.length < 32)) {
      ctx.addIssue({ code: 'custom', path: ['WORKER_SECRET'], message: 'Obrigatório (32+ caracteres) com WORKER_URL' });
    }
    if (env.STORAGE_DRIVER === 's3' && (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['S3_ACCESS_KEY'], message: 'Credenciais S3 ausentes' });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
