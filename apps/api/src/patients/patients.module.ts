import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PatientCreate, PatientListQuery, PatientUpdate } from '@sim/contracts';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PatientsService } from './patients.service.js';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermission('patients.read')
  list(@CurrentUser() me: AuthContext, @Query(new ZodPipe(PatientListQuery)) q: PatientListQuery) {
    return this.patients.list(me.clinicId, q);
  }

  @Post()
  @RequirePermission('patients.write')
  create(@CurrentUser() me: AuthContext, @Body(new ZodPipe(PatientCreate)) body: PatientCreate) {
    return this.patients.create(me, body);
  }

  @Get(':id')
  @RequirePermission('patients.read')
  get(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.get(me, id);
  }

  @Patch(':id')
  @RequirePermission('patients.write')
  update(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PatientUpdate)) body: PatientUpdate,
  ) {
    return this.patients.update(me, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('patients.delete')
  async remove(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.patients.remove(me, id);
  }
}

@Module({ controllers: [PatientsController], providers: [PatientsService], exports: [PatientsService] })
export class PatientsModule {}
