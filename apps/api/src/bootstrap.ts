import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { AppConfig } from './config/app-config.js';

/** Configuração HTTP comum ao servidor e aos testes e2e. */
export function configureApp(app: INestApplication, config: AppConfig) {
  const express = app as NestExpressApplication;
  express.setGlobalPrefix('api');
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  express.use(cookieParser());
  // Assinatura em PNG (data URL) cabe folgado em 1 MB.
  express.useBodyParser('json', { limit: '1mb' });
  express.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  if (config.CORS_ORIGIN) {
    express.enableCors({ origin: config.CORS_ORIGIN.split(','), credentials: true });
  }
  express.enableShutdownHooks();
  return express;
}
