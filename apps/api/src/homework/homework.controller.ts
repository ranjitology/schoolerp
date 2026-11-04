import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  HomeworkService,
  createHomeworkSchema,
  homeworkQuerySchema,
  updateHomeworkSchema,
} from './homework.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('homework')
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get()
  @RequirePermissions('homework:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(homeworkQuerySchema)) query: z.infer<typeof homeworkQuerySchema>,
  ) {
    return this.homework.list(auth, query);
  }

  @Post()
  @RequirePermissions('homework:write')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createHomeworkSchema)) body: z.infer<typeof createHomeworkSchema>,
    @Req() request: AppRequest,
  ) {
    return this.homework.create(auth, body, meta(request));
  }

  @Patch(':id')
  @RequirePermissions('homework:write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateHomeworkSchema)) body: z.infer<typeof updateHomeworkSchema>,
    @Req() request: AppRequest,
  ) {
    return this.homework.update(auth, params.id, body, meta(request));
  }

  @Delete(':id')
  @RequirePermissions('homework:write')
  remove(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.homework.remove(auth, params.id, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
