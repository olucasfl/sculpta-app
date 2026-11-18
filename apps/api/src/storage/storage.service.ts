import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { AppConfig } from '../config/app-config.js';

export interface PresignOptions {
  method: 'GET' | 'PUT';
  contentType?: string;
  /** Validade em segundos (padrão: S3_PRESIGN_TTL_SECONDS). */
  ttl?: number;
  /** URL absoluta (para o worker). O navegador usa a relativa, pelo proxy do mesmo domínio. */
  absolute?: boolean;
}

/**
 * Armazenamento privado: assinaturas, fotos, malhas e miniaturas.
 * As chaves nunca levam dados pessoais: `clinics/{clinicId}/...` + ids.
 * Leitura e escrita pelo navegador/worker só por URL pré-assinada de curta duração.
 */
export abstract class StorageService {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer | null>;
  abstract head(key: string): Promise<{ size: number } | null>;
  abstract delete(key: string): Promise<void>;
  abstract presign(key: string, opts: PresignOptions): Promise<string>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;

export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Chave de storage inválida: ${key}`);
}

// ---------- Driver local (desenvolvimento) ----------

interface LocalToken {
  k: string;
  m: 'GET' | 'PUT';
  e: number;
  ct?: string;
}

export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(private readonly config: AppConfig) {
    super();
    this.root = resolve(config.STORAGE_LOCAL_DIR);
  }

  private pathFor(key: string) {
    assertSafeKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Chave fora do diretório de storage');
    return p;
  }

  async put(key: string, body: Buffer) {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string) {
    try {
      return await readFile(this.pathFor(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async head(key: string) {
    try {
      return { size: (await stat(this.pathFor(key))).size };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  private sign(payload: string) {
    return createHmac('sha256', this.config.JWT_SECRET).update(`storage.${payload}`).digest('base64url');
  }

  async presign(key: string, opts: PresignOptions) {
    assertSafeKey(key);
    const token: LocalToken = {
      k: key,
      m: opts.method,
      e: Math.floor(Date.now() / 1000) + (opts.ttl ?? this.config.S3_PRESIGN_TTL_SECONDS),
      ...(opts.contentType ? { ct: opts.contentType } : {}),
    };
    const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
    const path = `/api/storage/local/${payload}.${this.sign(payload)}`;
    return opts.absolute ? `${this.config.PUBLIC_API_URL}${path}` : path;
  }

  /** Valida um token gerado por `presign`. Devolve null se inválido ou expirado. */
  verify(token: string, method: 'GET' | 'PUT'): LocalToken | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const t = JSON.parse(Buffer.from(payload, 'base64url').toString()) as LocalToken;
      if (t.m !== method || t.e < Date.now() / 1000) return null;
      assertSafeKey(t.k);
      return t;
    } catch {
      return null;
    }
  }
}

// ---------- S3 / MinIO / R2 ----------

export class S3StorageService extends StorageService {
  private readonly client: S3Client;
  /** Cliente para assinar URLs com o host público (o navegador não alcança `minio:9000`). */
  private readonly signer: S3Client;

  constructor(private readonly config: AppConfig) {
    super();
    const base = {
      region: config.S3_REGION,
      forcePathStyle: Boolean(config.S3_ENDPOINT), // MinIO
      credentials: { accessKeyId: config.S3_ACCESS_KEY!, secretAccessKey: config.S3_SECRET_KEY! },
    };
    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT });
  }

  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: this.config.S3_ENDPOINT ? undefined : 'AES256',
      }),
    );
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async head(key: string) {
    assertSafeKey(key);
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      return { size: r.ContentLength ?? 0 };
    } catch (e) {
      if (['NotFound', 'NoSuchKey'].includes((e as { name?: string }).name ?? '')) return null;
      throw e;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }

  async presign(key: string, opts: PresignOptions) {
    assertSafeKey(key);
    const cmd =
      opts.method === 'PUT'
        ? new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, ContentType: opts.contentType })
        : new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key });
    return getSignedUrl(this.signer, cmd, { expiresIn: opts.ttl ?? this.config.S3_PRESIGN_TTL_SECONDS });
  }
}

const rand = () => Math.random().toString(36).slice(2, 10);

export const storageKeys = {
  consentSignature: (clinicId: string, consentId: string) =>
    `clinics/${clinicId}/consents/${consentId}/signature.png`,
  /** Sufixo aleatório: refazer a foto gera outra chave (sem cache velho). */
  photo: (clinicId: string, captureId: string, angle: string) =>
    `clinics/${clinicId}/captures/${captureId}/${angle}-${rand()}.jpg`,
  photoPrefix: (clinicId: string, captureId: string, angle: string) =>
    `clinics/${clinicId}/captures/${captureId}/${angle}-`,
  mesh: (clinicId: string, captureId: string, reconstructionId: string) =>
    `clinics/${clinicId}/captures/${captureId}/reconstructions/${reconstructionId}.glb`,
  logo: (clinicId: string, ext: 'png' | 'jpg') => `clinics/${clinicId}/logo-${rand()}.${ext}`,
  thumbnail: (clinicId: string, simulationId: string, versionId: string, ext: 'png' | 'jpg') =>
    `clinics/${clinicId}/simulations/${simulationId}/${versionId}.${ext}`,
};
