import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { SettingsService, settingsUpdateSchema } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings:read')
  get(@CurrentAuth() auth: AuthPrincipal) {
    return this.settings.get(auth);
  }

  @Patch()
  @RequirePermissions('settings:write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(settingsUpdateSchema)) body: z.infer<typeof settingsUpdateSchema>,
    @Req() request: AppRequest,
  ) {
    return this.settings.update(auth, body, meta(request));
  }

  @Get('academic-years')
  @RequirePermissions('settings:read')
  academicYears(@CurrentAuth() auth: AuthPrincipal) {
    return this.settings.listAcademicYears(auth);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
