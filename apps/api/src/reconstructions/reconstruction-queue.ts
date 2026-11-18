import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ReconstructResponse,
  WORKER_SIGNATURE_HEADER,
  WORKER_TIMESTAMP_HEADER,
  type ReconstructRequest,
} from '@sim/contracts';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, storageKeys } from '../storage/storage.service.js';
import { signWorkerBody } from './worker-signature.js';

/** 1 tentativa + 2 retries, só para TIMEOUT/INTERNAL (planejamento §5.1). */
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 5_000;

type Outcome =
  | { kind: 'done'; source: 'VGGTFACE' | 'TEMPLATE' | 'FALLBACK_FIT'; meshKey: string | null; qualityScore: number | null; metrics: object }
  | { kind: 'input-error'; code: 'FACE_NOT_FOUND' | 'LOW_QUALITY'; detail?: string }
  | { kind: 'retryable'; code: 'TIMEOUT' | 'INTERNAL'; detail?: string };

/**
 * Fila de reconstrução sobre a própria tabela `reconstructions` (ADR 0005):
 * `FOR UPDATE SKIP LOCKED` garante que dois processadores não peguem o mesmo job.
 * Sem WORKER_URL, o job termina como TEMPLATE (modelo demonstrativo).
 */
@Injectable()
export class ReconstructionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Fila');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.QUEUE_ENABLED) return;
    this.timer = setInterval(() => void this.drain(), this.config.QUEUE_POLL_MS);
    this.timer.unref();
    this.logger.log(this.config.WORKER_URL ? `Worker em ${this.config.WORKER_URL}` : 'Sem WORKER_URL: reconstruções usam o template demonstrativo');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processa todos os jobs prontos. Público para os testes controlarem o ciclo. */
  async drain() {
    if (this.running) return 0;
    this.running = true;
    let n = 0;
    try {
      await this.recoverStale();
      for (let id = await this.claim(); id; id = await this.claim()) {
        await this.process(id);
        n++;
      }
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.running = false;
    }
    return n;
  }

  private async claim(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE reconstructions
         SET status = 'PROCESSING', locked_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM reconstructions
          WHERE status = 'QUEUED' AND next_run_at <= now()
          ORDER BY next_run_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  /** Job travado (processo caiu no meio) volta para a fila. */
  private async recoverStale() {
    const limit = new Date(Date.now() - this.config.WORKER_TIMEOUT_MS * 2);
    await this.prisma.reconstruction.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: limit } },
      data: { status: 'QUEUED', lockedAt: null },
    });
  }

  private async process(id: string) {
    const job = await this.prisma.reconstruction.findUniqueOrThrow({
      where: { id },
      include: { capture: { include: { photos: true } } },
    });
    const outcome = await this.run(job).catch((e: unknown): Outcome => ({
      kind: 'retryable',
      code: (e as { name?: string }).name === 'TimeoutError' ? 'TIMEOUT' : 'INTERNAL',
      detail: String((e as Error).message ?? e).slice(0, 300),
    }));

    if (outcome.kind === 'done') {
      await this.prisma.reconstruction.update({
        where: { id },
        data: {
          status: 'DONE',
          source: outcome.source,
          meshKey: outcome.meshKey,
          qualityScore: outcome.qualityScore,
          metrics: outcome.metrics,
          error: null,
          errorDetail: null,
          lockedAt: null,
          finishedAt: new Date(),
        },
      });
      this.logger.log(`Reconstrução ${id} concluída (${outcome.source})`);
      return;
    }
    const retry = outcome.kind === 'retryable' && job.attempts < MAX_ATTEMPTS;
    await this.prisma.reconstruction.update({
      where: { id },
      data: retry
        ? {
            status: 'QUEUED',
            lockedAt: null,
            error: outcome.code,
            errorDetail: outcome.detail ?? null,
            nextRunAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (job.attempts - 1)),
          }
        : {
            status: 'FAILED',
            lockedAt: null,
            error: outcome.code,
            errorDetail: outcome.detail ?? null,
            finishedAt: new Date(),
          },
    });
    this.logger.warn(`Reconstrução ${id}: ${outcome.code}${retry ? ' (nova tentativa agendada)' : ''}`);
  }

  private async run(job: {
    id: string;
    clinicId: string;
    captureId: string;
    source: string;
    capture: { photos: { angle: ReconstructRequest['photos'][number]['angle']; storageKey: string }[] };
  }): Promise<Outcome> {
    if (!this.config.WORKER_URL || job.source === 'TEMPLATE') {
      return { kind: 'done', source: 'TEMPLATE', meshKey: null, qualityScore: null, metrics: { note: 'template demonstrativo' } };
    }
    const meshKey = storageKeys.mesh(job.clinicId, job.captureId, job.id);
    const ttl = Math.ceil(this.config.WORKER_TIMEOUT_MS / 1000) + 120;
    const request: ReconstructRequest = {
      jobId: job.id,
      photos: await Promise.all(
        job.capture.photos.map(async (p) => ({
          angle: p.angle,
          url: await this.storage.presign(p.storageKey, { method: 'GET', ttl, absolute: true }),
        })),
      ),
      output: {
        meshUploadUrl: await this.storage.presign(meshKey, { method: 'PUT', contentType: 'model/gltf-binary', ttl, absolute: true }),
      },
    };
    const body = JSON.stringify(request);
    const ts = Math.floor(Date.now() / 1000);
    const res = await fetch(`${this.config.WORKER_URL.replace(/\/$/, '')}/v1/reconstruct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WORKER_TIMESTAMP_HEADER]: String(ts),
        [WORKER_SIGNATURE_HEADER]: signWorkerBody(this.config.WORKER_SECRET!, ts, body),
      },
      body,
      signal: AbortSignal.timeout(this.config.WORKER_TIMEOUT_MS),
    });
    const parsed = ReconstructResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { kind: 'retryable', code: 'INTERNAL', detail: `Resposta inválida do worker (HTTP ${res.status})` };
    const r = parsed.data;
    if (r.status === 'FAILED') {
      return r.code === 'FACE_NOT_FOUND' || r.code === 'LOW_QUALITY'
        ? { kind: 'input-error', code: r.code, detail: r.detail }
        : { kind: 'retryable', code: r.code, detail: r.detail };
    }
    if (!(await this.storage.head(meshKey))) {
      return { kind: 'retryable', code: 'INTERNAL', detail: 'O worker não enviou o .glb' };
    }
    return { kind: 'done', source: r.source, meshKey, qualityScore: r.metrics.qualityScore, metrics: r.metrics };
  }
}
