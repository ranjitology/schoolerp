import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  NoticesService,
  createNoticeSchema,
  deliveryQuerySchema,
  noticeListQuerySchema,
  notificationPreferencesSchema,
  notificationQuerySchema,
  sendNoticeSchema,
  updateNoticeSchema,
} from './notices.service';

const idParamSchema = z.object({ id: uuidSchema });
const deliveryParamSchema = z.object({ id: uuidSchema });

@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @RequirePermissions('communication:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(noticeListQuerySchema)) query: z.infer<typeof noticeListQuerySchema>,
  ) {
    return this.notices.list(auth, query);
  }

  @Post()
  @RequirePermissions('communication:write')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createNoticeSchema)) body: z.infer<typeof createNoticeSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.create(auth, body, meta(request));
  }

  @Patch(':id')
  @RequirePermissions('communication:write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateNoticeSchema)) body: z.infer<typeof updateNoticeSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.update(auth, params.id, body, meta(request));
  }

  @Post(':id/publish')
  @RequirePermissions('communication:write')
  @HttpCode(200)
  publish(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.publish(auth, params.id, meta(request));
  }

  @Post(':id/archive')
  @RequirePermissions('communication:write')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.archive(auth, params.id, meta(request));
  }

  @Post(':id/send')
  @RequirePermissions('communication:write')
  @HttpCode(200)
  send(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(sendNoticeSchema)) body: z.infer<typeof sendNoticeSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.send(auth, params.id, body, meta(request));
  }

  @Get(':id/deliveries')
  @RequirePermissions('communication:read')
  deliveries(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Query(zodBody(deliveryQuerySchema)) query: z.infer<typeof deliveryQuerySchema>,
  ) {
    return this.notices.deliveries(auth, params.id, query);
  }

  @Post('deliveries/:id/retry')
  @RequirePermissions('communication:write')
  @HttpCode(200)
  retryDelivery(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(deliveryParamSchema)) params: z.infer<typeof deliveryParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.retryDelivery(auth, params.id, meta(request));
  }
}

@Controller('portal/notices')
export class PortalNoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @RequirePermissions('portal:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(noticeListQuerySchema)) query: z.infer<typeof noticeListQuerySchema>,
  ) {
    return this.notices.portal(auth, query);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @RequirePermissions('dashboard:view')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(notificationQuerySchema)) query: z.infer<typeof notificationQuerySchema>,
  ) {
    return this.notices.notifications(auth, query);
  }

  @Post(':id/read')
  @RequirePermissions('dashboard:view')
  @HttpCode(200)
  read(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.notices.markNotificationRead(auth, params.id);
  }

  @Get('preferences')
  @RequirePermissions('dashboard:view')
  preferences(@CurrentAuth() auth: AuthPrincipal) {
    return this.notices.notificationPreferences(auth);
  }

  @Put('preferences')
  @RequirePermissions('dashboard:view')
  updatePreferences(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(notificationPreferencesSchema))
    body: z.infer<typeof notificationPreferencesSchema>,
    @Req() request: AppRequest,
  ) {
    return this.notices.updateNotificationPreferences(auth, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
