import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  TransportService,
  assignTransportSchema,
  createRouteSchema,
  routeQuerySchema,
  updateRouteSchema,
} from './transport.service';

const idParamSchema = z.object({ id: uuidSchema });
const assignmentQuerySchema = z.object({ routeId: uuidSchema.optional() });

@Controller('transport')
export class TransportController {
  constructor(private readonly transport: TransportService) {}

  @Get('summary')
  @RequirePermissions('transport:read')
  summary(@CurrentAuth() auth: AuthPrincipal) {
    return this.transport.summary(auth);
  }

  @Get('routes')
  @RequirePermissions('transport:read')
  routes(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(routeQuerySchema)) query: z.infer<typeof routeQuerySchema>,
  ) {
    return this.transport.listRoutes(auth, query);
  }

  @Post('routes')
  @RequirePermissions('transport:write')
  createRoute(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createRouteSchema)) body: z.infer<typeof createRouteSchema>,
    @Req() request: AppRequest,
  ) {
    return this.transport.createRoute(auth, body, meta(request));
  }

  @Patch('routes/:id')
  @RequirePermissions('transport:write')
  updateRoute(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateRouteSchema)) body: z.infer<typeof updateRouteSchema>,
    @Req() request: AppRequest,
  ) {
    return this.transport.updateRoute(auth, params.id, body, meta(request));
  }

  @Get('assignments')
  @RequirePermissions('transport:read')
  assignments(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(assignmentQuerySchema)) query: z.infer<typeof assignmentQuerySchema>,
  ) {
    return this.transport.assignments(auth, query.routeId);
  }

  @Post('assignments')
  @RequirePermissions('transport:write')
  assign(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(assignTransportSchema)) body: z.infer<typeof assignTransportSchema>,
    @Req() request: AppRequest,
  ) {
    return this.transport.assign(auth, body, meta(request));
  }

  @Delete('assignments/:id')
  @RequirePermissions('transport:write')
  unassign(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.transport.unassign(auth, params.id, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
