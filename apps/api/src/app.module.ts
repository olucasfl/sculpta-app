import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BiometricsModule } from './biometrics/biometric-purge.service.js';
import { ClinicsModule } from './clinics/clinics.module.js';
import { InvitationsModule } from './clinics/invitations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { SupportModule } from './support/support.module.js';
import { Public } from './common/auth-context.js';
import { JwtAuthGuard, PermissionsGuard } from './common/guards.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ConfigModule } from './config/config.module.js';
import { ConsentsModule } from './consents/consents.module.js';
import { PatientsModule } from './patients/patients.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';
import { CapturesModule } from './captures/captures.module.js';
import { ReconstructionsModule } from './reconstructions/reconstructions.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { SimulationsModule } from './simulations/simulations.module.js';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: true };
  }
}

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    StorageModule,
    AuditModule,
    BiometricsModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: Number(process.env.GLOBAL_RATE_LIMIT ?? 300) }]),
    AuthModule,
    ClinicsModule,
    InvitationsModule,
    PlatformModule,
    SupportModule,
    UsersModule,
    PatientsModule,
    ConsentsModule,
    CapturesModule,
    ReconstructionsModule,
    SimulationsModule,
    RetentionModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
