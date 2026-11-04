import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  SyncService,
  pullQuerySchema,
  resolveConflictSchema,
  syncBatchSchema,
  syncQuerySchema,
} from './sync.service';

const conflictParamSchema = z.object({ id: uuidSchema });

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('batches')
  @RequirePermissions('attendance:write')
  push(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(syncBatchSchema)) body: z.infer<typeof syncBatchSchema>,
    @Req() request: AppRequest,
  ) {
    return this.sync.push(auth, body, meta(request));
  }

  @Get('batches')
  @RequirePermissions('attendance:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(syncQuerySchema)) query: z.infer<typeof syncQuerySchema>,
  ) {
    return this.sync.list(auth, query);
  }

  @Get('pull')
  @RequirePermissions('attendance:read')
  pull(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(pullQuerySchema)) query: z.infer<typeof pullQuerySchema>,
  ) {
    return this.sync.pull(auth, query);
  }

  @Get('conflicts')
  @RequirePermissions('attendance:read')
  conflicts(@CurrentAuth() auth: AuthPrincipal) {
    return this.sync.conflicts(auth);
  }

  @Post('conflicts/:id/resolve')
  @RequirePermissions('attendance:write')
  @HttpCode(200)
  resolveConflict(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(conflictParamSchema)) params: z.infer<typeof conflictParamSchema>,
    @Body(zodBody(resolveConflictSchema)) body: z.infer<typeof resolveConflictSchema>,
    @Req() request: AppRequest,
  ) {
    return this.sync.resolveConflict(auth, params.id, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
