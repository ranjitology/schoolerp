import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  StorageService,
  createUploadSchema,
  objectQuerySchema,
  registerObjectSchema,
} from './storage.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('uploads')
  @RequirePermissions('documents:write')
  createUpload(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createUploadSchema)) body: z.infer<typeof createUploadSchema>,
  ) {
    return this.storage.createUpload(auth, body);
  }

  @Post('objects')
  @RequirePermissions('documents:write')
  register(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(registerObjectSchema)) body: z.infer<typeof registerObjectSchema>,
    @Req() request: AppRequest,
  ) {
    return this.storage.register(auth, body, meta(request));
  }

  @Get('objects')
  @RequirePermissions('documents:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(objectQuerySchema)) query: z.infer<typeof objectQuerySchema>,
  ) {
    return this.storage.list(auth, query);
  }

  @Get('objects/:id/download')
  @RequirePermissions('documents:read')
  download(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.storage.downloadUrl(auth, params.id);
  }

  @Delete('objects/:id')
  @RequirePermissions('documents:write')
  remove(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.storage.remove(auth, params.id, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
