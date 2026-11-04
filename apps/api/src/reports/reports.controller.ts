import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  REPORT_KEYS,
  ReportsService,
  rangeQuerySchema,
  saveReportSchema,
} from './reports.service';

const exportQuerySchema = z.object({
  report: z.enum(REPORT_KEYS),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  classId: z.string().uuid().optional(),
});
const savedIdSchema = z.object({ id: uuidSchema });

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('saved')
  @RequirePermissions('analytics:read')
  saved(@CurrentAuth() auth: AuthPrincipal) {
    return this.reports.savedReports(auth);
  }

  @Post('saved')
  @RequirePermissions('analytics:read')
  saveReport(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(saveReportSchema)) body: z.infer<typeof saveReportSchema>,
    @Req() request: AppRequest,
  ) {
    return this.reports.saveReport(auth, body, meta(request));
  }

  @Delete('saved/:id')
  @RequirePermissions('analytics:read')
  @HttpCode(200)
  deleteSaved(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(savedIdSchema)) params: z.infer<typeof savedIdSchema>,
    @Req() request: AppRequest,
  ) {
    return this.reports.deleteSavedReport(auth, params.id, meta(request));
  }

  @Post('saved/:id/run')
  @RequirePermissions('analytics:read')
  @HttpCode(200)
  runSaved(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(savedIdSchema)) params: z.infer<typeof savedIdSchema>,
  ) {
    return this.reports.runSavedReport(auth, params.id);
  }

  @Get('saved/:id/export')
  @RequirePermissions('analytics:export')
  async exportSaved(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(savedIdSchema)) params: z.infer<typeof savedIdSchema>,
    @Res() response: Response,
  ) {
    const result = await this.reports.exportSavedReport(auth, params.id);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    response.send(`\uFEFF${result.csv}`);
  }

  @Get('overview')
  @RequirePermissions('analytics:read')
  overview(@CurrentAuth() auth: AuthPrincipal) {
    return this.reports.overview(auth);
  }

  @Get('enrollment')
  @RequirePermissions('analytics:read')
  enrollment(@CurrentAuth() auth: AuthPrincipal) {
    return this.reports.enrollment(auth);
  }

  @Get('attendance')
  @RequirePermissions('analytics:read')
  attendance(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(rangeQuerySchema)) query: z.infer<typeof rangeQuerySchema>,
  ) {
    return this.reports.attendance(auth, query);
  }

  @Get('fees')
  @RequirePermissions('analytics:read')
  fees(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(rangeQuerySchema)) query: z.infer<typeof rangeQuerySchema>,
  ) {
    return this.reports.fees(auth, query);
  }

  @Get('payroll')
  @RequirePermissions('payroll:read')
  payroll(@CurrentAuth() auth: AuthPrincipal) {
    return this.reports.payroll(auth);
  }

  @Get('modules')
  @RequirePermissions('analytics:read')
  modules(@CurrentAuth() auth: AuthPrincipal) {
    return this.reports.moduleSummary(auth);
  }

  @Get('export')
  @RequirePermissions('analytics:export')
  async export(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Res() res: Response,
  ) {
    const csv = await this.reports.exportCsv(auth, query.report, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${query.report}-${Date.now()}.csv"`);
    res.send(`\uFEFF${csv}`);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
