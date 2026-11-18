import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
