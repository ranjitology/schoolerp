import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { PushService, pushSubscriptionSchema } from './push.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('notifications/push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get()
  list(@CurrentAuth() auth: AuthPrincipal) {
    return this.push.list(auth);
  }

  @Post()
  subscribe(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(pushSubscriptionSchema)) body: z.infer<typeof pushSubscriptionSchema>,
    @Req() request: AppRequest,
  ) {
    return this.push.subscribe(auth, body, meta(request));
  }

  @Delete(':id')
  unsubscribe(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.push.unsubscribe(auth, params.id, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
