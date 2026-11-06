import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ConflictError,
  JOB_STATUSES,
  JOB_TYPES,
  NotFoundError,
  isTerminalJobStatus,
  jobPercent,
  uuidv7,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { refreshAttendanceRollup, refreshFeeRollup } from '../reports/rollups';
import { JobDispatcher } from './job-dispatcher';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const jobQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(JOB_STATUSES).optional(),
  type: z.enum(JOB_TYPES).optional(),
});

export const createJobSchema = z.object({
  type: z.enum(JOB_TYPES),
  payload: z.record(z.unknown()).default({}),
});

@Injectable()
export class JobsService {
  constructor(
    private readonly audit: AuditService,
    private readonly dispatcher: JobDispatcher,
  ) {}

  async list(auth: AuthPrincipal, query: z.infer<typeof jobQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.BackgroundJobWhereInput = {
        schoolId: auth.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      };
      const [items, total] = await Promise.all([
        tx.backgroundJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.backgroundJob.count({ where }),
      ]);
      return {
        items: items.map(jobDto),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async get(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const job = await tx.backgroundJob.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!job) throw new NotFoundError('Job');
      return jobDto(job);
    });
  }

  async create(auth: AuthPrincipal, input: z.infer<typeof createJobSchema>, meta: AuditMeta) {
    if (input.type === 'TENANT_DELETION') {
      throw new ConflictError('Tenant deletion is only available from the platform console');
    }
    const job = await withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const created = await tx.backgroundJob.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          type: input.type,
          status: 'QUEUED',
          payload: input.payload as never,
          requestedByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'job.queued',
        entity: 'BackgroundJob',
        entityId: created.id,
        after: { type: created.type },
      });
      return jobDto(created);
    });

    const dispatch = await this.dispatcher.dispatch({
      jobId: job.id,
      schoolId: auth.schoolId,
      type: job.type,
      payload: job.payload,
    });
    return { ...job, dispatch };
  }

  async run(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const job = await tx.backgroundJob.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!job) throw new NotFoundError('Job');
      if (isTerminalJobStatus(job.status as never)) {
        throw new ConflictError('This job has already finished');
      }
      await tx.backgroundJob.update({
        where: { id },
        data: { status: 'RUNNING', startedAt: new Date(), error: null },
      });
      try {
        const result = await executeJob(tx, auth.schoolId, job.type, job.payload);
        const finished = await tx.backgroundJob.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            progress: result.total,
            total: result.total,
            result: result as never,
            completedAt: new Date(),
          },
        });
        await this.audit.record(tx, auditCtx(auth, meta), {
          action: 'job.completed',
          entity: 'BackgroundJob',
          entityId: id,
          after: { type: job.type, total: result.total },
        });
        return jobDto(finished);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Job failed';
        const failed = await tx.backgroundJob.update({
          where: { id },
          data: { status: 'FAILED', error: message.slice(0, 1000), completedAt: new Date() },
        });
        await this.audit.record(tx, auditCtx(auth, meta), {
          action: 'job.failed',
          entity: 'BackgroundJob',
          entityId: id,
          after: { type: job.type, error: message },
        });
        return jobDto(failed);
      }
    });
  }

  async cancel(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const job = await tx.backgroundJob.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!job) throw new NotFoundError('Job');
      if (isTerminalJobStatus(job.status as never)) {
        throw new ConflictError('This job has already finished');
      }
      const cancelled = await tx.backgroundJob.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'job.cancelled',
        entity: 'BackgroundJob',
        entityId: id,
        before: { status: job.status },
      });
      return jobDto(cancelled);
    });
  }
}

async function executeJob(
  tx: TxClient,
  schoolId: string,
  type: string,
  payload: unknown,
): Promise<{ total: number; summary: string; details?: unknown }> {
  const data = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'REPORT_CARDS': {
      const examId = typeof data.examId === 'string' ? data.examId : null;
      const count = await tx.examResult.count({
        where: { schoolId, ...(examId ? { examId } : {}) },
      });
      return { total: count, summary: `${count} exam result row(s) ready for report cards` };
    }
    case 'FEE_REMINDERS': {
      const invoices = await tx.invoice.findMany({
        where: {
          schoolId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
        },
        select: { id: true, studentId: true, totalMinor: true, paidMinor: true },
        take: 5000,
      });
      return {
        total: invoices.length,
        summary: `${invoices.length} overdue invoice(s) queued for reminders`,
        details: {
          outstandingMinor: invoices.reduce(
            (sum, invoice) => sum + invoice.totalMinor - invoice.paidMinor,
            0,
          ),
        },
      };
    }
    case 'ATTENDANCE_DIGEST': {
      const date = typeof data.date === 'string' ? data.date : new Date().toISOString().slice(0, 10);
      const rows = await tx.attendanceRecord.groupBy({
        by: ['status'],
        where: { schoolId, date: new Date(`${date}T00:00:00.000Z`) },
        _count: { _all: true },
      });
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      return {
        total,
        summary: `${total} attendance record(s) summarised for ${date}`,
        details: rows.map((row) => ({ status: row.status, count: row._count._all })),
      };
    }
    case 'DATA_EXPORT': {
      const [students, invoices, payments] = await Promise.all([
        tx.student.count({ where: { schoolId, deletedAt: null } }),
        tx.invoice.count({ where: { schoolId } }),
        tx.payment.count({ where: { schoolId } }),
      ]);
      return {
        total: students + invoices + payments,
        summary: `Export bundle prepared: ${students} students, ${invoices} invoices, ${payments} payments`,
      };
    }
    case 'USAGE_ROLLUP': {
      const period =
        typeof data.period === 'string' ? data.period : new Date().toISOString().slice(0, 7);
      const [students, staff, invoices] = await Promise.all([
        tx.student.count({ where: { schoolId, deletedAt: null } }),
        tx.staff.count({ where: { schoolId, deletedAt: null } }),
        tx.invoice.count({ where: { schoolId } }),
      ]);
      const metrics = [
        { metric: 'students', value: students },
        { metric: 'staff', value: staff },
        { metric: 'invoices', value: invoices },
      ];
      for (const metric of metrics) {
        await tx.meterUsage.upsert({
          where: {
            schoolId_metric_period: { schoolId, metric: metric.metric, period },
          },
          create: {
            id: uuidv7(),
            schoolId,
            metric: metric.metric,
            value: metric.value,
            period,
          },
          update: { value: metric.value },
        });
      }
      return { total: metrics.reduce((sum, metric) => sum + metric.value, 0), summary: `Usage rolled up for ${period}` };
    }
    case 'REPORT_ROLLUP': {
      const to = typeof data.to === 'string' ? data.to : new Date().toISOString().slice(0, 10);
      const from =
        typeof data.from === 'string'
          ? data.from
          : new Date(new Date(`${to}T00:00:00.000Z`).getTime() - 29 * 86_400_000)
              .toISOString()
              .slice(0, 10);
      const attendance = await refreshAttendanceRollup(tx, schoolId, { from, to });
      const fees = await refreshFeeRollup(tx, schoolId, { from, to });
      return {
        total: attendance.records + fees.payments,
        summary: `Rollups refreshed for ${from}..${to}: ${attendance.records} attendance, ${fees.payments} payments`,
        details: { from, to, attendance, fees },
      };
    }
    case 'WAREHOUSE_EXPORT': {
      const category =
        typeof data.category === 'string' && data.category.trim().length > 0
          ? data.category.trim()
          : null;
      const items = await tx.inventoryItem.findMany({
        where: { schoolId, ...(category ? { category } : {}) },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });
      const itemById = new Map(items.map((item) => [item.id, item]));
      const transactions = await tx.inventoryTransaction.findMany({
        where: {
          schoolId,
          ...(category ? { itemId: { in: items.map((item) => item.id) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50_000,
      });

      const generatedOn = new Date().toISOString().slice(0, 10);
      const suffix = category ? `-${category.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
      const itemsCsv = toCsv(
        ['sku', 'name', 'category', 'quantity', 'reorderLevel', 'unitPriceMinor', 'location', 'updatedAt'],
        items.map((item) => [
          item.sku,
          item.name,
          item.category,
          String(item.quantity),
          String(item.reorderLevel),
          String(item.unitPriceMinor),
          item.location ?? '',
          item.updatedAt.toISOString(),
        ]),
      );
      const transactionsCsv = toCsv(
        ['createdAt', 'sku', 'item', 'category', 'type', 'quantity', 'reference', 'notes'],
        transactions.map((transaction) => {
          const item = itemById.get(transaction.itemId);
          return [
            transaction.createdAt.toISOString(),
            item?.sku ?? '',
            item?.name ?? '',
            item?.category ?? '',
            transaction.type,
            String(transaction.quantity),
            transaction.reference ?? '',
            transaction.notes ?? '',
          ];
        }),
      );

      const documents = await Promise.all([
        tx.generatedDocument.create({
          data: {
            id: uuidv7(),
            schoolId,
            templateCode: 'WAREHOUSE_EXPORT',
            entityType: 'INVENTORY',
            entityId: schoolId,
            fileName: `warehouse-stock-${generatedOn}${suffix}.csv`,
            mimeType: 'text/csv',
            sizeBytes: Buffer.byteLength(itemsCsv, 'utf8'),
            content: Buffer.from(itemsCsv, 'utf8'),
          },
        }),
        tx.generatedDocument.create({
          data: {
            id: uuidv7(),
            schoolId,
            templateCode: 'WAREHOUSE_EXPORT',
            entityType: 'INVENTORY',
            entityId: schoolId,
            fileName: `warehouse-transactions-${generatedOn}${suffix}.csv`,
            mimeType: 'text/csv',
            sizeBytes: Buffer.byteLength(transactionsCsv, 'utf8'),
            content: Buffer.from(transactionsCsv, 'utf8'),
          },
        }),
      ]);

      return {
        total: items.length + transactions.length,
        summary: `Warehouse export ready: ${items.length} item(s), ${transactions.length} transaction(s)`,
        details: {
          documents: documents.map((document) => ({
            id: document.id,
            fileName: document.fileName,
            sizeBytes: document.sizeBytes,
            downloadPath: `/documents/generated/${document.id}/download`,
          })),
        },
      };
    }
    default:
      return { total: 0, summary: `No handler registered for ${type}` };
  }
}

function toCsv(headers: string[], rows: string[][]): string {
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join(
    '\r\n',
  );
}

function jobDto(job: {
  id: string;
  type: string;
  status: string;
  progress: number;
  total: number;
  payload: unknown;
  result: unknown;
  error: string | null;
  requestedByUserId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...job,
    percent: jobPercent(job.progress, job.total),
  };
}

export function auditCtx(auth: AuthPrincipal, meta: AuditMeta) {
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
