import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AppError,
  NotFoundError,
  attendanceIdempotencyKey,
  findLowAttendance,
  summarizeAttendance,
  todayIso,
  uuidv7,
  validateBulkAttendance,
  type AttendancePolicy,
  type BulkAttendanceInputSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AttendanceAuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const attendancePolicyUpdateSchema = z.object({
  lateCountsPresent: z.boolean().optional(),
  halfDayWeight: z.number().min(0).max(1).optional(),
  excludeLeaveFromDenominator: z.boolean().optional(),
  lowAttendanceThreshold: z.number().min(0).max(100).optional(),
});
export type AttendancePolicyUpdate = z.infer<typeof attendancePolicyUpdateSchema>;

@Injectable()
export class AttendanceService {
  constructor(private readonly audit: AuditService) {}

  async policy(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, (tx) => loadPolicy(tx, auth.schoolId));
  }

  async updatePolicy(
    auth: AuthPrincipal,
    input: AttendancePolicyUpdate,
    meta: AttendanceAuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await loadPolicy(tx, auth.schoolId);
      const next: AttendancePolicy = {
        lateCountsPresent: input.lateCountsPresent ?? current.lateCountsPresent,
        halfDayWeight: input.halfDayWeight ?? current.halfDayWeight,
        excludeLeaveFromDenominator:
          input.excludeLeaveFromDenominator ?? current.excludeLeaveFromDenominator,
        lowAttendanceThreshold:
          input.lowAttendanceThreshold ?? current.lowAttendanceThreshold,
      };
      await tx.schoolSetting.upsert({
        where: { schoolId: auth.schoolId },
        update: { attendance: next as never },
        create: { schoolId: auth.schoolId, attendance: next as never },
      });
      await this.audit.record(
        tx,
        {
          schoolId: auth.schoolId,
          userId: auth.userId,
          actorType: auth.actorType,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          impersonationId: auth.impersonationId,
        },
        {
          action: 'attendance.policy_updated',
          entity: 'SchoolSetting',
          entityId: auth.schoolId,
          before: current,
          after: next,
        },
      );
      return next;
    });
  }

  async bulk(auth: AuthPrincipal, input: BulkAttendanceInputSchema, meta: AttendanceAuditMeta) {
    const validation = validateBulkAttendance(
      {
        date: input.date,
        classId: input.classId,
        sectionId: input.sectionId,
        period: input.period,
        records: input.records,
      },
      { today: todayIso(), maxRecords: 200 },
    );
    if (!validation.ok) {
      throw new AppError('VALIDATION_FAILED', 'Attendance could not be saved', 422, validation.errors);
    }

    const date = new Date(`${input.date}T00:00:00.000Z`);
    const idempotencyKey = input.idempotencyKey ?? attendanceIdempotencyKey({
      date: input.date,
      classId: input.classId,
      sectionId: input.sectionId,
      period: input.period,
      records: validation.records,
    });

    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const section = await tx.section.findFirst({
        where: { id: input.sectionId, schoolId: auth.schoolId, classId: input.classId },
        select: { id: true, name: true, class: { select: { name: true } } },
      });
      if (!section) throw new NotFoundError('Class or section');

      const students = await tx.student.findMany({
        where: {
          schoolId: auth.schoolId,
          deletedAt: null,
          id: { in: validation.records.map((record) => record.studentId) },
          classId: input.classId,
          sectionId: input.sectionId,
        },
        select: { id: true },
      });
      const roster = new Set(students.map((student) => student.id));
      const unknown = validation.records.filter((record) => !roster.has(record.studentId));
      if (unknown.length > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Some students are not in the selected class and section',
          422,
          { studentIds: unknown.map((record) => record.studentId) },
        );
      }

      const existingSession = await tx.attendanceSession.findUnique({
        where: {
          schoolId_classId_sectionId_date_period: {
            schoolId: auth.schoolId,
            classId: input.classId,
            sectionId: input.sectionId,
            date,
            period: input.period,
          },
        },
        select: { id: true, idempotencyKey: true },
      });

      const session = existingSession
        ? await tx.attendanceSession.update({
            where: { id: existingSession.id },
            data: {
              markedByUserId: auth.userId,
              idempotencyKey,
              submittedAt: new Date(),
            },
          })
        : await tx.attendanceSession.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              classId: input.classId,
              sectionId: input.sectionId,
              date,
              period: input.period,
              markedByUserId: auth.userId,
              idempotencyKey,
            },
          });

      await tx.attendanceRecord.deleteMany({
        where: { sessionId: session.id, schoolId: auth.schoolId },
      });
      await tx.attendanceRecord.createMany({
        data: validation.records.map((record) => ({
          id: uuidv7(),
          schoolId: auth.schoolId,
          sessionId: session.id,
          studentId: record.studentId,
          date,
          status: record.status,
          remark: record.remark ?? null,
        })),
      });

      const summary = summarizeAttendance(validation.records, await loadPolicy(tx, auth.schoolId));
      await this.audit.record(
        tx,
        {
          schoolId: auth.schoolId,
          userId: auth.userId,
          actorType: auth.actorType,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          impersonationId: auth.impersonationId,
        },
        {
          action: existingSession ? 'attendance.updated' : 'attendance.marked',
          entity: 'AttendanceSession',
          entityId: session.id,
          after: {
            className: section.class.name,
            section: section.name,
            date: input.date,
            period: input.period,
            summary,
          },
        },
      );

      return {
        sessionId: session.id,
        date: input.date,
        period: input.period,
        classId: input.classId,
        sectionId: input.sectionId,
        idempotencyKey,
        replaced: Boolean(existingSession),
        summary,
        records: validation.records,
      };
    });
  }

  async session(
    auth: AuthPrincipal,
    query: { date: string; classId: string; sectionId: string; period: number },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const session = await tx.attendanceSession.findUnique({
        where: {
          schoolId_classId_sectionId_date_period: {
            schoolId: auth.schoolId,
            classId: query.classId,
            sectionId: query.sectionId,
            date: new Date(`${query.date}T00:00:00.000Z`),
            period: query.period,
          },
        },
        include: {
          records: {
            include: {
              student: {
                select: {
                  id: true,
                  admissionNo: true,
                  firstName: true,
                  lastName: true,
                  rollNo: true,
                },
              },
            },
            orderBy: { student: { rollNo: 'asc' } },
          },
        },
      });
      if (!session) return { session: null, records: [] };
      return {
        session: {
          id: session.id,
          date: session.date.toISOString().slice(0, 10),
          period: session.period,
          submittedAt: session.submittedAt,
        },
        records: session.records.map((record) => ({
          studentId: record.studentId,
          student: {
            id: record.student.id,
            admissionNo: record.student.admissionNo,
            name: `${record.student.firstName} ${record.student.lastName}`.trim(),
            rollNo: record.student.rollNo,
          },
          status: record.status,
          remark: record.remark,
        })),
      };
    });
  }

  async summary(
    auth: AuthPrincipal,
    query: {
      classId?: string;
      sectionId?: string;
      from: string;
      to: string;
      threshold?: number;
    },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const policy = await loadPolicy(tx, auth.schoolId);
      const where: Prisma.AttendanceRecordWhereInput = {
        schoolId: auth.schoolId,
        date: {
          gte: new Date(`${query.from}T00:00:00.000Z`),
          lte: new Date(`${query.to}T00:00:00.000Z`),
        },
        ...(query.sectionId ? { student: { sectionId: query.sectionId } } : {}),
        ...(query.classId && !query.sectionId
          ? { student: { classId: query.classId } }
          : {}),
      };

      const [grouped, students] = await Promise.all([
        tx.attendanceRecord.groupBy({
          by: ['studentId', 'status'],
          where,
          _count: { _all: true },
        }),
        tx.student.findMany({
          where: {
            schoolId: auth.schoolId,
            deletedAt: null,
            ...(query.classId ? { classId: query.classId } : {}),
            ...(query.sectionId ? { sectionId: query.sectionId } : {}),
          },
          select: {
            id: true,
            admissionNo: true,
            firstName: true,
            lastName: true,
            rollNo: true,
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        }),
      ]);

      const byStudent = new Map<string, { status: Prisma.AttendanceRecordGroupByOutputType['status']; count: number }[]>();
      for (const row of grouped) {
        const list = byStudent.get(row.studentId) ?? [];
        list.push({ status: row.status, count: row._count._all });
        byStudent.set(row.studentId, list);
      }

      const summaries = students.map((student) => {
        const counts = byStudent.get(student.id) ?? [];
        const records = counts.flatMap((entry) =>
          Array.from({ length: entry.count }, () => ({ status: entry.status })),
        );
        return {
          studentId: student.id,
          admissionNo: student.admissionNo,
          name: `${student.firstName} ${student.lastName}`.trim(),
          rollNo: student.rollNo,
          className: student.class.name,
          sectionName: student.section.name,
          summary: summarizeAttendance(records, policy),
        };
      });

      const allRecords = [...byStudent.values()].flatMap((entries) =>
        entries.flatMap((entry) => Array.from({ length: entry.count }, () => ({ status: entry.status }))),
      );
      return {
        from: query.from,
        to: query.to,
        policy,
        overall: summarizeAttendance(allRecords, policy),
        students: summaries.sort((a, b) => a.summary.attendancePercent - b.summary.attendancePercent),
        lowAttendance: findLowAttendance(
          summaries.map((row) => ({ studentId: row.studentId, summary: row.summary })),
          query.threshold ?? policy.lowAttendanceThreshold,
        ),
      };
    });
  }

  async list(
    auth: AuthPrincipal,
    query: {
      classId?: string;
      sectionId?: string;
      studentId?: string;
      date?: string;
      period?: number;
      from?: string;
      to?: string;
    },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const dateFilter = query.date
        ? new Date(`${query.date}T00:00:00.000Z`)
        : query.from || query.to
          ? {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            }
          : undefined;
      const records = await tx.attendanceRecord.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(dateFilter ? { date: dateFilter } : {}),
          ...(query.studentId ? { studentId: query.studentId } : {}),
          ...(query.period !== undefined ? { session: { period: query.period } } : {}),
          ...(query.classId || query.sectionId
            ? {
                session: {
                  ...(query.period !== undefined ? { period: query.period } : {}),
                  ...(query.classId ? { classId: query.classId } : {}),
                  ...(query.sectionId ? { sectionId: query.sectionId } : {}),
                },
              }
            : {}),
        },
        include: {
          student: { select: { firstName: true, lastName: true, admissionNo: true } },
          session: { select: { period: true, classId: true, sectionId: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
        take: 2_000,
      });
      return records.map((record) => ({
        id: record.id,
        date: record.date.toISOString().slice(0, 10),
        period: record.session.period,
        studentId: record.studentId,
        studentName: `${record.student.firstName} ${record.student.lastName}`.trim(),
        admissionNo: record.student.admissionNo,
        status: record.status,
        remark: record.remark,
        classId: record.session.classId,
        sectionId: record.session.sectionId,
      }));
    });
  }
}

async function loadPolicy(tx: TxClient, schoolId: string): Promise<AttendancePolicy> {
  const settings = await tx.schoolSetting.findUnique({
    where: { schoolId },
    select: { attendance: true },
  });
  const stored = (settings?.attendance ?? {}) as Partial<AttendancePolicy>;
  return {
    lateCountsPresent: stored.lateCountsPresent ?? true,
    halfDayWeight: stored.halfDayWeight ?? 0.5,
    excludeLeaveFromDenominator: stored.excludeLeaveFromDenominator ?? true,
    lowAttendanceThreshold: stored.lowAttendanceThreshold ?? 75,
  };
}
