import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError, NotFoundError, todayIso, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { loadEnv } from '../config/env';
import { matchSettlementLines, type SettlementLineSnapshot } from './reconciliation.matcher';
import { fetchSettlementFeed } from './settlement.provider';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const PAYMENT_SETTLEMENT_PROVIDERS = ['mock', 'esewa', 'khalti', 'stripe', 'bank'] as const;
export const RECONCILIATION_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const settledAtInput = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);

export const settlementLineInputSchema = z.object({
  providerRef: z.string().trim().min(1).max(160),
  amountMinor: z.number().int().min(0).max(2_147_483_647),
  feeMinor: z.number().int().min(0).max(2_147_483_647).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('NPR'),
  status: z.string().trim().min(1).max(40).default('SETTLED'),
  settledAt: settledAtInput,
  notes: z.string().trim().max(500).optional(),
});
export type SettlementLineInput = z.infer<typeof settlementLineInputSchema>;

export const importSettlementSchema = z
  .object({
    provider: z.enum(PAYMENT_SETTLEMENT_PROVIDERS),
    periodFrom: isoDate,
    periodTo: isoDate,
    currency: z.string().regex(/^[A-Z]{3}$/).default('NPR'),
    lines: z.array(settlementLineInputSchema).min(1).max(5000),
  })
  .refine((value) => value.periodFrom <= value.periodTo, {
    message: 'periodFrom must be on or before periodTo',
    path: ['periodFrom'],
  });

export const pullSettlementSchema = z
  .object({
    provider: z.enum(PAYMENT_SETTLEMENT_PROVIDERS),
    periodFrom: isoDate.optional(),
    periodTo: isoDate.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).default('NPR'),
  })
  .refine(
    (value) => !value.periodFrom || !value.periodTo || value.periodFrom <= value.periodTo,
    { message: 'periodFrom must be on or before periodTo', path: ['periodFrom'] },
  );

export const reconciliationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  provider: z.enum(PAYMENT_SETTLEMENT_PROVIDERS).optional(),
  status: z.enum(RECONCILIATION_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

@Injectable()
export class ReconciliationService {
  constructor(private readonly audit: AuditService) {}

  /** Imports a settlement feed supplied by the operator (CSV-to-JSON import). */
  async importSettlement(
    auth: AuthPrincipal,
    input: z.infer<typeof importSettlementSchema>,
    meta: AuditMeta,
  ) {
    return this.run(auth, {
      provider: input.provider,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      currency: input.currency,
      source: 'MANUAL',
      lines: input.lines.map(toSnapshot),
    }, meta);
  }

  /** Pulls the settlement feed from the configured upstream and reconciles it. */
  async pullSettlement(
    auth: AuthPrincipal,
    input: z.infer<typeof pullSettlementSchema>,
    meta: AuditMeta,
  ) {
    const env = loadEnv();
    if (!env.PAYMENT_SETTLEMENT_FEED_URL?.trim()) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'PAYMENT_SETTLEMENT_FEED_URL is not configured',
        503,
      );
    }

    const periodTo = input.periodTo ?? todayIso();
    const periodFrom = input.periodFrom ?? addDays(periodTo, -6);
    if (periodFrom > periodTo) {
      throw new AppError('VALIDATION_FAILED', 'periodFrom must be on or before periodTo', 422);
    }

    const lines = await fetchSettlementFeed({
      url: env.PAYMENT_SETTLEMENT_FEED_URL,
      token: env.PAYMENT_SETTLEMENT_FEED_TOKEN,
      provider: input.provider,
      from: periodFrom,
      to: periodTo,
    });

    return this.run(auth, {
      provider: input.provider,
      periodFrom,
      periodTo,
      currency: input.currency,
      source: 'FEED',
      lines,
    }, meta);
  }

  async list(auth: AuthPrincipal, query: z.infer<typeof reconciliationQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.PaymentReconciliationWhereInput = { schoolId: auth.schoolId };
      if (query.provider) where.provider = query.provider;
      if (query.status) where.status = query.status;
      if (query.from || query.to) {
        where.createdAt = {
          ...(query.from ? { gte: dateAtStart(query.from) } : {}),
          ...(query.to ? { lt: addDaysDate(dateAtStart(query.to), 1) } : {}),
        };
      }

      const [items, total] = await Promise.all([
        tx.paymentReconciliation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { _count: { select: { lines: true } } },
        }),
        tx.paymentReconciliation.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async get(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const reconciliation = await tx.paymentReconciliation.findFirst({
        where: { id, schoolId: auth.schoolId },
        include: { lines: { orderBy: { settledAt: 'desc' } } },
      });
      if (!reconciliation) throw new NotFoundError('Reconciliation');
      return reconciliation;
    });
  }

  async exportCsv(auth: AuthPrincipal, id: string) {
    const reconciliation = await this.get(auth, id);
    const headers = [
      'providerRef',
      'amountMinor',
      'feeMinor',
      'currency',
      'providerStatus',
      'settledAt',
      'matchStatus',
      'intentId',
      'paymentId',
      'notes',
    ];
    const rows = reconciliation.lines.map((line) => [
      line.providerRef,
      String(line.amountMinor),
      String(line.feeMinor),
      line.currency,
      line.providerStatus,
      line.settledAt.toISOString(),
      line.matchStatus,
      line.intentId ?? '',
      line.paymentId ?? '',
      line.notes ?? '',
    ]);
    return {
      fileName: `reconciliation-${reconciliation.provider}-${reconciliation.periodFrom
        .toISOString()
        .slice(0, 10)}.csv`,
      csv: csv(headers, rows),
    };
  }

  private async run(
    auth: AuthPrincipal,
    input: {
      provider: string;
      periodFrom: string;
      periodTo: string;
      currency: string;
      source: 'MANUAL' | 'FEED';
      lines: SettlementLineSnapshot[];
    },
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const created = await tx.paymentReconciliation.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          provider: input.provider,
          periodFrom: dateAtStart(input.periodFrom),
          periodTo: dateAtStart(input.periodTo),
          source: input.source,
          currency: input.currency,
          status: 'PENDING',
          createdByUserId: auth.userId,
        },
        select: { id: true },
      });

      try {
        const refs = [...new Set(input.lines.map((line) => line.providerRef))];
        const intents = refs.length
          ? await tx.paymentIntent.findMany({
              where: {
                schoolId: auth.schoolId,
                provider: input.provider,
                providerRef: { in: refs },
              },
              select: {
                id: true,
                providerRef: true,
                amountMinor: true,
                status: true,
                paymentId: true,
                invoiceId: true,
              },
            })
          : [];

        const periodStart = dateAtStart(input.periodFrom);
        const periodEnd = addDaysDate(dateAtStart(input.periodTo), 1);
        const succeededIntents = await tx.paymentIntent.findMany({
          where: {
            schoolId: auth.schoolId,
            provider: input.provider,
            status: 'SUCCEEDED',
            updatedAt: { gte: periodStart, lt: periodEnd },
          },
          select: {
            id: true,
            providerRef: true,
            amountMinor: true,
            status: true,
            paymentId: true,
            invoiceId: true,
          },
        });

        const result = matchSettlementLines({
          lines: input.lines,
          intents,
          succeededIntents,
          currency: input.currency,
        });

        if (result.lines.length > 0) {
          await tx.paymentSettlementLine.createMany({
            data: result.lines.map((line) => ({
              id: uuidv7(),
              schoolId: auth.schoolId,
              reconciliationId: created.id,
              provider: input.provider,
              providerRef: line.providerRef,
              amountMinor: line.amountMinor,
              feeMinor: line.feeMinor,
              currency: line.currency,
              providerStatus: line.status,
              settledAt: line.settledAt,
              matchStatus: line.matchStatus,
              intentId: line.intentId,
              paymentId: line.paymentId,
              notes: line.notes,
            })),
          });
        }

        const completed = await tx.paymentReconciliation.update({
          where: { id: created.id },
          data: {
            status: 'COMPLETED',
            linesTotal: result.lines.length,
            matchedCount: result.matchedCount,
            mismatchCount: result.mismatchCount,
            unsettledCount: result.unsettledCount,
            amountMinor: result.amountMinor,
            feeMinor: result.feeMinor,
            details: {
              source: input.source,
              currency: input.currency,
              unsettled: result.unsettled,
            } as never,
            completedAt: new Date(),
          },
          include: { lines: { orderBy: { settledAt: 'desc' } } },
        });

        await this.audit.record(tx, auditCtx(auth, meta), {
          action: 'payment_reconciliation.completed',
          entity: 'PaymentReconciliation',
          entityId: completed.id,
          after: {
            provider: completed.provider,
            source: completed.source,
            linesTotal: completed.linesTotal,
            matchedCount: completed.matchedCount,
            mismatchCount: completed.mismatchCount,
            unsettledCount: completed.unsettledCount,
            amountMinor: completed.amountMinor,
          },
        });
        return completed;
      } catch (error) {
        await tx.paymentReconciliation.update({
          where: { id: created.id },
          data: { status: 'FAILED', completedAt: new Date() },
        });
        throw error;
      }
    });
  }
}

function toSnapshot(line: SettlementLineInput): SettlementLineSnapshot {
  return {
    providerRef: line.providerRef,
    amountMinor: line.amountMinor,
    feeMinor: line.feeMinor,
    currency: line.currency,
    status: line.status,
    settledAt: parseSettledAt(line.settledAt),
    notes: line.notes ?? null,
  };
}

function parseSettledAt(value: string): Date {
  const iso = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_FAILED', `Invalid settlement date: ${value}`, 422);
  }
  return date;
}

function dateAtStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDaysDate(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addDays(value: string, days: number): string {
  return addDaysDate(dateAtStart(value), days).toISOString().slice(0, 10);
}

function csv(headers: string[], rows: string[][]): string {
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join(
    '\r\n',
  );
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
