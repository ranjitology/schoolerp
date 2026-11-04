import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ATTENDANCE_POLICY,
  summarizeLedger,
  summarizeAttendance,
  todayIso,
  type AttendancePolicy,
  type AttendanceStatus,
  type InvoiceStatus,
} from '@schoolerp/core';
import type { TxClient } from '@schoolerp/db';
import { withTenant } from '@schoolerp/db';
import type { AuthPrincipal } from '../common/request';
import { NoticesService } from '../notices/notices.service';

@Injectable()
export class DashboardService {
  constructor(private readonly notices: NoticesService) {}

  async overview(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const today = todayIso();
      const todayDate = new Date(`${today}T00:00:00.000Z`);
      const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
      const weekAgo = new Date(todayDate.getTime() - 6 * 86_400_000);

      const [
        students,
        staff,
        classes,
        attendanceToday,
        attendanceWeek,
        invoices,
        payments,
        overdue,
        notices,
        exams,
        pendingLeaves,
        admissions,
        settings,
      ] = await Promise.all([
        tx.student.count({ where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' } }),
        tx.staff.count({ where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' } }),
        tx.class.count({ where: { schoolId: auth.schoolId } }),
        tx.attendanceRecord.groupBy({
          by: ['status'],
          where: { schoolId: auth.schoolId, date: todayDate },
          _count: { _all: true },
        }),
        tx.attendanceRecord.groupBy({
          by: ['date', 'status'],
          where: { schoolId: auth.schoolId, date: { gte: weekAgo, lte: todayDate } },
          _count: { _all: true },
        }),
        tx.invoice.aggregate({
          where: { schoolId: auth.schoolId, status: { notIn: ['VOID', 'DRAFT'] } },
          _sum: { totalMinor: true, paidMinor: true },
          _count: { _all: true },
        }),
        tx.payment.aggregate({
          where: { schoolId: auth.schoolId, status: { not: 'VOID' }, paidAt: { gte: monthStart } },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        tx.invoice.count({
          where: {
            schoolId: auth.schoolId,
            status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
            dueDate: { lt: todayDate },
          },
        }),
        tx.notice.findMany({
          where: { schoolId: auth.schoolId, status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            priority: true,
            publishedAt: true,
            createdAt: true,
          },
        }),
        tx.exam.findMany({
          where: {
            schoolId: auth.schoolId,
            status: { notIn: ['ARCHIVED'] },
            OR: [{ startsOn: null }, { startsOn: { gte: todayDate } }],
          },
          orderBy: { startsOn: 'asc' },
          take: 5,
          select: { id: true, name: true, type: true, status: true, startsOn: true, endsOn: true },
        }),
        tx.staffLeave.count({ where: { schoolId: auth.schoolId, status: 'PENDING' } }),
        tx.admissionApplication.groupBy({
          by: ['status'],
          where: { schoolId: auth.schoolId },
          _count: { _all: true },
        }),
        tx.schoolSetting.findUnique({
          where: { schoolId: auth.schoolId },
          select: { attendance: true },
        }),
      ]);

      const policy = attendancePolicy(settings?.attendance);
      const attendanceSummary = summarizeAttendance(todayRecords(attendanceToday), policy);
      const totalBilled = invoices._sum.totalMinor ?? 0;
      const totalPaid = invoices._sum.paidMinor ?? 0;

      const weekBuckets = new Map<string, { status: AttendanceStatus; count: number }[]>();
      for (const row of attendanceWeek) {
        const key = row.date.toISOString().slice(0, 10);
        const list = weekBuckets.get(key) ?? [];
        list.push({ status: row.status as AttendanceStatus, count: row._count._all });
        weekBuckets.set(key, list);
      }
      const attendanceTrend = [...weekBuckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => ({
          date,
          ...summarizeAttendance(
            rows.flatMap((row) => Array.from({ length: row.count }, () => ({ status: row.status }))),
            policy,
          ),
        }));

      return {
        generatedAt: new Date(),
        school: { id: auth.schoolId },
        counts: {
          students,
          staff,
          classes,
          pendingLeaves,
          admissions: Object.fromEntries(admissions.map((row) => [row.status, row._count._all])),
        },
        attendance: {
          today: attendanceSummary,
          trend: attendanceTrend,
        },
        fees: {
          totalBilledMinor: totalBilled,
          totalPaidMinor: totalPaid,
          outstandingMinor: Math.max(0, totalBilled - totalPaid),
          collectionPercent:
            totalBilled === 0 ? 0 : Math.round((totalPaid / totalBilled) * 10_000) / 100,
          invoiceCount: invoices._count._all,
          overdueInvoices: overdue,
          monthCollectedMinor: payments._sum.amountMinor ?? 0,
          monthPaymentCount: payments._count._all,
        },
        notices,
        exams,
        policy,
      };
    });
  }

  /** Role-aware home screen for staff, parents and students. */
  async me(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const settings = await tx.schoolSetting.findUnique({
        where: { schoolId: auth.schoolId },
        select: { attendance: true },
      });
      const policy = attendancePolicy(settings?.attendance);
      const notices = await this.notices.portal(auth, { page: 1, pageSize: 5 });

      if (auth.roleCode === 'PARENT' || auth.roleCode === 'STUDENT') {
        const students = await linkedStudents(tx, auth);
        const children = await Promise.all(
          students.map((student) => childCard(tx, auth, student, policy)),
        );
        return {
          role: auth.roleCode,
          fullName: auth.fullName,
          children,
          notices: notices.items,
        };
      }

      const staff = await tx.staff.findFirst({
        where: { schoolId: auth.schoolId, userId: auth.userId, deletedAt: null },
        select: { id: true, employeeNo: true, firstName: true, lastName: true, employmentType: true },
      });
      const timetable = staff ? await timetableFor(tx, auth, { staffId: staff.id }) : [];
      const overview =
        auth.permissions.has('reports:read') || auth.permissions.has('dashboard:view')
          ? await this.overview(auth)
          : null;

      return {
        role: auth.roleCode,
        fullName: auth.fullName,
        staff,
        timetable,
        notices: notices.items,
        overview,
      };
    });
  }
}

async function linkedStudents(tx: TxClient, auth: AuthPrincipal) {
  if (auth.roleCode === 'STUDENT') {
    return tx.student.findMany({
      where: { schoolId: auth.schoolId, userId: auth.userId, deletedAt: null },
      include: { class: { select: { id: true, name: true } }, section: { select: { id: true, name: true } } },
    });
  }
  const guardians = await tx.guardian.findMany({
    where: { schoolId: auth.schoolId, userId: auth.userId },
    include: {
      student: {
        include: {
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
        },
      },
    },
  });
  return guardians.map((guardian) => guardian.student);
}

type LinkedStudent = Awaited<ReturnType<typeof linkedStudents>>[number];

async function childCard(
  tx: TxClient,
  auth: AuthPrincipal,
  student: LinkedStudent,
  policy: AttendancePolicy,
) {
  const since = new Date(
    new Date(`${todayIso()}T00:00:00.000Z`).getTime() - 90 * 86_400_000,
  );
  const [attendance, invoices, marks, homework, timetable, guardians] = await Promise.all([
    tx.attendanceRecord.groupBy({
      by: ['status'],
      where: {
        schoolId: auth.schoolId,
        studentId: student.id,
        date: { gte: since },
      },
      _count: { _all: true },
    }),
    tx.invoice.findMany({
      where: { schoolId: auth.schoolId, studentId: student.id, status: { not: 'VOID' } },
      orderBy: { issueDate: 'desc' },
      take: 20,
      select: {
        id: true,
        number: true,
        dueDate: true,
        status: true,
        totalMinor: true,
        paidMinor: true,
      },
    }),
    tx.mark.findMany({
      where: { schoolId: auth.schoolId, studentId: student.id },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      include: {
        examSubject: {
          include: {
            exam: { select: { id: true, name: true, status: true, publishedAt: true } },
            subject: { select: { name: true, code: true } },
          },
        },
      },
    }),
    tx.homework.findMany({
      where: {
        schoolId: auth.schoolId,
        classId: student.classId,
        sectionId: student.sectionId,
        dueDate: { gte: new Date(`${todayIso()}T00:00:00.000Z`) },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
      include: { subject: { select: { name: true } } },
    }),
    timetableFor(tx, auth, {
      classId: student.classId,
      sectionId: student.sectionId,
    }),
    tx.guardian.findMany({ where: { schoolId: auth.schoolId, studentId: student.id } }),
  ]);

  const attendanceSummary = summarizeAttendance(
    attendance.flatMap((row) =>
      Array.from({ length: row._count._all }, () => ({ status: row.status as AttendanceStatus })),
    ),
    policy,
  );
  const ledger = summarizeLedger(
    invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      totalMinor: invoice.totalMinor,
      paidMinor: invoice.paidMinor,
      status: invoice.status as InvoiceStatus,
    })),
  );

  return {
    student: {
      id: student.id,
      admissionNo: student.admissionNo,
      name: `${student.firstName} ${student.lastName}`.trim(),
      rollNo: student.rollNo,
      className: student.class.name,
      sectionName: student.section.name,
      classId: student.classId,
      sectionId: student.sectionId,
      status: student.status,
      guardians: guardians.map((guardian) => ({
        fullName: guardian.fullName,
        relation: guardian.relation,
        phone: guardian.phone,
      })),
    },
    attendance: attendanceSummary,
    fees: {
      ...ledger,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        status: invoice.status,
        totalMinor: invoice.totalMinor,
        paidMinor: invoice.paidMinor,
        outstandingMinor: Math.max(0, invoice.totalMinor - invoice.paidMinor),
      })),
    },
    results: marks
      .filter((mark) => mark.examSubject.exam.status === 'PUBLISHED')
      .map((mark) => ({
        id: mark.id,
        exam: mark.examSubject.exam.name,
        subject: mark.examSubject.subject.name,
        marksObtained: Number(mark.marksObtained),
        maxMarks: Number(mark.examSubject.maxMarks),
        isAbsent: mark.isAbsent,
      })),
    homework: homework.map((entry) => ({
      id: entry.id,
      title: entry.title,
      subject: entry.subject.name,
      dueDate: entry.dueDate.toISOString().slice(0, 10),
    })),
    timetable,
  };
}

async function timetableFor(
  tx: TxClient,
  auth: AuthPrincipal,
  filter: { classId?: string; sectionId?: string; staffId?: string },
) {
  const day = new Date().getUTCDay();
  const dayOfWeek = day === 0 ? 7 : day;
  const slots = await tx.timetableSlot.findMany({
    where: {
      schoolId: auth.schoolId,
      dayOfWeek,
      ...(filter.classId ? { classId: filter.classId } : {}),
      ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      ...(filter.staffId ? { staffId: filter.staffId } : {}),
    },
    orderBy: { periodId: 'asc' },
    include: {
      subject: { select: { name: true, code: true } },
      class: { select: { name: true } },
      section: { select: { name: true } },
      period: { select: { name: true, startTime: true, endTime: true, sequence: true } },
    },
  });
  return slots.map((slot) => ({
    id: slot.id,
    dayOfWeek: slot.dayOfWeek,
    room: slot.room,
    subject: slot.subject.name,
    subjectCode: slot.subject.code,
    className: slot.class.name,
    sectionName: slot.section.name,
    period: slot.period,
  }));
}

function todayRecords(
  rows: { status: string; _count: { _all: number } }[],
): { status: AttendanceStatus }[] {
  return rows.flatMap((row) =>
    Array.from({ length: row._count._all }, () => ({ status: row.status as AttendanceStatus })),
  );
}

function attendancePolicy(value: unknown): AttendancePolicy {
  const stored = (value ?? {}) as Partial<AttendancePolicy>;
  return {
    lateCountsPresent: stored.lateCountsPresent ?? DEFAULT_ATTENDANCE_POLICY.lateCountsPresent,
    halfDayWeight: stored.halfDayWeight ?? DEFAULT_ATTENDANCE_POLICY.halfDayWeight,
    excludeLeaveFromDenominator:
      stored.excludeLeaveFromDenominator ?? DEFAULT_ATTENDANCE_POLICY.excludeLeaveFromDenominator,
    lowAttendanceThreshold:
      stored.lowAttendanceThreshold ?? DEFAULT_ATTENDANCE_POLICY.lowAttendanceThreshold,
  };
}
