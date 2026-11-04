import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AppError,
  ConflictError,
  DEFAULT_PLAN_LIMITS,
  NotFoundError,
  assertWithinLimit,
  createStudentSchema,
  studentListQuerySchema,
  updateStudentSchema,
  uuidv7,
  type PlanLimits,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { STUDENT_IMPORT_COLUMNS, parseCsv, toCsv } from './csv';

type CreateStudentBody = z.infer<typeof createStudentSchema>;
type UpdateStudentBody = z.infer<typeof updateStudentSchema>;
type StudentListQuery = z.infer<typeof studentListQuerySchema>;

const SORT_FIELDS = {
  createdAt: 'createdAt',
  firstName: 'firstName',
  admissionNo: 'admissionNo',
  rollNo: 'rollNo',
} as const;

export const promoteStudentsSchema = z.object({
  fromClassId: z.string().uuid(),
  fromSectionId: z.string().uuid().optional(),
  toClassId: z.string().uuid(),
  toSectionId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
  rollNoStrategy: z.enum(['KEEP', 'SEQUENTIAL']).default('KEEP'),
  preview: z.boolean().default(false),
});
export type PromoteStudentsInput = z.infer<typeof promoteStudentsSchema>;

@Injectable()
export class StudentsService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal, query: StudentListQuery) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.StudentWhereInput = {
        schoolId: auth.schoolId,
        deletedAt: null,
        ...(query.classId ? { classId: query.classId } : {}),
        ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.gender ? { gender: query.gender } : {}),
        ...(query.q
          ? {
              OR: [
                { firstName: { contains: query.q, mode: 'insensitive' } },
                { lastName: { contains: query.q, mode: 'insensitive' } },
                { admissionNo: { contains: query.q, mode: 'insensitive' } },
                { rollNo: { contains: query.q, mode: 'insensitive' } },
                { phone: { contains: query.q } },
              ],
            }
          : {}),
      };
      const [students, total] = await Promise.all([
        tx.student.findMany({
          where,
          orderBy: { [SORT_FIELDS[query.sort]]: query.order },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            class: { select: { id: true, name: true } },
            section: { select: { id: true, name: true } },
            guardians: {
              where: { isPrimary: true },
              take: 1,
              select: { fullName: true, phone: true, relation: true },
            },
          },
        }),
        tx.student.count({ where }),
      ]);
      return {
        items: students.map((student) => toStudentDto(student)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async get(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id, schoolId: auth.schoolId, deletedAt: null },
        include: {
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          guardians: true,
          documents: { select: { id: true, title: true, kind: true, storageKey: true } },
        },
      });
      if (!student) throw new NotFoundError('Student');
      return toStudentDto(student, true);
    });
  }

  async create(
    auth: AuthPrincipal,
    input: CreateStudentBody,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await assertStudentLimit(tx, auth.schoolId);
      await assertClassSection(tx, auth.schoolId, input.classId, input.sectionId);

      const existing = await tx.student.findFirst({
        where: { schoolId: auth.schoolId, admissionNo: input.admissionNo },
        select: { id: true },
      });
      if (existing) throw new ConflictError('That admission number is already in use');

      const student = await tx.student.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          admissionNo: input.admissionNo,
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender,
          classId: input.classId,
          sectionId: input.sectionId,
          status: input.status,
          rollNo: input.rollNo ?? null,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
          admissionDate: new Date(`${input.admissionDate ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ? { line1: input.address } : undefined,
          medicalNotes: input.medicalNotes ?? null,
          previousSchool: input.previousSchool ?? null,
          photoKey: input.photoKey ?? null,
          ...(input.guardian
            ? {
                guardians: {
                  create: [
                    {
                      id: uuidv7(),
                      schoolId: auth.schoolId,
                      relation: input.guardian.relation,
                      fullName: input.guardian.fullName,
                      phone: input.guardian.phone,
                      email: input.guardian.email ?? null,
                      occupation: input.guardian.occupation ?? null,
                      isPrimary: input.guardian.isPrimary,
                    },
                  ],
                },
              }
            : {}),
        },
        include: {
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          guardians: true,
        },
      });

      await this.audit.record(
        tx,
        auditCtx(auth, meta),
        {
          action: 'student.created',
          entity: 'Student',
          entityId: student.id,
          after: { admissionNo: student.admissionNo, name: `${student.firstName} ${student.lastName}` },
        },
      );
      return toStudentDto(student, true);
    });
  }

  async update(
    auth: AuthPrincipal,
    id: string,
    input: UpdateStudentBody,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.student.findFirst({
        where: { id, schoolId: auth.schoolId, deletedAt: null },
        include: { guardians: true },
      });
      if (!current) throw new NotFoundError('Student');
      if (input.version !== undefined && input.version !== current.version) {
        throw new AppError('VERSION_CONFLICT', 'This student was changed by another user', 409, {
          expectedVersion: input.version,
          actualVersion: current.version,
        });
      }
      if (input.classId || input.sectionId) {
        await assertClassSection(
          tx,
          auth.schoolId,
          input.classId ?? current.classId,
          input.sectionId ?? current.sectionId,
        );
      }

      const data: Prisma.StudentUpdateInput = { version: { increment: 1 } };
      if (input.firstName !== undefined) data.firstName = input.firstName;
      if (input.lastName !== undefined) data.lastName = input.lastName;
      if (input.gender !== undefined) data.gender = input.gender;
      if (input.status !== undefined) data.status = input.status;
      if (input.rollNo !== undefined) data.rollNo = input.rollNo ?? null;
      if (input.dateOfBirth !== undefined) {
        data.dateOfBirth = input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null;
      }
      if (input.admissionDate !== undefined) {
        data.admissionDate = new Date(`${input.admissionDate}T00:00:00.000Z`);
      }
      if (input.phone !== undefined) data.phone = input.phone ?? null;
      if (input.email !== undefined) data.email = input.email ?? null;
      if (input.address !== undefined) data.address = input.address ? { line1: input.address } : undefined;
      if (input.medicalNotes !== undefined) data.medicalNotes = input.medicalNotes ?? null;
      if (input.previousSchool !== undefined) data.previousSchool = input.previousSchool ?? null;
      if (input.photoKey !== undefined) data.photoKey = input.photoKey ?? null;
      if (input.classId !== undefined) data.class = { connect: { id: input.classId } };
      if (input.sectionId !== undefined) data.section = { connect: { id: input.sectionId } };

      const student = await tx.student.update({
        where: { id },
        data,
        include: {
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
          guardians: true,
        },
      });

      if (input.guardian) {
        const primary = current.guardians.find((guardian) => guardian.isPrimary) ?? current.guardians[0];
        if (primary) {
          await tx.guardian.update({
            where: { id: primary.id },
            data: {
              relation: input.guardian.relation,
              fullName: input.guardian.fullName,
              phone: input.guardian.phone,
              email: input.guardian.email ?? null,
              occupation: input.guardian.occupation ?? null,
              isPrimary: true,
            },
          });
        } else {
          await tx.guardian.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              studentId: id,
              relation: input.guardian.relation,
              fullName: input.guardian.fullName,
              phone: input.guardian.phone,
              email: input.guardian.email ?? null,
              occupation: input.guardian.occupation ?? null,
              isPrimary: true,
            },
          });
        }
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'student.updated',
        entity: 'Student',
        entityId: student.id,
        before: { firstName: current.firstName, lastName: current.lastName, status: current.status },
        after: { firstName: student.firstName, lastName: student.lastName, status: student.status },
      });
      return toStudentDto(student, true);
    });
  }

  async archive(
    auth: AuthPrincipal,
    id: string,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id, schoolId: auth.schoolId, deletedAt: null },
        select: { id: true, admissionNo: true },
      });
      if (!student) throw new NotFoundError('Student');
      await tx.student.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'WITHDRAWN' },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'student.archived',
        entity: 'Student',
        entityId: id,
        before: { admissionNo: student.admissionNo },
      });
      return { archived: true };
    });
  }

  /**
   * Promotes a whole class/section (or a selected subset) into the next
   * class/section. Preview mode returns the exact roster so an admin can check
   * the destination before writing anything.
   */
  async promote(
    auth: AuthPrincipal,
    input: PromoteStudentsInput,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await assertClassSection(tx, auth.schoolId, input.toClassId, input.toSectionId);
      const target = await tx.section.findFirst({
        where: { id: input.toSectionId, schoolId: auth.schoolId, classId: input.toClassId },
        select: { name: true, class: { select: { name: true } } },
      });
      if (!target) {
        throw new AppError('VALIDATION_FAILED', 'The target class and section do not match', 422);
      }

      const students = await tx.student.findMany({
        where: {
          schoolId: auth.schoolId,
          deletedAt: null,
          classId: input.fromClassId,
          ...(input.fromSectionId ? { sectionId: input.fromSectionId } : {}),
          ...(input.studentIds ? { id: { in: input.studentIds } } : {}),
        },
        orderBy: [{ sectionId: 'asc' }, { rollNo: 'asc' }],
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          rollNo: true,
          classId: true,
          sectionId: true,
          version: true,
        },
      });

      const roster = students.map((student) => ({
        id: student.id,
        admissionNo: student.admissionNo,
        name: `${student.firstName} ${student.lastName}`.trim(),
        rollNo: student.rollNo,
        fromClassId: student.classId,
        fromSectionId: student.sectionId,
      }));

      if (input.preview) {
        return {
          preview: true,
          promoteCount: roster.length,
          from: { classId: input.fromClassId, sectionId: input.fromSectionId ?? null },
          to: {
            classId: input.toClassId,
            sectionId: input.toSectionId,
            className: target.class.name,
            sectionName: target.name,
          },
          students: roster,
        };
      }

      let nextRoll = 1;
      if (input.rollNoStrategy === 'SEQUENTIAL') {
        const existing = await tx.student.findMany({
          where: {
            schoolId: auth.schoolId,
            deletedAt: null,
            classId: input.toClassId,
            sectionId: input.toSectionId,
            rollNo: { not: null },
          },
          select: { rollNo: true },
        });
        const numeric = existing
          .map((row) => Number.parseInt(row.rollNo ?? '', 10))
          .filter((value) => Number.isFinite(value));
        nextRoll = (numeric.length > 0 ? Math.max(...numeric) : 0) + 1;
      }

      for (const student of students) {
        await tx.student.update({
          where: { id: student.id },
          data: {
            classId: input.toClassId,
            sectionId: input.toSectionId,
            status: 'ACTIVE',
            ...(input.rollNoStrategy === 'SEQUENTIAL'
              ? { rollNo: String(nextRoll++) }
              : {}),
            version: { increment: 1 },
          },
        });
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'student.promoted',
        entity: 'Student',
        after: {
          promoted: students.length,
          fromClassId: input.fromClassId,
          fromSectionId: input.fromSectionId ?? null,
          toClassId: input.toClassId,
          toSectionId: input.toSectionId,
          rollNoStrategy: input.rollNoStrategy,
        },
      });

      return {
        preview: false,
        promoted: students.length,
        to: {
          classId: input.toClassId,
          sectionId: input.toSectionId,
          className: target.class.name,
          sectionName: target.name,
        },
      };
    });
  }

  async search(auth: AuthPrincipal, query: { q: string; limit: number }) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.student.findMany({
        where: {
          schoolId: auth.schoolId,
          deletedAt: null,
          OR: [
            { firstName: { contains: query.q, mode: 'insensitive' } },
            { lastName: { contains: query.q, mode: 'insensitive' } },
            { admissionNo: { contains: query.q, mode: 'insensitive' } },
          ],
        },
        take: query.limit,
        orderBy: { firstName: 'asc' },
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          class: { select: { name: true } },
          section: { select: { name: true } },
        },
      }),
    );
  }

  async exportCsv(auth: AuthPrincipal, query: { classId?: string; sectionId?: string }) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const students = await tx.student.findMany({
        where: {
          schoolId: auth.schoolId,
          deletedAt: null,
          ...(query.classId ? { classId: query.classId } : {}),
          ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        },
        take: 10_000,
        orderBy: [{ classId: 'asc' }, { rollNo: 'asc' }],
        include: {
          class: { select: { name: true } },
          section: { select: { name: true } },
          guardians: { where: { isPrimary: true }, take: 1 },
        },
      });
      return toCsv(
        students.map((student) => ({
          admissionNo: student.admissionNo,
          firstName: student.firstName,
          lastName: student.lastName,
          gender: student.gender,
          className: student.class.name,
          sectionName: student.section.name,
          rollNo: student.rollNo ?? '',
          dateOfBirth: student.dateOfBirth?.toISOString().slice(0, 10) ?? '',
          phone: student.phone ?? '',
          guardianName: student.guardians[0]?.fullName ?? '',
          guardianPhone: student.guardians[0]?.phone ?? '',
          status: student.status,
        })),
        [...STUDENT_IMPORT_COLUMNS, 'status'],
      );
    });
  }

  async importCsv(
    auth: AuthPrincipal,
    csv: string,
    options: { mode: 'PREVIEW' | 'COMMIT'; defaultSection: string },
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    const parsed = parseCsv(csv);
    if (parsed.errors.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'The CSV file could not be read', 422, parsed.errors);
    }

    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [classes, sections] = await Promise.all([
        tx.class.findMany({ where: { schoolId: auth.schoolId }, select: { id: true, name: true } }),
        tx.section.findMany({
          where: { schoolId: auth.schoolId },
          select: { id: true, name: true, classId: true },
        }),
      ]);
      const classByName = new Map(classes.map((klass) => [klass.name.toLowerCase(), klass]));
      const sectionByKey = new Map(
        sections.map((section) => [`${section.classId}:${section.name.toLowerCase()}`, section]),
      );

      const errors: { row: number; field: string; message: string }[] = [];
      const valid: {
        row: number;
        admissionNo: string;
        firstName: string;
        lastName: string;
        gender: 'MALE' | 'FEMALE' | 'OTHER';
        classId: string;
        sectionId: string;
        rollNo?: string;
        dateOfBirth?: string;
        phone?: string;
        guardianName?: string;
        guardianPhone?: string;
      }[] = [];

      parsed.rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const admissionNo = row.admissionNo?.trim();
        const firstName = row.firstName?.trim();
        const lastName = row.lastName?.trim() ?? '';
        const gender = (row.gender ?? '').toUpperCase();
        if (!admissionNo) errors.push({ row: rowNumber, field: 'admissionNo', message: 'Required' });
        if (!firstName) errors.push({ row: rowNumber, field: 'firstName', message: 'Required' });
        if (!['MALE', 'FEMALE', 'OTHER'].includes(gender)) {
          errors.push({ row: rowNumber, field: 'gender', message: 'Use MALE, FEMALE or OTHER' });
        }
        const klass = classByName.get((row.className ?? '').toLowerCase());
        if (!klass) {
          errors.push({ row: rowNumber, field: 'className', message: 'Unknown class' });
        }
        const sectionName = (row.sectionName || options.defaultSection).toLowerCase();
        const section = klass ? sectionByKey.get(`${klass.id}:${sectionName}`) : undefined;
        if (!section) {
          errors.push({ row: rowNumber, field: 'sectionName', message: 'Unknown section' });
        }
        if (row.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth)) {
          errors.push({ row: rowNumber, field: 'dateOfBirth', message: 'Use YYYY-MM-DD' });
        }
        if (errors.some((error) => error.row === rowNumber)) return;

        valid.push({
          row: rowNumber,
          admissionNo: admissionNo!,
          firstName: firstName!,
          lastName,
          gender: gender as 'MALE' | 'FEMALE' | 'OTHER',
          classId: klass!.id,
          sectionId: section!.id,
          ...(row.rollNo ? { rollNo: row.rollNo } : {}),
          ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.guardianName ? { guardianName: row.guardianName } : {}),
          ...(row.guardianPhone ? { guardianPhone: row.guardianPhone } : {}),
        });
      });

      const existing = await tx.student.findMany({
        where: {
          schoolId: auth.schoolId,
          admissionNo: { in: valid.map((row) => row.admissionNo) },
        },
        select: { admissionNo: true },
      });
      const existingNumbers = new Set(existing.map((row) => row.admissionNo));
      const creatable = valid.filter((row) => !existingNumbers.has(row.admissionNo));
      for (const row of valid.filter((entry) => existingNumbers.has(entry.admissionNo))) {
        errors.push({
          row: row.row,
          field: 'admissionNo',
          message: 'Admission number already exists',
        });
      }

      if (options.mode === 'PREVIEW') {
        return {
          mode: 'PREVIEW',
          totalRows: parsed.rows.length,
          validRows: creatable.length,
          errors,
          preview: creatable.slice(0, 10),
        };
      }

      await assertStudentLimit(tx, auth.schoolId, creatable.length);
      let created = 0;
      for (const row of creatable) {
        await tx.student.create({
          data: {
            id: uuidv7(),
            schoolId: auth.schoolId,
            admissionNo: row.admissionNo,
            firstName: row.firstName,
            lastName: row.lastName,
            gender: row.gender,
            classId: row.classId,
            sectionId: row.sectionId,
            rollNo: row.rollNo ?? null,
            dateOfBirth: row.dateOfBirth ? new Date(`${row.dateOfBirth}T00:00:00.000Z`) : null,
            phone: row.phone ?? null,
            admissionDate: new Date(),
            ...(row.guardianName && row.guardianPhone
              ? {
                  guardians: {
                    create: [
                      {
                        id: uuidv7(),
                        schoolId: auth.schoolId,
                        relation: 'GUARDIAN',
                        fullName: row.guardianName,
                        phone: row.guardianPhone,
                        isPrimary: true,
                      },
                    ],
                  },
                }
              : {}),
          },
        });
        created += 1;
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'student.imported',
        entity: 'Student',
        after: { created, skipped: errors.length, totalRows: parsed.rows.length },
      });
      return { mode: 'COMMIT', totalRows: parsed.rows.length, created, errors };
    });
  }
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

function toStudentDto(
  student: {
    id: string;
    admissionNo: string;
    firstName: string;
    lastName: string;
    gender: string;
    dateOfBirth: Date | null;
    classId: string;
    sectionId: string;
    rollNo: string | null;
    status: string;
    admissionDate: Date;
    phone: string | null;
    email: string | null;
    address: unknown;
    medicalNotes: string | null;
    previousSchool: string | null;
    photoKey: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    class?: { id: string; name: string };
    section?: { id: string; name: string };
    guardians?: {
      id?: string;
      fullName: string;
      phone: string;
      relation: string;
      isPrimary?: boolean;
    }[];
    documents?: { id: string; title: string; kind: string; storageKey: string }[];
  },
  full = false,
) {
  const base = {
    id: student.id,
    admissionNo: student.admissionNo,
    firstName: student.firstName,
    lastName: student.lastName,
    fullName: `${student.firstName} ${student.lastName}`.trim(),
    gender: student.gender,
    dateOfBirth: student.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    classId: student.classId,
    className: student.class?.name,
    sectionId: student.sectionId,
    sectionName: student.section?.name,
    rollNo: student.rollNo,
    status: student.status,
    admissionDate: student.admissionDate.toISOString().slice(0, 10),
    phone: student.phone,
    email: student.email,
    photoKey: student.photoKey,
    version: student.version,
    updatedAt: student.updatedAt,
  };
  if (!full) {
    return {
      ...base,
      guardian: student.guardians?.[0]
        ? {
            fullName: student.guardians[0].fullName,
            phone: student.guardians[0].phone,
            relation: student.guardians[0].relation,
          }
        : null,
    };
  }
  return {
    ...base,
    address: student.address,
    medicalNotes: student.medicalNotes,
    previousSchool: student.previousSchool,
    createdAt: student.createdAt,
    guardians: student.guardians ?? [],
    documents: student.documents ?? [],
  };
}

async function assertStudentLimit(tx: TxClient, schoolId: string, requested = 1): Promise<void> {
  const school = await tx.school.findUnique({
    where: { id: schoolId },
    select: { limitsOverride: true, plan: { select: { code: true, limits: true } } },
  });
  if (!school) throw new NotFoundError('School');
  const limits =
    (school.plan?.limits as unknown as PlanLimits | undefined) ??
    DEFAULT_PLAN_LIMITS.trial!;
  const overrides = (school.limitsOverride ?? {}) as { students?: number };
  const current = await tx.student.count({ where: { schoolId, deletedAt: null } });
  assertWithinLimit(
    {
      plan: { code: school.plan?.code ?? 'trial', limits },
      overrides: { limits: overrides },
    },
    'students',
    current,
    requested,
  );
}

async function assertClassSection(
  tx: TxClient,
  schoolId: string,
  classId: string,
  sectionId: string,
): Promise<void> {
  const section = await tx.section.findFirst({
    where: { id: sectionId, schoolId, classId },
    select: { id: true },
  });
  if (!section) {
    throw new AppError('VALIDATION_FAILED', 'The chosen class and section do not match', 422);
  }
}
