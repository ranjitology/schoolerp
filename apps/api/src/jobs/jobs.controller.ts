import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { JobsService, createJobSchema, jobQuerySchema } from './jobs.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermissions('settings:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(jobQuerySchema)) query: z.infer<typeof jobQuerySchema>,
  ) {
    return this.jobs.list(auth, query);
  }

  @Post()
  @RequirePermissions('settings:write')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createJobSchema)) body: z.infer<typeof createJobSchema>,
    @Req() request: AppRequest,
  ) {
    return this.jobs.create(auth, body, meta(request));
  }

  @Get(':id')
  @RequirePermissions('settings:read')
  get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.jobs.get(auth, params.id);
  }

  @Post(':id/run')
  @RequirePermissions('settings:write')
  @HttpCode(200)
  run(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.jobs.run(auth, params.id, meta(request));
  }

  @Post(':id/cancel')
  @RequirePermissions('settings:write')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.jobs.cancel(auth, params.id, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
