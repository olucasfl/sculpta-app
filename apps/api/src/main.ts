import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const app = await NestFactory.create(AppModule, { bodyParser: false });
const config = app.get<AppConfig>(APP_CONFIG);
configureApp(app, config);
await app.listen(config.PORT);
console.log(`API ouvindo em http://localhost:${config.PORT}/api`);
