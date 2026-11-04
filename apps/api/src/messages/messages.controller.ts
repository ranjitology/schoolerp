import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  MessagesService,
  createThreadSchema,
  sendMessageSchema,
  threadQuerySchema,
} from './messages.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('threads')
  @RequirePermissions('messages:read')
  listThreads(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(threadQuerySchema)) query: z.infer<typeof threadQuerySchema>,
  ) {
    return this.messages.listThreads(auth, query);
  }

  @Post('threads')
  @RequirePermissions('messages:write')
  createThread(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createThreadSchema)) body: z.infer<typeof createThreadSchema>,
    @Req() request: AppRequest,
  ) {
    return this.messages.createThread(auth, body, meta(request));
  }

  @Get('participants')
  @RequirePermissions('messages:read')
  participants(@CurrentAuth() auth: AuthPrincipal) {
    return this.messages.participants(auth);
  }

  @Get('threads/:id')
  @RequirePermissions('messages:read')
  getThread(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.messages.getThread(auth, params.id);
  }

  @Post('threads/:id/messages')
  @RequirePermissions('messages:write')
  send(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>,
    @Req() request: AppRequest,
  ) {
    return this.messages.sendMessage(auth, params.id, body, meta(request));
  }

  @Post('messages/:id/read')
  @RequirePermissions('messages:read')
  @HttpCode(200)
  markRead(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.messages.markRead(auth, params.id);
  }

  @Get('unread')
  @RequirePermissions('messages:read')
  unread(@CurrentAuth() auth: AuthPrincipal) {
    return this.messages.unreadCount(auth);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
