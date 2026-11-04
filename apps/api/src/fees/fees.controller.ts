import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  feeHeadSchema,
  feeListQuerySchema,
  feeStructureSchema,
  uuidSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  FeesService,
  defaulterQuerySchema,
  expenseRequestSchema,
  feeSummaryQuerySchema,
  generateInvoicesSchema,
  recordPaymentRequestSchema,
  refundRequestSchema,
} from './fees.service';

const idParamSchema = z.object({ id: uuidSchema });
const studentParamSchema = z.object({ studentId: uuidSchema });
const structureQuerySchema = z.object({
  academicYearId: uuidSchema.optional(),
  classId: uuidSchema.optional(),
});
const expenseQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const feeHeadUpdateSchema = feeHeadSchema.partial();

@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get('heads')
  @RequirePermissions('fees:read')
  heads(@CurrentAuth() auth: AuthPrincipal) {
    return this.fees.heads(auth);
  }

  @Post('heads')
  @RequirePermissions('fees:write')
  createHead(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(feeHeadSchema)) body: z.infer<typeof feeHeadSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.createHead(auth, body, meta(request));
  }

  @Patch('heads/:id')
  @RequirePermissions('fees:write')
  updateHead(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(feeHeadUpdateSchema)) body: z.infer<typeof feeHeadUpdateSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.updateHead(auth, params.id, body, meta(request));
  }

  @Get('structures')
  @RequirePermissions('fees:read')
  structures(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(structureQuerySchema)) query: z.infer<typeof structureQuerySchema>,
  ) {
    return this.fees.structures(auth, query);
  }

  @Post('structures')
  @RequirePermissions('fees:write')
  upsertStructure(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(feeStructureSchema)) body: z.infer<typeof feeStructureSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.upsertStructure(auth, body, meta(request));
  }

  @Delete('structures/:id')
  @RequirePermissions('fees:write')
  @HttpCode(200)
  deleteStructure(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.deleteStructure(auth, params.id, meta(request));
  }

  @Post('invoices/generate')
  @RequirePermissions('fees:write')
  @HttpCode(200)
  generate(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(generateInvoicesSchema)) body: z.infer<typeof generateInvoicesSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.generateInvoices(auth, body, meta(request));
  }

  @Get('invoices')
  @RequirePermissions('fees:read')
  invoices(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(feeListQuerySchema)) query: z.infer<typeof feeListQuerySchema>,
  ) {
    return this.fees.listInvoices(auth, query);
  }

  @Get('invoices/:id')
  @RequirePermissions('fees:read')
  invoice(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.fees.getInvoice(auth, params.id);
  }

  @Get('students/:studentId/ledger')
  @RequirePermissions('fees:read')
  ledger(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(studentParamSchema)) params: z.infer<typeof studentParamSchema>,
  ) {
    return this.fees.studentLedger(auth, params.studentId);
  }

  @Post('payments')
  @RequirePermissions('fees:collect')
  @HttpCode(201)
  collect(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(recordPaymentRequestSchema)) body: z.infer<typeof recordPaymentRequestSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.recordPayment(auth, body, meta(request));
  }

  @Post('refunds')
  @RequirePermissions('fees:refund')
  @HttpCode(201)
  refund(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(refundRequestSchema)) body: z.infer<typeof refundRequestSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.refund(auth, body, meta(request));
  }

  @Get('summary')
  @RequirePermissions('fees:read')
  summary(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(feeSummaryQuerySchema)) query: z.infer<typeof feeSummaryQuerySchema>,
  ) {
    return this.fees.summary(auth, query);
  }

  @Get('defaulters')
  @RequirePermissions('fees:read')
  defaulters(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(defaulterQuerySchema)) query: z.infer<typeof defaulterQuerySchema>,
  ) {
    return this.fees.defaulters(auth, query);
  }

  @Get('expenses')
  @RequirePermissions('fees:read')
  expenses(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(expenseQuerySchema)) query: z.infer<typeof expenseQuerySchema>,
  ) {
    return this.fees.expenses(auth, query);
  }

  @Post('expenses')
  @RequirePermissions('fees:write')
  createExpense(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(expenseRequestSchema)) body: z.infer<typeof expenseRequestSchema>,
    @Req() request: AppRequest,
  ) {
    return this.fees.createExpense(auth, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
