import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { PhotoAngle, PhotoRegister } from '@sim/contracts';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ConsentsModule } from '../consents/consents.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { CapturesService } from './captures.service.js';

const anglePipe = new ZodPipe(PhotoAngle);

@Controller()
export class CapturesController {
  constructor(private readonly captures: CapturesService) {}

  @Post('patients/:patientId/captures')
  @RequirePermission('patients.write')
  create(@CurrentUser() me: AuthContext, @Param('patientId', ParseUUIDPipe) patientId: string) {
    return this.captures.create(me, patientId);
  }

  @Get('patients/:patientId/captures')
  @RequirePermission('patients.read')
  list(@CurrentUser() me: AuthContext, @Param('patientId', ParseUUIDPipe) patientId: string) {
    return this.captures.listForPatient(me.clinicId, patientId);
  }

  @Get('captures/:id')
  @RequirePermission('patients.read')
  get(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.captures.get(me, id);
  }

  @Post('captures/:id/uploads/:angle')
  @HttpCode(200)
  @RequirePermission('patients.write')
  upload(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('angle', anglePipe) angle: PhotoAngle,
  ) {
    return this.captures.uploadTarget(me, id, angle);
  }

  @Put('captures/:id/photos/:angle')
  @RequirePermission('patients.write')
  register(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('angle', anglePipe) angle: PhotoAngle,
    @Body(new ZodPipe(PhotoRegister)) body: PhotoRegister,
  ) {
    return this.captures.registerPhoto(me, id, angle, body);
  }

  @Delete('captures/:id/photos/:angle')
  @RequirePermission('patients.write')
  deletePhoto(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('angle', anglePipe) angle: PhotoAngle,
  ) {
    return this.captures.deletePhoto(me, id, angle);
  }

  @Post('captures/:id/complete')
  @HttpCode(200)
  @RequirePermission('patients.write')
  complete(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.captures.complete(me, id);
  }

  @Post('captures/:id/cancel')
  @HttpCode(204)
  @RequirePermission('patients.write')
  async cancel(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.captures.cancel(me, id);
  }
}

@Module({
  imports: [PatientsModule, ConsentsModule],
  controllers: [CapturesController],
  providers: [CapturesService],
})
export class CapturesModule {}
