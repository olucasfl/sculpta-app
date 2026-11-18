import {
  Controller,
  ForbiddenException,
  Get,
  Global,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { PHOTO_MAX_BYTES } from '@sim/contracts';
import type { Request, Response } from 'express';
import { Public } from '../common/auth-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { LocalStorageService, S3StorageService, StorageService } from './storage.service.js';

const MAX_UPLOAD = Math.max(PHOTO_MAX_BYTES, 40 * 1024 * 1024); // fotos e .glb

/**
 * Emula as URLs pré-assinadas do S3 quando STORAGE_DRIVER=local.
 * Rota pública, mas só aceita tokens HMAC com chave, método e validade.
 */
@Controller('storage/local')
export class LocalStorageController {
  constructor(private readonly storage: StorageService) {}

  private local() {
    if (!(this.storage instanceof LocalStorageService)) throw new NotFoundException();
    return this.storage;
  }

  @Public()
  @Put(':token')
  @HttpCode(200)
  async put(@Param('token') token: string, @Req() req: Request) {
    const t = this.local().verify(token, 'PUT');
    if (!t) throw new ForbiddenException('URL de upload inválida ou expirada');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_UPLOAD) throw new PayloadTooLargeException('Arquivo grande demais');
      chunks.push(chunk);
    }
    await this.local().put(t.k, Buffer.concat(chunks));
    return { ok: true };
  }

  @Public()
  @Get(':token')
  async get(@Param('token') token: string, @Res() res: Response) {
    const t = this.local().verify(token, 'GET');
    if (!t) throw new ForbiddenException('URL de leitura inválida ou expirada');
    const body = await this.local().get(t.k);
    if (!body) throw new NotFoundException();
    const type = t.k.endsWith('.glb') ? 'model/gltf-binary' : t.k.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(body);
  }
}

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    {
      provide: StorageService,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.STORAGE_DRIVER === 's3' ? new S3StorageService(config) : new LocalStorageService(config),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
