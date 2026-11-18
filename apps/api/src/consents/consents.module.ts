import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ConsentCreate } from '@sim/contracts';
import type { Request } from 'express';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PatientsModule } from '../patients/patients.module.js';
import { ConsentsService } from './consents.service.js';

@Controller()
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get('patients/:patientId/consents')
  @RequirePermission('patients.read')
  list(@CurrentUser() me: AuthContext, @Param('patientId', ParseUUIDPipe) patientId: string) {
    return this.consents.list(me.clinicId, patientId);
  }

  @Post('patients/:patientId/consents')
  @RequirePermission('consents.write')
  sign(
    @CurrentUser() me: AuthContext,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body(new ZodPipe(ConsentCreate)) body: ConsentCreate,
    @Req() req: Request,
  ) {
    return this.consents.sign(me, patientId, body, req.get('user-agent') ?? null);
  }

  @Post('consents/:id/revoke')
  @HttpCode(200)
  @RequirePermission('consents.revoke')
  revoke(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.consents.revoke(me, id);
  }

  @Get('consents/:id/signature')
  @RequirePermission('patients.read')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'no-store')
  async signature(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.consents.signature(me, id));
  }
}

@Module({
  imports: [PatientsModule],
  controllers: [ConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
