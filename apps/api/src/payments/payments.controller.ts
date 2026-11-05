import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import {
  CurrentAuth,
  Public,
  RequirePermissions,
} from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  PaymentsService,
  confirmPaymentIntentSchema,
  createPaymentIntentSchema,
  paymentWebhookSchema,
} from './payments.service';

const idParamSchema = z.object({ id: uuidSchema });
const webhookParamSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  schoolId: uuidSchema,
});
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intents')
  @RequirePermissions('fees:collect')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createPaymentIntentSchema)) body: z.infer<typeof createPaymentIntentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.payments.createIntent(auth, body, meta(request));
  }

  @Get('intents')
  @RequirePermissions('fees:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.payments.listIntents(auth, query.page, query.pageSize);
  }

  @Get('intents/:id')
  @RequirePermissions('fees:read')
  get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.payments.getIntent(auth, params.id);
  }

  @Post('intents/:id/confirm')
  @RequirePermissions('fees:collect')
  confirm(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(confirmPaymentIntentSchema)) body: z.infer<typeof confirmPaymentIntentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.payments.confirmIntent(auth, params.id, body, meta(request));
  }

  /**
   * Public provider callback. The tenant is in the path and the body must be
   * signed with PAYMENT_GATEWAY_WEBHOOK_SECRET.
   */
  @Post('webhook/:provider/:schoolId')
  @Public()
  webhook(
    @Param(zodBody(webhookParamSchema)) params: z.infer<typeof webhookParamSchema>,
    @Body(zodBody(paymentWebhookSchema)) body: z.infer<typeof paymentWebhookSchema>,
    @Req() request: AppRequest,
  ) {
    return this.payments.handleWebhook(
      params.schoolId,
      params.provider,
      body,
      request.header('x-payment-signature'),
      meta(request),
    );
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
