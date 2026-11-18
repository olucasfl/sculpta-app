import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Patch,
  Put,
} from '@nestjs/common';
import { ClinicUpdate, LOGO_MAX_BYTES, LogoUpload, type Clinic } from '@sim/contracts';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, storageKeys } from '../storage/storage.service.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async get(clinicId: string): Promise<Clinic> {
    const c = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    return {
      id: c.id,
      name: c.name,
      cnpj: c.cnpj,
      retentionDays: c.retentionDays,
      createdAt: c.createdAt.toISOString(),
      hasLogo: !!c.logoKey,
    };
  }

  async update(me: AuthContext, input: ClinicUpdate): Promise<Clinic> {
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id: me.clinicId }, data: input });
      await this.audit.log(me, 'CLINIC_UPDATE', 'clinic', me.clinicId, tx);
    });
    return this.get(me.clinicId);
  }

  /** Logo da clínica: só PNG ou JPEG de verdade (confere o conteúdo, não a extensão) e até 400 KB. */
  async setLogo(me: AuthContext, input: LogoUpload): Promise<Clinic> {
    const kind = input.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
    const bytes = Buffer.from(input.dataUrl.slice(input.dataUrl.indexOf(',') + 1), 'base64');
    if (bytes.length < 64 || bytes.length > LOGO_MAX_BYTES) {
      throw new BadRequestException({ code: 'LOGO_SIZE', message: 'O logo precisa ter até 400 KB' });
    }
    const magic = kind === 'png' ? PNG_MAGIC : JPEG_MAGIC;
    if (!bytes.subarray(0, magic.length).equals(magic)) {
      throw new BadRequestException({ code: 'LOGO_FORMAT', message: 'O arquivo não é uma imagem PNG ou JPEG válida' });
    }
    const previous = (await this.prisma.clinic.findUniqueOrThrow({ where: { id: me.clinicId }, select: { logoKey: true } })).logoKey;
    const key = storageKeys.logo(me.clinicId, kind);
    await this.storage.put(key, bytes, kind === 'png' ? 'image/png' : 'image/jpeg');
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id: me.clinicId }, data: { logoKey: key } });
      await this.audit.log(me, 'CLINIC_UPDATE', 'clinic', me.clinicId, tx);
    });
    if (previous && previous !== key) await this.storage.delete(previous);
    return this.get(me.clinicId);
  }

  async removeLogo(me: AuthContext): Promise<void> {
    const c = await this.prisma.clinic.findUniqueOrThrow({ where: { id: me.clinicId }, select: { logoKey: true } });
    if (!c.logoKey) return;
    await this.storage.delete(c.logoKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.clinic.update({ where: { id: me.clinicId }, data: { logoKey: null } });
      await this.audit.log(me, 'CLINIC_UPDATE', 'clinic', me.clinicId, tx);
    });
  }

  async getLogo(clinicId: string): Promise<Buffer> {
    const c = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { logoKey: true } });
    const bytes = c.logoKey ? await this.storage.get(c.logoKey) : null;
    if (!bytes) throw new NotFoundException('Esta clínica não tem logo');
    return bytes;
  }
}

@Controller('clinic')
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  @Get()
  get(@CurrentUser() me: AuthContext) {
    return this.clinics.get(me.clinicId);
  }

  @Patch()
  @RequirePermission('clinic.manage')
  update(@CurrentUser() me: AuthContext, @Body(new ZodPipe(ClinicUpdate)) body: ClinicUpdate) {
    return this.clinics.update(me, body);
  }

  /** Qualquer membro vê o logo da própria clínica (aparece no menu). */
  @Get('logo')
  @Header('Cache-Control', 'private, no-cache')
  logo(@CurrentUser() me: AuthContext) {
    return this.clinics.getLogo(me.clinicId);
  }

  @Put('logo')
  @RequirePermission('clinic.manage')
  setLogo(@CurrentUser() me: AuthContext, @Body(new ZodPipe(LogoUpload)) body: LogoUpload) {
    return this.clinics.setLogo(me, body);
  }

  @Delete('logo')
  @HttpCode(204)
  @RequirePermission('clinic.manage')
  removeLogo(@CurrentUser() me: AuthContext) {
    return this.clinics.removeLogo(me);
  }
}

@Module({ controllers: [ClinicsController], providers: [ClinicsService] })
export class ClinicsModule {}
