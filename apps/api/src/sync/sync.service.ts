import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { NotFoundError, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { assembleCachePayload } from './cache.mapper';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const attendancePayloadSchema = z.object({
  classId: z.string().uuid(),
  sectionId: z.string().uuid(),
  date: isoDate,
  period: z.number().int().min(0).max(20).default(0),
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE']),
        remark: z.string().trim().max(300).optional(),
        clientUpdatedAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const syncBatchSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  operation: z.enum(['ATTENDANCE_MARK']),
  idempotencyKey: z.string().trim().min(8).max(128),
  payload: attendancePayloadSchema,
});

export const syncQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  deviceId: z.string().trim().max(120).optional(),
});

export const pullQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});

export const resolveConflictSchema = z.object({
  resolution: z.enum(['SERVER_WINS', 'CLIENT_WINS', 'DISMISSED']),
});
export type ResolveConflictInput = z.infer<typeof resolveConflictSchema>;

@Injectable()
export class SyncService {
  constructor(private readonly audit: AuditService) {}

  async push(auth: AuthPrincipal, input: z.infer<typeof syncBatchSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.syncBatch.findUnique({
        where: {
          schoolId_idempotencyKey: {
            schoolId: auth.schoolId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        return { batch: existing, replayed: true };
      }

      const section = await tx.section.findFirst({
        where: {
          id: input.payload.sectionId,
          schoolId: auth.schoolId,
          classId: input.payload.classId,
        },
        select: { id: true },
      });
      if (!section) {
        throw new NotFoundError('Class section');
      }

      const date = new Date(`${input.payload.date}T00:00:00.000Z`);
      const session = await tx.attendanceSession.upsert({
        where: {
          schoolId_classId_sectionId_date_period: {
            schoolId: auth.schoolId,
            classId: input.payload.classId,
            sectionId: input.payload.sectionId,
            date,
            period: input.payload.period,
          },
        },
        create: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          classId: input.payload.classId,
          sectionId: input.payload.sectionId,
          date,
          period: input.payload.period,
          markedByUserId: auth.userId,
          idempotencyKey: input.idempotencyKey,
        },
        update: {
          markedByUserId: auth.userId,
          submittedAt: new Date(),
        },
      });

      let applied = 0;
      let conflicts = 0;
      for (const record of input.payload.records) {
        const current = await tx.attendanceRecord.findUnique({
          where: {
            sessionId_studentId: { sessionId: session.id, studentId: record.studentId },
          },
        });
        if (!current) {
          await tx.attendanceRecord.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              sessionId: session.id,
              studentId: record.studentId,
              date,
              status: record.status,
              remark: record.remark ?? null,
            },
          });
          applied += 1;
          continue;
        }
        if (current.status === record.status && (current.remark ?? null) === (record.remark ?? null)) {
          continue;
        }
        conflicts += 1;
        await tx.outboxConflict.create({
          data: {
            id: uuidv7(),
            schoolId: auth.schoolId,
            deviceId: deviceUuid(input.deviceId),
            entity: 'ATTENDANCE',
            entityId: `${session.id}:${record.studentId}`,
            resolution: 'PENDING',
            payload: {
              sessionId: session.id,
              studentId: record.studentId,
              serverStatus: current.status,
              serverRemark: current.remark,
              clientStatus: record.status,
              clientRemark: record.remark ?? null,
            } as never,
            serverUpdatedAt: current.createdAt,
            clientTimestamp: record.clientUpdatedAt ? new Date(record.clientUpdatedAt) : null,
            userId: auth.userId,
          },
        });
        await tx.attendanceRecord.update({
          where: { id: current.id },
          data: { status: record.status, remark: record.remark ?? null },
        });
        applied += 1;
      }

      const batch = await tx.syncBatch.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          deviceId: input.deviceId,
          userId: auth.userId,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey,
          status: 'APPLIED',
          applied,
          skipped: input.payload.records.length - applied,
          conflicts,
          details: {
            sessionId: session.id,
            date: input.payload.date,
            classId: input.payload.classId,
            sectionId: input.payload.sectionId,
            period: input.payload.period,
          },
        },
      });

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'sync.batch_applied',
        entity: 'SyncBatch',
        entityId: batch.id,
        after: { deviceId: input.deviceId, applied, conflicts },
      });

      return { batch, replayed: false };
    });
  }

  async list(auth: AuthPrincipal, query: z.infer<typeof syncQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where = {
        schoolId: auth.schoolId,
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      };
      const [items, total] = await Promise.all([
        tx.syncBatch.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.syncBatch.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  /**
   * Feeds the desktop SQLite cache. Reference data is always a full snapshot
   * (the underlying tables have no `updatedAt`); students and invoices are
   * deltas keyed by `updatedAt`. `nextSince` is captured before the queries so
   * a row written during the pull is not silently skipped by the next cursor.
   *
   * The delta queries are intentionally unbounded: capping them while advancing
   * the cursor would drop rows beyond the cap permanently. The first pull is a
   * full snapshot; later pulls only carry rows changed since the cursor.
   */
  async pull(auth: AuthPrincipal, query: z.infer<typeof pullQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const since = query.since ? new Date(query.since) : new Date(0);
      const nextSince = new Date();
      const [classes, sections, students, feeHeads, feeStructures, invoices] = await Promise.all([
        tx.class.findMany({
          where: { schoolId: auth.schoolId },
          select: { id: true, name: true, sequence: true },
          orderBy: [{ sequence: 'asc' }, { name: 'asc' }],
        }),
        tx.section.findMany({
          where: { schoolId: auth.schoolId },
          select: { id: true, classId: true, name: true, capacity: true, room: true },
          orderBy: [{ classId: 'asc' }, { name: 'asc' }],
        }),
        tx.student.findMany({
          where: {
            schoolId: auth.schoolId,
            updatedAt: { gte: since },
            // The cache mirrors live records; archived rows are sent once with
            // `deletedAt` so the desktop can evict them.
          },
          select: {
            id: true,
            admissionNo: true,
            firstName: true,
            lastName: true,
            classId: true,
            sectionId: true,
            rollNo: true,
            status: true,
            updatedAt: true,
            deletedAt: true,
            version: true,
          },
          orderBy: { updatedAt: 'asc' },
        }),
        tx.feeHead.findMany({
          where: { schoolId: auth.schoolId },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            isRecurring: true,
            isActive: true,
          },
          orderBy: { name: 'asc' },
        }),
        tx.feeStructure.findMany({
          where: { schoolId: auth.schoolId },
          select: {
            id: true,
            academicYearId: true,
            classId: true,
            feeHeadId: true,
            amountMinor: true,
            installments: true,
            dueDay: true,
          },
          orderBy: [{ classId: 'asc' }, { feeHeadId: 'asc' }],
        }),
        tx.invoice.findMany({
          where: { schoolId: auth.schoolId, updatedAt: { gte: since } },
          select: {
            id: true,
            studentId: true,
            number: true,
            issueDate: true,
            dueDate: true,
            currency: true,
            subtotalMinor: true,
            discountMinor: true,
            fineMinor: true,
            totalMinor: true,
            paidMinor: true,
            status: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'asc' },
        }),
      ]);

      return assembleCachePayload({
        since,
        nextSince,
        serverTime: new Date(),
        classes,
        sections,
        students,
        feeHeads,
        feeStructures,
        invoices,
      });
    });
  }

  async conflicts(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [items, total, pending, batches] = await Promise.all([
        tx.outboxConflict.findMany({
          where: { schoolId: auth.schoolId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        tx.outboxConflict.count({ where: { schoolId: auth.schoolId } }),
        tx.outboxConflict.count({
          where: { schoolId: auth.schoolId, resolution: 'PENDING' },
        }),
        tx.syncBatch.findMany({
          where: { schoolId: auth.schoolId, conflicts: { gt: 0 } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);
      return { items, total, pending, batches };
    });
  }

  /**
   * Applies a reviewer's decision to an offline conflict. Attendance is the
   * only entity that currently produces conflicts, so the payload carries both
   * the server and client values needed to re-apply either side.
   */
  async resolveConflict(
    auth: AuthPrincipal,
    id: string,
    input: ResolveConflictInput,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const conflict = await tx.outboxConflict.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!conflict) throw new NotFoundError('Sync conflict');

      if (conflict.entity === 'ATTENDANCE' && input.resolution !== 'DISMISSED') {
        const payload = (conflict.payload ?? {}) as {
          sessionId?: string;
          studentId?: string;
          serverStatus?: string;
          serverRemark?: string | null;
          clientStatus?: string;
          clientRemark?: string | null;
        };
        if (payload.sessionId && payload.studentId) {
          const record = await tx.attendanceRecord.findUnique({
            where: {
              sessionId_studentId: {
                sessionId: payload.sessionId,
                studentId: payload.studentId,
              },
            },
          });
          if (record) {
            const winning =
              input.resolution === 'SERVER_WINS'
                ? { status: payload.serverStatus, remark: payload.serverRemark ?? null }
                : { status: payload.clientStatus, remark: payload.clientRemark ?? null };
            if (winning.status) {
              await tx.attendanceRecord.update({
                where: { id: record.id },
                data: {
                  status: winning.status as never,
                  remark: winning.remark,
                },
              });
            }
          }
        }
      }

      const updated = await tx.outboxConflict.update({
        where: { id },
        data: { resolution: input.resolution },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'sync.conflict_resolved',
        entity: 'OutboxConflict',
        entityId: id,
        before: { resolution: conflict.resolution },
        after: { resolution: input.resolution, entity: conflict.entity },
      });
      return updated;
    });
  }
}

/** Stable UUID-shaped key for the varchar device identifier. */
function deviceUuid(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(
    17,
    20,
  )}-${hash.slice(20, 32)}`;
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
