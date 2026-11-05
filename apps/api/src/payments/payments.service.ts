import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AppError,
  ConflictError,
  NotFoundError,
  stableStringify,
  uuidv7,
  type Permission,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { FeesService } from '../fees/fees.service';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const PROVIDERS = ['mock', 'esewa', 'khalti', 'stripe', 'bank'] as const;
const isoDateTime = z.string().datetime({ offset: true });

export const createPaymentIntentSchema = z.object({
  studentId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  provider: z.enum(PROVIDERS).default('mock'),
  idempotencyKey: z.string().trim().min(8).max(128),
  metadata: z.record(z.unknown()).default({}),
});
export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;

export const confirmPaymentIntentSchema = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED']).default('SUCCEEDED'),
  providerRef: z.string().trim().max(160).optional(),
  paidAt: isoDateTime.optional(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'ESEWA', 'KHALTI', 'CHEQUE', 'OTHER']).optional(),
});

export const paymentWebhookSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  providerRef: z.string().trim().min(1).max(160),
  status: z.enum(['SUCCEEDED', 'FAILED']),
  amountMinor: z.number().int().min(1).max(2_147_483_647).optional(),
  paidAt: isoDateTime.optional(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'ESEWA', 'KHALTI', 'CHEQUE', 'OTHER']).optional(),
});
export type PaymentWebhookInput = z.infer<typeof paymentWebhookSchema>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly fees: FeesService,
  ) {}

  async createIntent(
    auth: AuthPrincipal,
    input: CreatePaymentIntentInput,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const duplicate = await tx.paymentIntent.findUnique({
        where: {
          schoolId_idempotencyKey: {
            schoolId: auth.schoolId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (duplicate) return intentDto(duplicate);

      const student = await tx.student.findFirst({
        where: { id: input.studentId, schoolId: auth.schoolId, deletedAt: null },
        select: { id: true },
      });
      if (!student) throw new NotFoundError('Student');

      if (input.invoiceId) {
        const invoice = await tx.invoice.findFirst({
          where: { id: input.invoiceId, schoolId: auth.schoolId, studentId: input.studentId },
          select: { id: true, totalMinor: true, paidMinor: true, status: true },
        });
        if (!invoice) throw new NotFoundError('Invoice');
        if (invoice.status === 'VOID' || invoice.status === 'DRAFT') {
          throw new ConflictError('This invoice cannot be paid');
        }
        const outstanding = invoice.totalMinor - invoice.paidMinor;
        if (input.amountMinor > outstanding) {
          throw new AppError('VALIDATION_FAILED', 'The amount exceeds the invoice balance', 422, {
            outstandingMinor: outstanding,
          });
        }
      }

      const providerRef = `${input.provider}_${uuidv7()}`;
      const intent = await tx.paymentIntent.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          studentId: input.studentId,
          invoiceId: input.invoiceId ?? null,
          amountMinor: input.amountMinor,
          provider: input.provider,
          providerRef,
          status: 'REQUIRES_ACTION',
          idempotencyKey: input.idempotencyKey,
          createdByUserId: auth.userId,
          metadata: input.metadata as never,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'payment_intent.created',
        entity: 'PaymentIntent',
        entityId: intent.id,
        after: {
          provider: intent.provider,
          amountMinor: intent.amountMinor,
          invoiceId: intent.invoiceId,
        },
      });
      return intentDto(intent);
    });
  }

  async getIntent(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const intent = await tx.paymentIntent.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!intent) throw new NotFoundError('Payment intent');
      return intentDto(intent);
    });
  }

  async listIntents(auth: AuthPrincipal, page: number, pageSize: number) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where = { schoolId: auth.schoolId };
      const [items, total] = await Promise.all([
        tx.paymentIntent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.paymentIntent.count({ where }),
      ]);
      return { items: items.map(intentDto), page, pageSize, total };
    });
  }

  /**
   * Development/manual confirmation path. Real deployments normally use the
   * signed webhook below; both paths share the same idempotent settlement.
   */
  async confirmIntent(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof confirmPaymentIntentSchema>,
    meta: AuditMeta,
  ) {
    const intent = await withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const row = await tx.paymentIntent.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!row) throw new NotFoundError('Payment intent');
      return row;
    });

    if (intent.status === 'SUCCEEDED' && intent.paymentId) {
      return { ...intentDto(intent), alreadyProcessed: true };
    }
    if (intent.status === 'CANCELLED' || intent.status === 'EXPIRED') {
      throw new ConflictError('This payment intent is no longer payable');
    }

    return this.settleIntent(auth, intent, input, meta);
  }

  async handleWebhook(
    schoolId: string,
    provider: string,
    payload: PaymentWebhookInput,
    signature: string | undefined,
    meta: AuditMeta,
  ) {
    const secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET?.trim();
    const signatureValid = secret ? verifySignature(secret, schoolId, payload, signature) : false;
    if (secret && !signatureValid) {
      throw new AppError('UNAUTHORIZED', 'Invalid payment webhook signature', 401);
    }
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new AppError('UNAUTHORIZED', 'Payment webhook secret is not configured', 401);
    }

    const existingEvent = await withTenant({ schoolId }, (tx) =>
      tx.paymentWebhookEvent.findUnique({
        where: { provider_eventId: { provider, eventId: payload.eventId } },
        select: { id: true, processedAt: true },
      }),
    );
    if (existingEvent) {
      return { received: true, duplicate: true, processedAt: existingEvent.processedAt };
    }

    const event = await withTenant({ schoolId }, async (tx) => {
      const intent = await tx.paymentIntent.findFirst({
        where: { schoolId, provider, providerRef: payload.providerRef },
      });
      if (!intent) throw new NotFoundError('Payment intent');
      const row = await tx.paymentWebhookEvent.create({
        data: {
          id: uuidv7(),
          schoolId,
          provider,
          eventId: payload.eventId,
          signatureValid,
          payload: payload as never,
        },
      });
      return { event: row, intent };
    });

    const intent = event.intent;
    if (payload.amountMinor && payload.amountMinor !== intent.amountMinor) {
      await withTenant({ schoolId }, (tx) =>
        tx.paymentWebhookEvent.update({
          where: { id: event.event.id },
          data: {
            error: 'Amount does not match the payment intent',
            processedAt: new Date(),
          },
        }),
      );
      throw new ConflictError('Webhook amount does not match the payment intent');
    }

    const auth = systemAuth(schoolId, intent.createdByUserId);
    try {
      const result = await this.settleIntent(
        auth,
        intent,
        {
          status: payload.status,
          providerRef: payload.providerRef,
          paidAt: payload.paidAt,
          method: payload.method,
        },
        { ...meta, requestId: `webhook-${payload.eventId}` },
      );
      await withTenant({ schoolId }, (tx) =>
        tx.paymentWebhookEvent.update({
          where: { id: event.event.id },
          data: { processedAt: new Date() },
        }),
      );
      return { received: true, duplicate: false, ...result };
    } catch (error) {
      await withTenant({ schoolId }, (tx) =>
        tx.paymentWebhookEvent.update({
          where: { id: event.event.id },
          data: {
            error: (error instanceof Error ? error.message : 'Webhook processing failed').slice(0, 1000),
            processedAt: new Date(),
          },
        }),
      );
      throw error;
    }
  }

  private async settleIntent(
    auth: AuthPrincipal,
    intent: {
      id: string;
      schoolId: string;
      studentId: string;
      invoiceId: string | null;
      amountMinor: number;
      provider: string;
      providerRef: string | null;
      status: string;
      createdByUserId: string | null;
    },
    input: z.infer<typeof confirmPaymentIntentSchema>,
    meta: AuditMeta,
  ) {
    if (input.status === 'FAILED') {
      const failed = await withTenant({ schoolId: intent.schoolId }, (tx) =>
        tx.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'FAILED', providerRef: input.providerRef ?? intent.providerRef },
        }),
      );
      await withTenant({ schoolId: intent.schoolId }, (tx) =>
        this.audit.record(tx, auditCtx(auth, meta), {
          action: 'payment_intent.failed',
          entity: 'PaymentIntent',
          entityId: intent.id,
          after: { provider: intent.provider },
        }),
      );
      return { ...intentDto(failed), alreadyProcessed: false };
    }

    await withTenant({ schoolId: intent.schoolId }, (tx) =>
      tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'PROCESSING', providerRef: input.providerRef ?? intent.providerRef },
      }),
    );

    try {
      const payment = await this.fees.recordPayment(
        auth,
        {
          studentId: intent.studentId,
          amountMinor: intent.amountMinor,
          method: input.method ?? methodForProvider(intent.provider),
          paidAt: input.paidAt ?? new Date().toISOString(),
          reference: intent.providerRef ?? undefined,
          notes: `Hosted ${intent.provider} payment`,
          idempotencyKey: intent.id,
          invoiceIds: intent.invoiceId ? [intent.invoiceId] : undefined,
        },
        meta,
      );

      const settled = await withTenant({ schoolId: intent.schoolId }, (tx) =>
        tx.paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: 'SUCCEEDED',
            paymentId: payment.id,
            providerRef: input.providerRef ?? intent.providerRef,
          },
        }),
      );
      await withTenant({ schoolId: intent.schoolId }, (tx) =>
        this.audit.record(tx, auditCtx(auth, meta), {
          action: 'payment_intent.succeeded',
          entity: 'PaymentIntent',
          entityId: intent.id,
          after: {
            provider: intent.provider,
            paymentId: payment.id,
            receiptNumber: payment.receiptNumber,
            amountMinor: payment.amountMinor,
          },
        }),
      );
      return { ...intentDto(settled), payment, alreadyProcessed: false };
    } catch (error) {
      await withTenant({ schoolId: intent.schoolId }, (tx) =>
        tx.paymentIntent.update({
          where: { id: intent.id },
          data: { status: 'FAILED' },
        }),
      );
      throw error;
    }
  }
}

function intentDto(intent: {
  id: string;
  studentId: string;
  invoiceId: string | null;
  amountMinor: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  status: string;
  paymentId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  metadata: unknown;
}) {
  const base = process.env.PAYMENT_GATEWAY_CHECKOUT_BASE_URL?.trim();
  return {
    id: intent.id,
    studentId: intent.studentId,
    invoiceId: intent.invoiceId,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    provider: intent.provider,
    providerRef: intent.providerRef,
    status: intent.status,
    paymentId: intent.paymentId,
    expiresAt: intent.expiresAt,
    createdAt: intent.createdAt,
    metadata: intent.metadata,
    checkoutUrl: base && intent.providerRef ? `${base.replace(/\/$/, '')}/${intent.providerRef}` : null,
  };
}

function methodForProvider(provider: string): 'CARD' | 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER' | 'OTHER' {
  switch (provider) {
    case 'esewa':
      return 'ESEWA';
    case 'khalti':
      return 'KHALTI';
    case 'bank':
      return 'BANK_TRANSFER';
    case 'stripe':
    case 'mock':
      return 'CARD';
    default:
      return 'OTHER';
  }
}

function systemAuth(schoolId: string, userId: string | null): AuthPrincipal {
  if (!userId) {
    throw new ConflictError('Payment intent has no originating user');
  }
  return {
    userId,
    schoolId,
    roleCode: 'SYSTEM',
    permissions: new Set<Permission>(),
    email: 'gateway@system.local',
    fullName: 'Payment Gateway',
    actorType: 'SYSTEM',
  };
}

function verifySignature(
  secret: string,
  schoolId: string,
  payload: unknown,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret)
    .update(`${schoolId}.${stableStringify(payload)}`)
    .digest('hex');
  const actual = signature.replace(/^sha256=/, '').trim();
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function auditCtx(auth: AuthPrincipal, meta: AuditMeta) {
  return {
    schoolId: auth.schoolId,
    userId: auth.userId,
    actorType: auth.actorType,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    impersonationId: auth.impersonationId,
  };
}
