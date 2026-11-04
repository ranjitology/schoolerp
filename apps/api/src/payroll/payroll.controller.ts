import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  PayrollService,
  createPayrollRunSchema,
  generatePayslipsSchema,
} from './payroll.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('runs')
  @RequirePermissions('payroll:read')
  listRuns(@CurrentAuth() auth: AuthPrincipal) {
    return this.payroll.listRuns(auth);
  }

  @Get('runs/:id')
  @RequirePermissions('payroll:read')
  getRun(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.payroll.getRun(auth, params.id);
  }

  @Post('runs')
  @RequirePermissions('payroll:write')
  createRun(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createPayrollRunSchema)) body: z.infer<typeof createPayrollRunSchema>,
    @Req() request: AppRequest,
  ) {
    return this.payroll.createRun(auth, body, meta(request));
  }

  @Post('payslips/generate')
  @RequirePermissions('payroll:write')
  generate(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(generatePayslipsSchema)) body: z.infer<typeof generatePayslipsSchema>,
    @Req() request: AppRequest,
  ) {
    return this.payroll.generatePayslips(auth, body, meta(request));
  }

  @Post('runs/:id/process')
  @RequirePermissions('payroll:write')
  @HttpCode(200)
  process(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.payroll.processRun(auth, params.id, meta(request));
  }

  @Get('me')
  @RequirePermissions('dashboard:view')
  mine(@CurrentAuth() auth: AuthPrincipal) {
    return this.payroll.myPayslips(auth);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
