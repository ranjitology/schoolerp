import { Injectable } from '@nestjs/common';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  createAcademicYearSchema,
  createClassSchema,
  createSubjectSchema,
  detectTimetableConflicts,
  gradeFor,
  roundPercent,
  uuidv7,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { loadPolicyBands } from './grading.util';

type CreateYear = z.infer<typeof createAcademicYearSchema>;
type CreateClass = z.infer<typeof createClassSchema>;
type CreateSubject = z.infer<typeof createSubjectSchema>;

export const createExamSchema = z.object({
  academicYearId: z.string().uuid(),
  termId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  type: z.enum(['UNIT_TEST', 'MID_TERM', 'FINAL', 'PRACTICAL', 'PROJECT', 'INTERNAL']).default('MID_TERM'),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  subjects: z
    .array(
      z.object({
        classId: z.string().uuid(),
        subjectId: z.string().uuid(),
        maxMarks: z.number().int().min(1).max(1000).default(100),
        passMarks: z.number().int().min(0).max(1000).default(33),
        examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type CreateExam = z.infer<typeof createExamSchema>;

export const enterMarksSchema = z.object({
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        marksObtained: z.number().min(0).max(1000).default(0),
        isAbsent: z.boolean().default(false),
        version: z.number().int().min(1).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type EnterMarks = z.infer<typeof enterMarksSchema>;

export const classQuerySchema = z.object({ classId: z.string().uuid().optional() });

export const createTimetableSlotSchema = z.object({
  academicYearId: z.string().uuid().optional(),
  dayOfWeek: z.number().int().min(1).max(7),
  periodId: z.string().uuid(),
  classId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  staffId: z.string().uuid().optional(),
  room: z.string().trim().max(40).optional(),
});
export type CreateTimetableSlot = z.infer<typeof createTimetableSlotSchema>;

export const timetableCheckSchema = z.object({
  academicYearId: z.string().uuid().optional(),
  slots: z
    .array(
      createTimetableSlotSchema.extend({
        id: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const substitutionStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const createSubstitutionSchema = z.object({
  slotId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  substituteStaffId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export type CreateSubstitution = z.infer<typeof createSubstitutionSchema>;

export const substitutionQuerySchema = z.object({
  status: substitutionStatusSchema.optional(),
  slotId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const reviewSubstitutionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});
export type ReviewSubstitution = z.infer<typeof reviewSubstitutionSchema>;

export const moderateMarksSchema = z.object({
  classId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  adjustments: z
    .array(
      z.object({
        examSubjectId: z.string().uuid(),
        studentId: z.string().uuid(),
        marksObtained: z.number().min(0).max(1000),
      }),
    )
    .min(1)
    .max(1000),
});
export type ModerateMarks = z.infer<typeof moderateMarksSchema>;

export const transcriptQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
});

@Injectable()
export class AcademicsService {
  constructor(private readonly audit: AuditService) {}

  async years(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.academicYear.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: { startDate: 'desc' },
        include: { terms: { orderBy: { sequence: 'asc' } } },
      }),
    );
  }

  async createYear(
    auth: AuthPrincipal,
    input: CreateYear,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({
          where: { schoolId: auth.schoolId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      const year = await tx.academicYear.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          name: input.name,
          startDate: new Date(`${input.startDate}T00:00:00.000Z`),
          endDate: new Date(`${input.endDate}T00:00:00.000Z`),
          calendarSystem: input.calendarSystem,
          isCurrent: input.isCurrent,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'academic_year.created',
        entity: 'AcademicYear',
        entityId: year.id,
        after: { name: year.name },
      });
      return year;
    });
  }

  async classes(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.class.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: { sequence: 'asc' },
        include: {
          sections: {
            orderBy: { name: 'asc' },
            include: { _count: { select: { students: { where: { deletedAt: null } } } } },
          },
          _count: { select: { students: { where: { deletedAt: null } } } },
        },
      }),
    );
  }

  async createClass(
    auth: AuthPrincipal,
    input: CreateClass,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const klass = await tx.class.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          name: input.name,
          sequence: input.sequence,
          sections: {
            create: input.sections.map((section) => ({
              id: uuidv7(),
              schoolId: auth.schoolId,
              name: section.name,
              capacity: section.capacity,
              room: section.room ?? null,
            })),
          },
        },
        include: { sections: true },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'class.created',
        entity: 'Class',
        entityId: klass.id,
        after: { name: klass.name, sections: klass.sections.map((section) => section.name) },
      });
      return klass;
    });
  }

  async subjects(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.subject.findMany({
        where: { schoolId: auth.schoolId, isActive: true },
        orderBy: { name: 'asc' },
        include: { classSubjects: { select: { classId: true } } },
      }),
    );
  }

  async createSubject(
    auth: AuthPrincipal,
    input: CreateSubject,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const subject = await tx.subject.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          code: input.code.toUpperCase(),
          name: input.name,
          type: input.type,
          credit: input.credit,
          classSubjects: {
            create: input.classIds.map((classId) => ({
              id: uuidv7(),
              schoolId: auth.schoolId,
              classId,
              weeklyPeriods: 4,
            })),
          },
        },
        include: { classSubjects: true },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'subject.created',
        entity: 'Subject',
        entityId: subject.id,
        after: { code: subject.code, name: subject.name },
      });
      return subject;
    });
  }

  async timetable(auth: AuthPrincipal, query: { classId?: string; sectionId?: string }) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const currentYear = await tx.academicYear.findFirst({
        where: { schoolId: auth.schoolId, isCurrent: true },
        select: { id: true },
      });
      const [periods, slots] = await Promise.all([
        tx.timetablePeriod.findMany({
          where: { schoolId: auth.schoolId },
          orderBy: { sequence: 'asc' },
        }),
        tx.timetableSlot.findMany({
          where: {
            schoolId: auth.schoolId,
            ...(currentYear ? { academicYearId: currentYear.id } : {}),
            ...(query.classId ? { classId: query.classId } : {}),
            ...(query.sectionId ? { sectionId: query.sectionId } : {}),
          },
          include: {
            subject: { select: { id: true, name: true, code: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
          orderBy: [{ dayOfWeek: 'asc' }, { periodId: 'asc' }],
        }),
      ]);
      return { periods, slots };
    });
  }

  async checkTimetable(
    auth: AuthPrincipal,
    input: z.infer<typeof timetableCheckSchema>,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const yearId = await resolveYearId(tx, auth.schoolId, input.academicYearId ?? input.slots[0]?.academicYearId);
      const existing = await tx.timetableSlot.findMany({
        where: { schoolId: auth.schoolId, academicYearId: yearId },
        take: 5000,
      });
      const candidateIds = new Set(
        input.slots.map((slot) => slot.id).filter((value): value is string => Boolean(value)),
      );
      const conflicts = detectTimetableConflicts([
        ...existing
          .filter((slot) => !candidateIds.has(slot.id))
          .map((slot) => ({
            id: slot.id,
            dayOfWeek: slot.dayOfWeek,
            periodId: slot.periodId,
            classId: slot.classId,
            sectionId: slot.sectionId,
            subjectId: slot.subjectId,
            teacherId: slot.staffId,
            room: slot.room,
          })),
        ...input.slots.map((slot, index) => ({
          id: slot.id ?? `candidate-${index + 1}`,
          dayOfWeek: slot.dayOfWeek,
          periodId: slot.periodId,
          classId: slot.classId,
          sectionId: slot.sectionId,
          subjectId: slot.subjectId,
          teacherId: slot.staffId,
          room: slot.room,
        })),
      ]);
      return { academicYearId: yearId, conflicts };
    });
  }

  async createSlot(
    auth: AuthPrincipal,
    input: CreateTimetableSlot,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const yearId = await resolveYearId(tx, auth.schoolId, input.academicYearId);
      const existing = await tx.timetableSlot.findMany({
        where: { schoolId: auth.schoolId, academicYearId: yearId },
        take: 5000,
      });
      const candidate = {
        id: 'candidate',
        dayOfWeek: input.dayOfWeek,
        periodId: input.periodId,
        classId: input.classId,
        sectionId: input.sectionId,
        subjectId: input.subjectId,
        teacherId: input.staffId ?? null,
        room: input.room ?? null,
      };
      const conflicts = detectTimetableConflicts([
        ...existing.map((slot) => ({
          id: slot.id,
          dayOfWeek: slot.dayOfWeek,
          periodId: slot.periodId,
          classId: slot.classId,
          sectionId: slot.sectionId,
          subjectId: slot.subjectId,
          teacherId: slot.staffId,
          room: slot.room,
        })),
        candidate,
      ]);
      if (conflicts.length > 0) {
        throw new AppError(
          'CONFLICT',
          'This lesson clashes with the timetable',
          409,
          { conflicts },
        );
      }
      const slot = await tx.timetableSlot.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          academicYearId: yearId,
          dayOfWeek: input.dayOfWeek,
          periodId: input.periodId,
          classId: input.classId,
          sectionId: input.sectionId,
          subjectId: input.subjectId,
          staffId: input.staffId ?? null,
          room: input.room ?? null,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'timetable.slot_created',
        entity: 'TimetableSlot',
        entityId: slot.id,
        after: {
          dayOfWeek: slot.dayOfWeek,
          periodId: slot.periodId,
          classId: slot.classId,
          sectionId: slot.sectionId,
        },
      });
      return slot;
    });
  }

  async deleteSlot(
    auth: AuthPrincipal,
    id: string,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const slot = await tx.timetableSlot.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!slot) throw new NotFoundError('Timetable slot');
      await tx.timetableSlot.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'timetable.slot_deleted',
        entity: 'TimetableSlot',
        entityId: id,
        before: {
          dayOfWeek: slot.dayOfWeek,
          periodId: slot.periodId,
          classId: slot.classId,
          sectionId: slot.sectionId,
        },
      });
      return { deleted: true };
    });
  }

  async substitutions(
    auth: AuthPrincipal,
    query: z.infer<typeof substitutionQuerySchema>,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const rows = await tx.timetableSubstitution.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.slotId ? { slotId: query.slotId } : {}),
          ...(query.from || query.to
            ? {
                date: {
                  ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                  ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      });
      return describeSubstitutions(tx, auth.schoolId, rows);
    });
  }

  async requestSubstitution(
    auth: AuthPrincipal,
    input: CreateSubstitution,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const slot = await tx.timetableSlot.findFirst({
        where: { id: input.slotId, schoolId: auth.schoolId },
      });
      if (!slot) throw new NotFoundError('Timetable slot');
      if (!slot.staffId) {
        throw new ValidationError('This timetable slot has no assigned teacher to substitute', {
          slotId: slot.id,
        });
      }
      if (slot.staffId === input.substituteStaffId) {
        throw new ValidationError('The substitute teacher must differ from the assigned teacher');
      }
      const substitute = await tx.staff.findFirst({
        where: {
          id: input.substituteStaffId,
          schoolId: auth.schoolId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true, firstName: true, lastName: true, employeeNo: true },
      });
      if (!substitute) throw new NotFoundError('Active substitute staff member');

      const date = new Date(`${input.date}T00:00:00.000Z`);
      const duplicate = await tx.timetableSubstitution.findFirst({
        where: {
          schoolId: auth.schoolId,
          slotId: input.slotId,
          date,
          status: { in: ['PENDING', 'APPROVED'] },
        },
        select: { id: true, status: true },
      });
      if (duplicate) {
        throw new ConflictError(
          'A substitution for this slot and date is already pending or approved',
          { substitutionId: duplicate.id, status: duplicate.status },
        );
      }

      const created = await tx.timetableSubstitution.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          slotId: input.slotId,
          date,
          originalStaffId: slot.staffId,
          substituteStaffId: input.substituteStaffId,
          reason: input.reason,
          requestedByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'timetable.substitution_requested',
        entity: 'TimetableSubstitution',
        entityId: created.id,
        after: {
          slotId: created.slotId,
          date: input.date,
          originalStaffId: created.originalStaffId,
          substituteStaffId: created.substituteStaffId,
          reason: created.reason,
        },
      });
      const described = await describeSubstitutions(tx, auth.schoolId, [created]);
      return described.items[0] ?? created;
    });
  }

  async reviewSubstitution(
    auth: AuthPrincipal,
    id: string,
    input: ReviewSubstitution,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const request = await tx.timetableSubstitution.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!request) throw new NotFoundError('Substitution request');
      if (request.status !== 'PENDING') {
        throw new ConflictError(`This substitution is already ${request.status.toLowerCase()}`, {
          status: request.status,
        });
      }

      if (input.decision === 'APPROVE') {
        const slot = await tx.timetableSlot.findFirst({
          where: { id: request.slotId, schoolId: auth.schoolId },
          select: { id: true, periodId: true },
        });
        if (!slot) throw new NotFoundError('Timetable slot');

        const dayOfWeek = isoDayOfWeek(request.date);
        const regularClash = await tx.timetableSlot.findFirst({
          where: {
            schoolId: auth.schoolId,
            dayOfWeek,
            periodId: slot.periodId,
            staffId: request.substituteStaffId,
            NOT: { id: slot.id },
          },
          select: { id: true },
        });
        if (regularClash) {
          throw new ConflictError(
            'The substitute teacher already teaches another lesson in this period',
            { slotId: regularClash.id },
          );
        }

        const approved = await tx.timetableSubstitution.findMany({
          where: {
            schoolId: auth.schoolId,
            date: request.date,
            status: 'APPROVED',
            substituteStaffId: request.substituteStaffId,
            NOT: { id: request.id },
          },
          select: { slotId: true },
        });
        if (approved.length > 0) {
          const approvedClash = await tx.timetableSlot.findFirst({
            where: {
              schoolId: auth.schoolId,
              id: { in: approved.map((row) => row.slotId) },
              periodId: slot.periodId,
            },
            select: { id: true },
          });
          if (approvedClash) {
            throw new ConflictError(
              'The substitute teacher already covers another lesson in this period',
              { slotId: approvedClash.id },
            );
          }
        }
      }

      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.timetableSubstitution.update({
        where: { id: request.id },
        data: {
          status,
          reviewNote: input.note ?? null,
          reviewedByUserId: auth.userId,
          reviewedAt: new Date(),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action:
          status === 'APPROVED'
            ? 'timetable.substitution_approved'
            : 'timetable.substitution_rejected',
        entity: 'TimetableSubstitution',
        entityId: updated.id,
        before: { status: request.status },
        after: {
          status: updated.status,
          substituteStaffId: updated.substituteStaffId,
          reviewNote: updated.reviewNote,
        },
      });
      const described = await describeSubstitutions(tx, auth.schoolId, [updated]);
      return described.items[0] ?? updated;
    });
  }

  async cancelSubstitution(
    auth: AuthPrincipal,
    id: string,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const request = await tx.timetableSubstitution.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!request) throw new NotFoundError('Substitution request');
      if (request.status !== 'PENDING') {
        throw new ConflictError(`This substitution is already ${request.status.toLowerCase()}`, {
          status: request.status,
        });
      }
      const updated = await tx.timetableSubstitution.update({
        where: { id: request.id },
        data: { status: 'CANCELLED', reviewedByUserId: auth.userId, reviewedAt: new Date() },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'timetable.substitution_cancelled',
        entity: 'TimetableSubstitution',
        entityId: updated.id,
        before: { status: request.status },
        after: { status: updated.status },
      });
      const described = await describeSubstitutions(tx, auth.schoolId, [updated]);
      return described.items[0] ?? updated;
    });
  }

  async exams(auth: AuthPrincipal, query: { academicYearId?: string }) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.exam.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          term: { select: { name: true } },
          _count: { select: { subjects: true, results: true } },
        },
      }),
    );
  }

  async createExam(
    auth: AuthPrincipal,
    input: CreateExam,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const exam = await tx.exam.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          academicYearId: input.academicYearId,
          termId: input.termId ?? null,
          name: input.name,
          type: input.type,
          startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00.000Z`) : null,
          endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00.000Z`) : null,
          subjects: {
            create: input.subjects.map((subject) => ({
              id: uuidv7(),
              schoolId: auth.schoolId,
              classId: subject.classId,
              subjectId: subject.subjectId,
              maxMarks: subject.maxMarks,
              passMarks: subject.passMarks,
              examDate: subject.examDate ? new Date(`${subject.examDate}T00:00:00.000Z`) : null,
            })),
          },
        },
        include: { subjects: true },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'exam.created',
        entity: 'Exam',
        entityId: exam.id,
        after: { name: exam.name, subjects: exam.subjects.length },
      });
      return exam;
    });
  }

  async examDetail(auth: AuthPrincipal, examId: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id: examId, schoolId: auth.schoolId },
        include: {
          term: true,
          academicYear: { select: { id: true, name: true } },
          subjects: {
            include: {
              class: { select: { name: true } },
              subject: { select: { id: true, name: true, code: true } },
              _count: { select: { marks: true } },
            },
            orderBy: [{ classId: 'asc' }],
          },
        },
      });
      if (!exam) throw new NotFoundError('Exam');
      return exam;
    });
  }

  async enterMarks(
    auth: AuthPrincipal,
    examSubjectId: string,
    input: EnterMarks,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const examSubject = await tx.examSubject.findFirst({
        where: { id: examSubjectId, schoolId: auth.schoolId },
        include: { exam: { select: { status: true, name: true } } },
      });
      if (!examSubject) throw new NotFoundError('Exam subject');
      if (examSubject.exam.status === 'PUBLISHED') {
        throw new AppError('CONFLICT', 'Results for this exam are already published', 409);
      }
      const maxMarks = Number(examSubject.maxMarks);
      for (const record of input.records) {
        if (record.marksObtained > maxMarks) {
          throw new AppError(
            'VALIDATION_FAILED',
            `Marks cannot exceed ${maxMarks}`,
            422,
            { studentId: record.studentId },
          );
        }
      }

      let saved = 0;
      for (const record of input.records) {
        const existing = await tx.mark.findUnique({
          where: {
            examSubjectId_studentId: {
              examSubjectId,
              studentId: record.studentId,
            },
          },
        });
        if (existing) {
          if (record.version !== undefined && record.version !== existing.version) {
            throw new AppError('VERSION_CONFLICT', 'These marks were edited by another user', 409, {
              studentId: record.studentId,
            });
          }
          await tx.mark.update({
            where: { id: existing.id },
            data: {
              marksObtained: record.isAbsent ? 0 : record.marksObtained,
              isAbsent: record.isAbsent,
              enteredByUserId: auth.userId,
              version: { increment: 1 },
            },
          });
        } else {
          await tx.mark.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              examSubjectId,
              studentId: record.studentId,
              marksObtained: record.isAbsent ? 0 : record.marksObtained,
              isAbsent: record.isAbsent,
              enteredByUserId: auth.userId,
            },
          });
        }
        saved += 1;
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'exam.marks_entered',
        entity: 'ExamSubject',
        entityId: examSubjectId,
        after: { saved, exam: examSubject.exam.name },
      });
      return { saved };
    });
  }

  /**
   * Moderation lets an exam controller adjust marks after entry but before
   * publication. Every change carries a reason in the audit trail.
   */
  async moderateMarks(
    auth: AuthPrincipal,
    examId: string,
    input: ModerateMarks,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id: examId, schoolId: auth.schoolId },
        select: { id: true, name: true, status: true },
      });
      if (!exam) throw new NotFoundError('Exam');
      if (exam.status === 'PUBLISHED' || exam.status === 'LOCKED') {
        throw new ConflictError('Marks cannot be moderated after publication');
      }
      const subjects = await tx.examSubject.findMany({
        where: { examId, schoolId: auth.schoolId, classId: input.classId },
        select: { id: true, maxMarks: true },
      });
      const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
      let updated = 0;
      for (const adjustment of input.adjustments) {
        const subject = subjectMap.get(adjustment.examSubjectId);
        if (!subject) {
          throw new AppError(
            'VALIDATION_FAILED',
            'The exam subject does not belong to this exam and class',
            422,
            { examSubjectId: adjustment.examSubjectId },
          );
        }
        if (adjustment.marksObtained > Number(subject.maxMarks)) {
          throw new AppError(
            'VALIDATION_FAILED',
            `Marks cannot exceed ${Number(subject.maxMarks)}`,
            422,
            { studentId: adjustment.studentId },
          );
        }
        const existing = await tx.mark.findUnique({
          where: {
            examSubjectId_studentId: {
              examSubjectId: adjustment.examSubjectId,
              studentId: adjustment.studentId,
            },
          },
        });
        if (existing) {
          await tx.mark.update({
            where: { id: existing.id },
            data: {
              marksObtained: adjustment.marksObtained,
              enteredByUserId: auth.userId,
              version: { increment: 1 },
            },
          });
        } else {
          await tx.mark.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              examSubjectId: adjustment.examSubjectId,
              studentId: adjustment.studentId,
              marksObtained: adjustment.marksObtained,
              enteredByUserId: auth.userId,
            },
          });
        }
        updated += 1;
      }
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'exam.marks_moderated',
        entity: 'Exam',
        entityId: examId,
        after: { name: exam.name, classId: input.classId, updated, reason: input.reason },
      });
      return { updated, reason: input.reason };
    });
  }

  /** Consolidated academic transcript across published exams. */
  async transcript(
    auth: AuthPrincipal,
    studentId: string,
    query: z.infer<typeof transcriptQuerySchema>,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, schoolId: auth.schoolId, deletedAt: null },
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          class: { select: { name: true } },
          section: { select: { name: true } },
        },
      });
      if (!student) throw new NotFoundError('Student');
      const results = await tx.examResult.findMany({
        where: {
          schoolId: auth.schoolId,
          studentId,
          exam: {
            status: 'PUBLISHED',
            ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
          },
        },
        include: {
          exam: {
            select: {
              id: true,
              name: true,
              type: true,
              publishedAt: true,
              academicYear: { select: { name: true } },
            },
          },
        },
        orderBy: { exam: { publishedAt: 'asc' } },
      });
      const examIds = results.map((result) => result.examId);
      const marks =
        examIds.length === 0
          ? []
          : await tx.mark.findMany({
              where: {
                schoolId: auth.schoolId,
                studentId,
                examSubject: { examId: { in: examIds } },
              },
              include: {
                examSubject: {
                  select: {
                    examId: true,
                    maxMarks: true,
                    passMarks: true,
                    subject: { select: { name: true, code: true } },
                  },
                },
              },
            });
      const marksByExam = new Map<string, typeof marks>();
      for (const mark of marks) {
        const list = marksByExam.get(mark.examSubject.examId) ?? [];
        list.push(mark);
        marksByExam.set(mark.examSubject.examId, list);
      }
      return {
        student: {
          id: student.id,
          admissionNo: student.admissionNo,
          name: `${student.firstName} ${student.lastName}`.trim(),
          className: student.class.name,
          sectionName: student.section.name,
        },
        exams: results.map((result) => ({
          examId: result.examId,
          examName: result.exam.name,
          examType: result.exam.type,
          academicYear: result.exam.academicYear.name,
          publishedAt: result.exam.publishedAt,
          totalObtained: Number(result.totalObtained),
          totalMaximum: Number(result.totalMaximum),
          percentage: Number(result.percentage),
          gpa: Number(result.gpa),
          grade: result.grade,
          rank: result.rank,
          passed: result.passed,
          subjects: (marksByExam.get(result.examId) ?? []).map((mark) => ({
            subject: mark.examSubject.subject.name,
            code: mark.examSubject.subject.code,
            maxMarks: Number(mark.examSubject.maxMarks),
            passMarks: Number(mark.examSubject.passMarks),
            marksObtained: Number(mark.marksObtained),
            isAbsent: mark.isAbsent,
          })),
        })),
      };
    });
  }

  /** Queues report-card generation as a background job. */
  async queueReportCards(
    auth: AuthPrincipal,
    examId: string,
    classId: string,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id: examId, schoolId: auth.schoolId },
        select: { id: true, name: true },
      });
      if (!exam) throw new NotFoundError('Exam');
      const job = await tx.backgroundJob.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          type: 'REPORT_CARDS',
          status: 'QUEUED',
          payload: { examId, classId } as never,
          requestedByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'exam.report_cards_queued',
        entity: 'BackgroundJob',
        entityId: job.id,
        after: { examId, examName: exam.name, classId },
      });
      return job;
    });
  }

  async reportCards(auth: AuthPrincipal, examId: string, classId: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [exam, bands, examSubjects] = await Promise.all([
        tx.exam.findFirst({ where: { id: examId, schoolId: auth.schoolId } }),
        loadPolicyBands(tx, auth.schoolId),
        tx.examSubject.findMany({
          where: { examId, schoolId: auth.schoolId, classId },
          include: { subject: { select: { name: true, code: true } } },
        }),
      ]);
      if (!exam) throw new NotFoundError('Exam');
      if (examSubjects.length === 0) throw new NotFoundError('Exam subjects');

      const students = await tx.student.findMany({
        where: { schoolId: auth.schoolId, classId, deletedAt: null },
        orderBy: { rollNo: 'asc' },
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          rollNo: true,
          section: { select: { name: true } },
        },
      });
      const marks = await tx.mark.findMany({
        where: {
          schoolId: auth.schoolId,
          examSubjectId: { in: examSubjects.map((subject) => subject.id) },
        },
        select: { studentId: true, examSubjectId: true, marksObtained: true, isAbsent: true },
      });

      const markMap = new Map(marks.map((mark) => [`${mark.studentId}:${mark.examSubjectId}`, mark]));
      const totalMax = examSubjects.reduce((sum, subject) => sum + Number(subject.maxMarks), 0);
      const cards = students.map((student) => {
        let total = 0;
        const subjects = examSubjects.map((subject) => {
          const mark = markMap.get(`${student.id}:${subject.id}`);
          const obtained = mark?.isAbsent ? 0 : Number(mark?.marksObtained ?? 0);
          total += obtained;
          const percent = roundPercent((obtained / Number(subject.maxMarks)) * 100);
          return {
            examSubjectId: subject.id,
            subject: subject.subject.name,
            code: subject.subject.code,
            maxMarks: Number(subject.maxMarks),
            passMarks: Number(subject.passMarks),
            marksObtained: obtained,
            isAbsent: Boolean(mark?.isAbsent),
            grade: gradeFor(percent, bands.bands, bands.passPercent).band.grade,
            passed: obtained >= Number(subject.passMarks),
          };
        });
        const percentage = totalMax === 0 ? 0 : roundPercent((total / totalMax) * 100);
        const graded = gradeFor(percentage, bands.bands, bands.passPercent);
        return {
          studentId: student.id,
          admissionNo: student.admissionNo,
          name: `${student.firstName} ${student.lastName}`.trim(),
          rollNo: student.rollNo,
          sectionName: student.section.name,
          totalObtained: total,
          totalMax,
          percentage,
          grade: graded.band.grade,
          gpa: graded.band.gpa,
          passed: subjects.every((subject) => subject.passed) && graded.passed,
          subjects,
        };
      });

      cards.sort((a, b) => b.percentage - a.percentage);
      cards.forEach((card, index) => Object.assign(card, { rank: index + 1 }));

      return {
        exam: { id: exam.id, name: exam.name, status: exam.status, publishedAt: exam.publishedAt },
        grading: bands,
        cards,
      };
    });
  }

  async publishResults(
    auth: AuthPrincipal,
    examId: string,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id: examId, schoolId: auth.schoolId },
        select: { id: true, name: true, status: true },
      });
      if (!exam) throw new NotFoundError('Exam');
      if (exam.status === 'PUBLISHED') return { alreadyPublished: true, publishedAt: null };
      const updated = await tx.exam.update({
        where: { id: examId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
        select: { publishedAt: true },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'exam.results_published',
        entity: 'Exam',
        entityId: examId,
        after: { name: exam.name },
      });
      return { alreadyPublished: false, publishedAt: updated.publishedAt };
    });
  }
}

function isoDayOfWeek(date: Date): number {
  const day = date.getUTCDay();
  return ((day + 6) % 7) + 1;
}

type StaffBrief = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
};

type SubstitutionRow = {
  slotId: string;
  originalStaffId: string;
  substituteStaffId: string;
};

async function describeSubstitutions<T extends SubstitutionRow>(
  tx: TxClient,
  schoolId: string,
  rows: T[],
): Promise<{
  items: Array<
    T & {
      slot:
        | {
            id: string;
            dayOfWeek: number;
            room: string | null;
            subject: { id: string; name: string; code: string };
            class: { name: string };
            section: { name: string };
            period: { name: string; sequence: number; startTime: string; endTime: string };
          }
        | null;
      originalStaff: StaffBrief | null;
      substituteStaff: StaffBrief | null;
    }
  >;
}> {
  if (rows.length === 0) return { items: [] };

  const slotIds = [...new Set(rows.map((row) => row.slotId))];
  const staffIds = [
    ...new Set(
      rows.flatMap((row) => [row.originalStaffId, row.substituteStaffId]).filter(Boolean),
    ),
  ];
  const [slots, staff] = await Promise.all([
    tx.timetableSlot.findMany({
      where: { schoolId, id: { in: slotIds } },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        period: { select: { name: true, sequence: true, startTime: true, endTime: true } },
      },
    }),
    tx.staff.findMany({
      where: { schoolId, id: { in: staffIds } },
      select: { id: true, firstName: true, lastName: true, employeeNo: true },
    }),
  ]);

  const slotMap = new Map(slots.map((slot) => [slot.id, slot]));
  const staffMap = new Map(staff.map((member) => [member.id, member]));

  return {
    items: rows.map((row) => ({
      ...row,
      slot: slotMap.get(row.slotId) ?? null,
      originalStaff: staffMap.get(row.originalStaffId) ?? null,
      substituteStaff: staffMap.get(row.substituteStaffId) ?? null,
    })),
  };
}

async function resolveYearId(
  tx: TxClient,
  schoolId: string,
  requested?: string,
): Promise<string> {
  if (requested) {
    const year = await tx.academicYear.findFirst({
      where: { id: requested, schoolId },
      select: { id: true },
    });
    if (!year) throw new NotFoundError('Academic year');
    return year.id;
  }
  const current = await tx.academicYear.findFirst({
    where: { schoolId, isCurrent: true },
    select: { id: true },
  });
  if (current) return current.id;
  const latest = await tx.academicYear.findFirst({
    where: { schoolId },
    orderBy: { startDate: 'desc' },
    select: { id: true },
  });
  if (!latest) throw new NotFoundError('Academic year');
  return latest.id;
}

function auditCtx(
  auth: AuthPrincipal,
  meta: { requestId: string; ip?: string; userAgent?: string },
) {
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
