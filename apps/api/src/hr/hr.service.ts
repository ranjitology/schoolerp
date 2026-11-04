import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
  todayIso,
  uuidv7,
  type AttendanceStatus,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const staffListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VOLUNTEER']).optional(),
});

export const createStaffSchema = z.object({
  employeeNo: z.string().trim().min(1).max(32),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).default(''),
  email: z.string().email().max(254).optional(),
  phone: z.string().trim().max(24).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: isoDate.optional(),
  address: z.string().trim().max(500).optional(),
  qualification: z.string().trim().max(160).optional(),
  experienceYears: z.number().int().min(0).max(60).default(0),
  joinedOn: isoDate.optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VOLUNTEER']).default('FULL_TIME'),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']).default('ACTIVE'),
  baseSalaryMinor: z.number().int().min(0).max(1_000_000_000).default(0),
});

export const updateStaffSchema = createStaffSchema.partial();

export const createLeaveSchema = z.object({
  staffId: z.string().uuid(),
  type: z.enum(['CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']).default('CASUAL'),
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().trim().min(3).max(500),
});

export const leaveQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  staffId: z.string().uuid().optional(),
});

export const staffAttendanceQuerySchema = z.object({
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  staffId: z.string().uuid().optional(),
});

export const markStaffAttendanceSchema = z.object({
  date: isoDate,
  records: z
    .array(
      z.object({
        staffId: z.string().uuid(),
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE']),
        checkIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        checkOut: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        remark: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(500),
});

@Injectable()
export class HrService {
  constructor(private readonly audit: AuditService) {}

  async listStaff(auth: AuthPrincipal, query: z.infer<typeof staffListQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.StaffWhereInput = {
        schoolId: auth.schoolId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.employmentType ? { employmentType: query.employmentType } : {}),
        ...(query.q
          ? {
              OR: [
                { firstName: { contains: query.q, mode: 'insensitive' } },
                { lastName: { contains: query.q, mode: 'insensitive' } },
                { employeeNo: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.staff.findMany({
          where,
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { _count: { select: { leaves: true, payslips: true } } },
        }),
        tx.staff.count({ where }),
      ]);
      return { items: items.map(staffDto), page: query.page, pageSize: query.pageSize, total };
    });
  }

  async getStaff(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { id, schoolId: auth.schoolId, deletedAt: null },
        include: {
          documents: true,
          leaves: { orderBy: { startDate: 'desc' }, take: 20 },
          attendance: { orderBy: { date: 'desc' }, take: 30 },
          payslips: { orderBy: { createdAt: 'desc' }, take: 12 },
        },
      });
      if (!staff) throw new NotFoundError('Staff member');
      return {
        ...staffDto(staff),
        documents: staff.documents,
        leaves: staff.leaves,
        attendance: staff.attendance,
        payslips: staff.payslips,
      };
    });
  }

  async createStaff(auth: AuthPrincipal, input: z.infer<typeof createStaffSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.staff.findFirst({
        where: { schoolId: auth.schoolId, employeeNo: input.employeeNo },
        select: { id: true },
      });
      if (existing) throw new ConflictError('That employee number is already in use');

      const staff = await tx.staff.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          employeeNo: input.employeeNo,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          gender: input.gender ?? null,
          dateOfBirth: input.dateOfBirth ? dateValue(input.dateOfBirth) : null,
          address: input.address ?? null,
          qualification: input.qualification ?? null,
          experienceYears: input.experienceYears,
          joinedOn: input.joinedOn ? dateValue(input.joinedOn) : null,
          employmentType: input.employmentType,
          status: input.status,
          baseSalaryMinor: input.baseSalaryMinor,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'staff.created',
        entity: 'Staff',
        entityId: staff.id,
        after: { employeeNo: staff.employeeNo, name: `${staff.firstName} ${staff.lastName}` },
      });
      return staffDto(staff);
    });
  }

  async updateStaff(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateStaffSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.staff.findFirst({
        where: { id, schoolId: auth.schoolId, deletedAt: null },
      });
      if (!current) throw new NotFoundError('Staff member');
      const staff = await tx.staff.update({
        where: { id },
        data: {
          ...(input.employeeNo !== undefined ? { employeeNo: input.employeeNo } : {}),
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.email !== undefined ? { email: input.email ?? null } : {}),
          ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
          ...(input.gender !== undefined ? { gender: input.gender } : {}),
          ...(input.dateOfBirth !== undefined
            ? { dateOfBirth: input.dateOfBirth ? dateValue(input.dateOfBirth) : null }
            : {}),
          ...(input.address !== undefined ? { address: input.address ?? null } : {}),
          ...(input.qualification !== undefined ? { qualification: input.qualification ?? null } : {}),
          ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
          ...(input.joinedOn !== undefined
            ? { joinedOn: input.joinedOn ? dateValue(input.joinedOn) : null }
            : {}),
          ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.baseSalaryMinor !== undefined ? { baseSalaryMinor: input.baseSalaryMinor } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'staff.updated',
        entity: 'Staff',
        entityId: id,
        before: { status: current.status, baseSalaryMinor: current.baseSalaryMinor },
        after: { status: staff.status, baseSalaryMinor: staff.baseSalaryMinor },
      });
      return staffDto(staff);
    });
  }

  async removeStaff(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.staff.findFirst({
        where: { id, schoolId: auth.schoolId, deletedAt: null },
      });
      if (!current) throw new NotFoundError('Staff member');
      await tx.staff.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'staff.archived',
        entity: 'Staff',
        entityId: id,
        before: { status: current.status },
      });
      return { archived: true };
    });
  }

  async listLeaves(auth: AuthPrincipal, query: z.infer<typeof leaveQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.StaffLeaveWhereInput = {
        schoolId: auth.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.staffId ? { staffId: query.staffId } : {}),
      };
      const [items, total] = await Promise.all([
        tx.staffLeave.findMany({
          where,
          orderBy: { startDate: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { staff: { select: { id: true, firstName: true, lastName: true, employeeNo: true } } },
        }),
        tx.staffLeave.count({ where }),
      ]);
      return {
        items: items.map((leave) => ({
          ...leave,
          days: inclusiveDays(leave.startDate, leave.endDate),
          staffName: `${leave.staff.firstName} ${leave.staff.lastName}`.trim(),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async createLeave(auth: AuthPrincipal, input: z.infer<typeof createLeaveSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { id: input.staffId, schoolId: auth.schoolId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!staff) throw new NotFoundError('Staff member');
      if (input.endDate < input.startDate) {
        throw new ConflictError('Leave end date cannot be before the start date');
      }
      const leave = await tx.staffLeave.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          staffId: input.staffId,
          type: input.type,
          status: 'PENDING',
          startDate: dateValue(input.startDate),
          endDate: dateValue(input.endDate),
          reason: input.reason,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'leave.requested',
        entity: 'StaffLeave',
        entityId: leave.id,
        after: { staffId: input.staffId, type: input.type, startDate: input.startDate },
      });
      return { ...leave, staffName: `${staff.firstName} ${staff.lastName}`.trim() };
    });
  }

  async decideLeave(
    auth: AuthPrincipal,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.staffLeave.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Leave request');
      if (current.status !== 'PENDING') throw new ConflictError('This leave request is already decided');
      const leave = await tx.staffLeave.update({
        where: { id },
        data: { status: decision, approvedByUserId: auth.userId },
      });
      if (decision === 'APPROVED') {
        for (const day of isoDays(current.startDate, current.endDate)) {
          await tx.staffAttendance.upsert({
            where: { staffId_date: { staffId: current.staffId, date: dateValue(day) } },
            create: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              staffId: current.staffId,
              date: dateValue(day),
              status: 'LEAVE',
              remark: `Approved ${current.type.toLowerCase()} leave`,
            },
            update: { status: 'LEAVE', remark: `Approved ${current.type.toLowerCase()} leave` },
          });
        }
      }
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: `leave.${decision.toLowerCase()}`,
        entity: 'StaffLeave',
        entityId: id,
        before: { status: current.status },
        after: { status: decision },
      });
      return leave;
    });
  }

  async attendance(auth: AuthPrincipal, query: z.infer<typeof staffAttendanceQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const dateFilters = query.date
        ? { date: dateValue(query.date) }
        : query.from && query.to
          ? { date: { gte: dateValue(query.from), lte: dateValue(query.to) } }
          : {};
      const [records, staff] = await Promise.all([
        tx.staffAttendance.findMany({
          where: {
            schoolId: auth.schoolId,
            ...(query.staffId ? { staffId: query.staffId } : {}),
            ...dateFilters,
          },
          orderBy: [{ date: 'desc' }, { staffId: 'asc' }],
          take: 500,
          include: { staff: { select: { firstName: true, lastName: true, employeeNo: true } } },
        }),
        tx.staff.findMany({
          where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          select: { id: true, firstName: true, lastName: true, employeeNo: true, employmentType: true },
        }),
      ]);
      return {
        date: query.date ?? todayIso(),
        staff,
        items: records.map((record) => ({
          ...record,
          staffName: `${record.staff.firstName} ${record.staff.lastName}`.trim(),
          employeeNo: record.staff.employeeNo,
        })),
      };
    });
  }

  async markAttendance(
    auth: AuthPrincipal,
    input: z.infer<typeof markStaffAttendanceSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const ids = input.records.map((record) => record.staffId);
      const staff = await tx.staff.findMany({
        where: { schoolId: auth.schoolId, id: { in: ids } },
        select: { id: true },
      });
      if (staff.length !== new Set(ids).size) throw new NotFoundError('Staff member');
      for (const record of input.records) {
        await tx.staffAttendance.upsert({
          where: { staffId_date: { staffId: record.staffId, date: dateValue(input.date) } },
          create: {
            id: uuidv7(),
            schoolId: auth.schoolId,
            staffId: record.staffId,
            date: dateValue(input.date),
            status: record.status,
            checkIn: record.checkIn ?? null,
            checkOut: record.checkOut ?? null,
            remark: record.remark ?? null,
          },
          update: {
            status: record.status,
            checkIn: record.checkIn ?? null,
            checkOut: record.checkOut ?? null,
            remark: record.remark ?? null,
          },
        });
      }
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'staff_attendance.marked',
        entity: 'StaffAttendance',
        entityId: input.date,
        after: { date: input.date, count: input.records.length },
      });
      return { date: input.date, marked: input.records.length };
    });
  }

  async summary(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [total, active, onLeave, pendingLeaves, byType] = await Promise.all([
        tx.staff.count({ where: { schoolId: auth.schoolId, deletedAt: null } }),
        tx.staff.count({ where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' } }),
        tx.staff.count({ where: { schoolId: auth.schoolId, deletedAt: null, status: 'ON_LEAVE' } }),
        tx.staffLeave.count({ where: { schoolId: auth.schoolId, status: 'PENDING' } }),
        tx.staff.groupBy({
          by: ['employmentType'],
          where: { schoolId: auth.schoolId, deletedAt: null },
          _count: { _all: true },
        }),
      ]);
      const payroll = await tx.payrollRun.findFirst({
        where: { schoolId: auth.schoolId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      return {
        total,
        active,
        onLeave,
        pendingLeaves,
        byEmploymentType: byType.map((row) => ({ type: row.employmentType, count: row._count._all })),
        latestPayroll: payroll,
      };
    });
  }
}

export function staffDto(staff: {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  employmentType: string;
  baseSalaryMinor: number | null;
  joinedOn: Date | null;
  qualification?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  address?: string | null;
  experienceYears?: number | null;
  photoKey?: string | null;
  _count?: { leaves: number; payslips: number };
}) {
  return {
    id: staff.id,
    employeeNo: staff.employeeNo,
    firstName: staff.firstName,
    lastName: staff.lastName,
    fullName: `${staff.firstName} ${staff.lastName}`.trim(),
    email: staff.email,
    phone: staff.phone,
    status: staff.status,
    employmentType: staff.employmentType,
    baseSalaryMinor: staff.baseSalaryMinor ?? 0,
    joinedOn: staff.joinedOn,
    qualification: staff.qualification ?? null,
    gender: staff.gender ?? null,
    dateOfBirth: staff.dateOfBirth ?? null,
    address: staff.address ?? null,
    experienceYears: staff.experienceYears ?? 0,
    photoKey: staff.photoKey ?? null,
    leaveCount: staff._count?.leaves,
    payslipCount: staff._count?.payslips,
  };
}

export function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function isoDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function inclusiveDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
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

export type StaffAttendanceStatus = AttendanceStatus;
