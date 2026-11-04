import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  HostelService,
  allocateSchema,
  allocationQuerySchema,
  createHostelSchema,
  createRoomSchema,
  hostelQuerySchema,
  updateHostelSchema,
} from './hostel.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('hostel')
export class HostelController {
  constructor(private readonly hostel: HostelService) {}

  @Get('summary')
  @RequirePermissions('hostel:read')
  summary(@CurrentAuth() auth: AuthPrincipal) {
    return this.hostel.summary(auth);
  }

  @Get('hostels')
  @RequirePermissions('hostel:read')
  hostels(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(hostelQuerySchema)) query: z.infer<typeof hostelQuerySchema>,
  ) {
    return this.hostel.listHostels(auth, query);
  }

  @Post('hostels')
  @RequirePermissions('hostel:write')
  createHostel(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createHostelSchema)) body: z.infer<typeof createHostelSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hostel.createHostel(auth, body, meta(request));
  }

  @Patch('hostels/:id')
  @RequirePermissions('hostel:write')
  updateHostel(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateHostelSchema)) body: z.infer<typeof updateHostelSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hostel.updateHostel(auth, params.id, body, meta(request));
  }

  @Post('rooms')
  @RequirePermissions('hostel:write')
  createRoom(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createRoomSchema)) body: z.infer<typeof createRoomSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hostel.createRoom(auth, body, meta(request));
  }

  @Get('allocations')
  @RequirePermissions('hostel:read')
  allocations(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(allocationQuerySchema)) query: z.infer<typeof allocationQuerySchema>,
  ) {
    return this.hostel.allocations(auth, query);
  }

  @Post('allocations')
  @RequirePermissions('hostel:write')
  allocate(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(allocateSchema)) body: z.infer<typeof allocateSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hostel.allocate(auth, body, meta(request));
  }

  @Post('allocations/:id/vacate')
  @RequirePermissions('hostel:write')
  @HttpCode(200)
  vacate(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hostel.vacate(auth, params.id, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
