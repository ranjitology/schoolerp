import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  AdmissionsService,
  applicationQuerySchema,
  bulkConvertSchema,
  convertApplicationSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from './admissions.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermissions('admissions:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(applicationQuerySchema)) query: z.infer<typeof applicationQuerySchema>,
  ) {
    return this.admissions.list(auth, query);
  }

  @Get(':id')
  @RequirePermissions('admissions:read')
  get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.admissions.get(auth, params.id);
  }

  @Post()
  @RequirePermissions('admissions:write')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createApplicationSchema)) body: z.infer<typeof createApplicationSchema>,
    @Req() request: AppRequest,
  ) {
    return this.admissions.create(auth, body, meta(request));
  }

  @Patch(':id')
  @RequirePermissions('admissions:write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateApplicationSchema)) body: z.infer<typeof updateApplicationSchema>,
    @Req() request: AppRequest,
  ) {
    return this.admissions.update(auth, params.id, body, meta(request));
  }

  @Get(':id/offer-letter')
  @RequirePermissions('admissions:read')
  async offerLetter(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Res() response: Response,
  ) {
    const letter = await this.admissions.offerLetter(auth, params.id);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Disposition', `inline; filename="${letter.fileName}"`);
    response.send(letter.html);
  }

  @Post('bulk-convert')
  @RequirePermissions('admissions:write')
  @HttpCode(200)
  bulkConvert(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(bulkConvertSchema)) body: z.infer<typeof bulkConvertSchema>,
    @Req() request: AppRequest,
  ) {
    return this.admissions.bulkConvert(auth, body, meta(request));
  }

  @Post(':id/convert')
  @RequirePermissions('admissions:write')
  convert(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(convertApplicationSchema)) body: z.infer<typeof convertApplicationSchema>,
    @Req() request: AppRequest,
  ) {
    return this.admissions.convert(auth, params.id, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
