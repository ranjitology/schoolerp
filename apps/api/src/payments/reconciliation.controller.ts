import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  ReconciliationService,
  importSettlementSchema,
  pullSettlementSchema,
  reconciliationQuerySchema,
} from './reconciliation.service';

const idParamSchema = z.object({ id: z.string().uuid() });

@Controller('payments/reconciliations')
export class ReconciliationController {
  constructor(private readonly reconciliations: ReconciliationService) {}

  /** Imports a settlement feed supplied as JSON. */
  @Post('import')
  @RequirePermissions('fees:reconcile')
  import(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(importSettlementSchema)) body: z.infer<typeof importSettlementSchema>,
    @Req() request: AppRequest,
  ) {
    return this.reconciliations.importSettlement(auth, body, meta(request));
  }

  /** Pulls the configured settlement feed and reconciles the date range. */
  @Post('pull')
  @RequirePermissions('fees:reconcile')
  @HttpCode(200)
  pull(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(pullSettlementSchema)) body: z.infer<typeof pullSettlementSchema>,
    @Req() request: AppRequest,
  ) {
    return this.reconciliations.pullSettlement(auth, body, meta(request));
  }

  @Get()
  @RequirePermissions('fees:reconcile')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(reconciliationQuerySchema))
    query: z.infer<typeof reconciliationQuerySchema>,
  ) {
    return this.reconciliations.list(auth, query);
  }

  @Get(':id/export')
  @RequirePermissions('fees:reconcile')
  async export(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Res() response: Response,
  ) {
    const result = await this.reconciliations.exportCsv(auth, params.id);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    response.send(`\uFEFF${result.csv}`);
  }

  @Get(':id')
  @RequirePermissions('fees:reconcile')
  get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.reconciliations.get(auth, params.id);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
