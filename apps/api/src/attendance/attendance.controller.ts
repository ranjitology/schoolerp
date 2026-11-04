import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import {
  attendanceQuerySchema,
  attendanceSessionParamSchema,
  attendanceSummaryQuerySchema,
  bulkAttendanceSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { AttendanceService, attendancePolicyUpdateSchema } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('policy')
  @RequirePermissions('attendance:read')
  policy(@CurrentAuth() auth: AuthPrincipal) {
    return this.attendance.policy(auth);
  }

  @Put('policy')
  @RequirePermissions('attendance:write')
  updatePolicy(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(attendancePolicyUpdateSchema))
    body: z.infer<typeof attendancePolicyUpdateSchema>,
    @Req() request: AppRequest,
  ) {
    return this.attendance.updatePolicy(auth, body, {
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Get()
  @RequirePermissions('attendance:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(attendanceQuerySchema)) query: z.infer<typeof attendanceQuerySchema>,
  ) {
    return this.attendance.list(auth, query);
  }

  @Get('session')
  @RequirePermissions('attendance:read')
  session(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(attendanceSessionParamSchema))
    query: z.infer<typeof attendanceSessionParamSchema>,
  ) {
    return this.attendance.session(auth, query);
  }

  @Get('summary')
  @RequirePermissions('attendance:read')
  summary(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(attendanceSummaryQuerySchema))
    query: z.infer<typeof attendanceSummaryQuerySchema>,
  ) {
    return this.attendance.summary(auth, query);
  }

  @Post('bulk')
  @RequirePermissions('attendance:write')
  bulk(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(bulkAttendanceSchema)) body: z.infer<typeof bulkAttendanceSchema>,
    @Req() request: AppRequest,
  ) {
    return this.attendance.bulk(auth, body, {
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }
}
