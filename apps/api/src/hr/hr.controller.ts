import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  HrService,
  createLeaveSchema,
  createStaffSchema,
  leaveQuerySchema,
  markStaffAttendanceSchema,
  staffAttendanceQuerySchema,
  staffListQuerySchema,
  updateStaffSchema,
} from './hr.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('summary')
  @RequirePermissions('staff:read')
  summary(@CurrentAuth() auth: AuthPrincipal) {
    return this.hr.summary(auth);
  }

  @Get('staff')
  @RequirePermissions('staff:read')
  listStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(staffListQuerySchema)) query: z.infer<typeof staffListQuerySchema>,
  ) {
    return this.hr.listStaff(auth, query);
  }

  @Get('staff/:id')
  @RequirePermissions('staff:read')
  getStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.hr.getStaff(auth, params.id);
  }

  @Post('staff')
  @RequirePermissions('staff:write')
  createStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createStaffSchema)) body: z.infer<typeof createStaffSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.createStaff(auth, body, meta(request));
  }

  @Patch('staff/:id')
  @RequirePermissions('staff:write')
  updateStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateStaffSchema)) body: z.infer<typeof updateStaffSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.updateStaff(auth, params.id, body, meta(request));
  }

  @Delete('staff/:id')
  @RequirePermissions('staff:write')
  removeStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.removeStaff(auth, params.id, meta(request));
  }

  @Get('leaves')
  @RequirePermissions('staff:read')
  listLeaves(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(leaveQuerySchema)) query: z.infer<typeof leaveQuerySchema>,
  ) {
    return this.hr.listLeaves(auth, query);
  }

  @Post('leaves')
  @RequirePermissions('staff:write')
  createLeave(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createLeaveSchema)) body: z.infer<typeof createLeaveSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.createLeave(auth, body, meta(request));
  }

  @Post('leaves/:id/approve')
  @RequirePermissions('staff:write')
  @HttpCode(200)
  approveLeave(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.decideLeave(auth, params.id, 'APPROVED', meta(request));
  }

  @Post('leaves/:id/reject')
  @RequirePermissions('staff:write')
  @HttpCode(200)
  rejectLeave(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.decideLeave(auth, params.id, 'REJECTED', meta(request));
  }

  @Get('attendance')
  @RequirePermissions('staff:read')
  attendance(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(staffAttendanceQuerySchema)) query: z.infer<typeof staffAttendanceQuerySchema>,
  ) {
    return this.hr.attendance(auth, query);
  }

  @Post('attendance')
  @RequirePermissions('staff:write')
  markAttendance(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(markStaffAttendanceSchema)) body: z.infer<typeof markStaffAttendanceSchema>,
    @Req() request: AppRequest,
  ) {
    return this.hr.markAttendance(auth, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
