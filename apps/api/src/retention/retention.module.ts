import {
  Controller,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Post,
} from '@nestjs/common';
import { BiometricPurgeService } from '../biometrics/biometric-purge.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 86_400_000;

/**
 * Expurgo por prazo de retenção: pacientes sem atividade (captura ou simulação) há mais
 * de `clinic.retentionDays` dias têm fotos, malhas e simulações apagadas. O cadastro fica.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Retenção');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purge: BiometricPurgeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.RETENTION_ENABLED) return;
    this.timer = setInterval(() => void this.runAll().catch((e) => this.logger.error(e)), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runAll() {
    const clinics = await this.prisma.clinic.findMany({ select: { id: true } });
    let total = 0;
    for (const c of clinics) total += await this.runForClinic(c.id, null, null);
    return total;
  }

  async runForClinic(clinicId: string, userId: string | null, ip: string | null) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    const cutoff = new Date(Date.now() - clinic.retentionDays * DAY_MS);
    const expired = await this.prisma.patient.findMany({
      where: { clinicId, deletedAt: null, lastActivityAt: { lt: cutoff }, captures: { some: {} } },
      select: { id: true },
    });
    for (const p of expired) {
      await this.purge.purgePatient({ clinicId, userId, ip }, p.id, 'RETENTION_PURGE');
    }
    if (expired.length) this.logger.log(`Clínica ${clinicId}: biométricos de ${expired.length} paciente(s) expurgados`);
    return expired.length;
  }
}

@Controller('clinic/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /** Roda o expurgo agora (além da rotina diária). */
  @Post('run')
  @HttpCode(200)
  @RequirePermission('clinic.retention')
  async run(@CurrentUser() me: AuthContext) {
    return { purgedPatients: await this.retention.runForClinic(me.clinicId, me.userId, me.ip) };
  }
}

@Module({ controllers: [RetentionController], providers: [RetentionService], exports: [RetentionService] })
export class RetentionModule {}
