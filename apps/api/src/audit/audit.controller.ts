import { Controller, Get, Query } from '@nestjs/common';
import { PageQuery } from '@sim/contracts';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from './audit.service.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@CurrentUser() me: AuthContext, @Query(new ZodPipe(PageQuery)) q: PageQuery) {
    return this.audit.list(me.clinicId, q);
  }
}
