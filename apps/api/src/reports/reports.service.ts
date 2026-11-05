import { Injectable } from '@nestjs/common';
import {
  NotFoundError,
  agingBuckets,
  fillMonthlySeries,
  percentChange,
  safePercent,
  todayIso,
  uuidv7,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, withTenantRead, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { attendanceRollupCovers, feeRollupCovers, refreshAttendanceRollup, refreshFeeRollup } from './rollups';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const REPORT_KEYS = [
  'overview',
  'enrollment',
  'attendance',
  'fees',
  'payroll',
  'modules',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const rangeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  classId: z.string().uuid().optional(),
});

export const savedReportConfigSchema = rangeQuerySchema.extend({
  report: z.enum(REPORT_KEYS),
});
export type SavedReportConfig = z.infer<typeof savedReportConfigSchema>;

export const saveReportSchema = z.object({
  name: z.string().trim().min(2).max(80),
  config: savedReportConfigSchema,
  isDefault: z.boolean().default(false),
});
export type SaveReportInput = z.infer<typeof saveReportSchema>;

const SAVED_REPORT_RESOURCE = 'reports';

@Injectable()
export class ReportsService {
  constructor(private readonly audit: AuditService) {}

  async enrollment(auth: AuthPrincipal) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      const [students, classes, sections, byStatus, byGender, byClass] = await Promise.all([
        tx.student.count({ where: { schoolId: auth.schoolId, deletedAt: null } }),
        tx.class.count({ where: { schoolId: auth.schoolId } }),
        tx.section.count({ where: { schoolId: auth.schoolId } }),
        tx.student.groupBy({
          by: ['status'],
          where: { schoolId: auth.schoolId, deletedAt: null },
          _count: { _all: true },
        }),
        tx.student.groupBy({
          by: ['gender'],
          where: { schoolId: auth.schoolId, deletedAt: null },
          _count: { _all: true },
        }),
        tx.student.groupBy({
          by: ['classId', 'sectionId'],
          where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' },
          _count: { _all: true },
        }),
      ]);
      const classIds = [...new Set(byClass.map((row) => row.classId))];
      const sectionIds = [...new Set(byClass.map((row) => row.sectionId))];
      const [classRows, sectionRows] = await Promise.all([
        tx.class.findMany({ where: { schoolId: auth.schoolId, id: { in: classIds } } }),
        tx.section.findMany({ where: { schoolId: auth.schoolId, id: { in: sectionIds } } }),
      ]);
      const classMap = new Map(classRows.map((row) => [row.id, row.name]));
      const sectionMap = new Map(sectionRows.map((row) => [row.id, row.name]));
      return {
        students,
        classes,
        sections,
        byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
        byGender: byGender.map((row) => ({ gender: row.gender, count: row._count._all })),
        byClassSection: byClass.map((row) => ({
          classId: row.classId,
          className: classMap.get(row.classId) ?? 'Unknown',
          sectionId: row.sectionId,
          sectionName: sectionMap.get(row.sectionId) ?? 'Unknown',
          count: row._count._all,
        })),
      };
    });
  }

  async attendance(auth: AuthPrincipal, query: z.infer<typeof rangeQuerySchema>) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      const from = query.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
      const to = query.to ?? todayIso();
      const range = { from, to };
      const useRollup =
        !query.classId && (await attendanceRollupCovers(tx, auth.schoolId, range));

      if (useRollup) {
        const rollup = await tx.reportDailyAttendance.findMany({
          where: { schoolId: auth.schoolId, date: { gte: dateValue(from), lte: dateValue(to) } },
          orderBy: [{ date: 'asc' }, { status: 'asc' }],
        });
        const byDay = new Map<string, { present: number; total: number }>();
        const byStatus = new Map<string, number>();
        for (const row of rollup) {
          const key = row.date.toISOString().slice(0, 10);
          const entry = byDay.get(key) ?? { present: 0, total: 0 };
          entry.total += row.count;
          if (['PRESENT', 'LATE', 'HALF_DAY'].includes(row.status)) entry.present += row.count;
          byDay.set(key, entry);
          byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);
        }
        const total = rollup.reduce((sum, row) => sum + row.count, 0);
        const present = [...byStatus.entries()]
          .filter(([status]) => ['PRESENT', 'LATE', 'HALF_DAY'].includes(status))
          .reduce((sum, [, count]) => sum + count, 0);
        return {
          from,
          to,
          source: 'rollup' as const,
          total,
          present,
          rate: safePercent(present, total),
          byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
          daily: [...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, entry]) => ({
              date,
              present: entry.present,
              total: entry.total,
              rate: safePercent(entry.present, entry.total),
            })),
        };
      }

      const rows = await tx.attendanceRecord.groupBy({
        by: ['status'],
        where: {
          schoolId: auth.schoolId,
          date: { gte: dateValue(from), lte: dateValue(to) },
        },
        _count: { _all: true },
      });
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      const present = rows
        .filter((row) => row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'HALF_DAY')
        .reduce((sum, row) => sum + row._count._all, 0);
      const daily = await tx.attendanceRecord.findMany({
        where: {
          schoolId: auth.schoolId,
          date: { gte: dateValue(from), lte: dateValue(to) },
          ...(query.classId ? { session: { classId: query.classId } } : {}),
        },
        select: { date: true, status: true },
        take: 20_000,
      });
      const byDay = new Map<string, { present: number; total: number }>();
      for (const row of daily) {
        const key = row.date.toISOString().slice(0, 10);
        const entry = byDay.get(key) ?? { present: 0, total: 0 };
        entry.total += 1;
        if (row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'HALF_DAY') entry.present += 1;
        byDay.set(key, entry);
      }
      return {
        from,
        to,
        source: 'live' as const,
        total,
        present,
        rate: safePercent(present, total),
        byStatus: rows.map((row) => ({ status: row.status, count: row._count._all })),
        daily: [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, entry]) => ({
            date,
            present: entry.present,
            total: entry.total,
            rate: safePercent(entry.present, entry.total),
          })),
      };
    });
  }

  async fees(auth: AuthPrincipal, query: z.infer<typeof rangeQuerySchema>) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      const from = query.from ?? new Date(Date.now() - 179 * 86_400_000).toISOString().slice(0, 10);
      const to = query.to ?? todayIso();
      const range = { from, to };
      const useRollup = await feeRollupCovers(tx, auth.schoolId, range);

      const [openInvoices, billed, expenses, rollupRows, livePayments] = await Promise.all([
        tx.invoice.findMany({
          where: { schoolId: auth.schoolId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
          select: { dueDate: true, totalMinor: true, paidMinor: true },
        }),
        tx.invoice.aggregate({
          where: {
            schoolId: auth.schoolId,
            issueDate: { gte: dateValue(from), lte: dateValue(to) },
          },
          _sum: { totalMinor: true, paidMinor: true, discountMinor: true },
        }),
        tx.expense.aggregate({
          where: {
            schoolId: auth.schoolId,
            paidAt: { gte: dateValue(from), lte: dateValue(to) },
          },
          _sum: { amountMinor: true },
        }),
        useRollup
          ? tx.reportFeeCollection.findMany({
              where: {
                schoolId: auth.schoolId,
                date: { gte: dateValue(from), lte: dateValue(to) },
              },
              orderBy: { date: 'asc' },
            })
          : Promise.resolve([]),
        useRollup
          ? Promise.resolve([])
          : tx.payment.findMany({
              where: {
                schoolId: auth.schoolId,
                status: 'POSTED',
                paidAt: { gte: dateValue(from), lte: endOfDay(to) },
              },
              select: { paidAt: true, amountMinor: true, method: true },
            }),
      ]);

      const months = monthRange(from, to);
      const byMonth = new Map<string, number>();
      const methodCounts = new Map<string, number>();
      let collectedMinor = 0;

      if (useRollup) {
        for (const row of rollupRows) {
          const period = row.date.toISOString().slice(0, 7);
          byMonth.set(period, (byMonth.get(period) ?? 0) + row.amountMinor);
          methodCounts.set(row.method, (methodCounts.get(row.method) ?? 0) + row.count);
          collectedMinor += row.amountMinor;
        }
      } else {
        for (const payment of livePayments) {
          const period = payment.paidAt.toISOString().slice(0, 7);
          byMonth.set(period, (byMonth.get(period) ?? 0) + payment.amountMinor);
          methodCounts.set(payment.method, (methodCounts.get(payment.method) ?? 0) + 1);
          collectedMinor += payment.amountMinor;
        }
      }

      const series = fillMonthlySeries(
        [...byMonth.entries()].map(([period, value]) => ({ period, value })),
        months,
        (row) => row.value,
      );
      const aging = agingBuckets(
        openInvoices.map((invoice) => ({
          dueDate: invoice.dueDate,
          outstandingMinor: invoice.totalMinor - invoice.paidMinor,
        })),
      );
      return {
        from,
        to,
        source: useRollup ? ('rollup' as const) : ('live' as const),
        collectedMinor,
        billedMinor: billed._sum.totalMinor ?? 0,
        outstandingMinor: openInvoices.reduce(
          (sum, invoice) => sum + invoice.totalMinor - invoice.paidMinor,
          0,
        ),
        expensesMinor: expenses._sum.amountMinor ?? 0,
        series,
        aging,
        methods: [...methodCounts.entries()].map(([key, count]) => ({ key, count })),
      };
    });
  }

  async payroll(auth: AuthPrincipal) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      const runs = await tx.payrollRun.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 12,
        include: { _count: { select: { payslips: true } } },
      });
      const latest = runs[0];
      const payslips = latest
        ? await tx.payslip.findMany({ where: { schoolId: auth.schoolId, payrollRunId: latest.id } })
        : [];
      return {
        runs: runs.map((run) => ({ ...run, payslipCount: run._count.payslips })),
        latest: latest
          ? {
              run: latest,
              grossMinor: payslips.reduce(
                (sum, slip) => sum + slip.baseMinor + slip.allowancesMinor,
                0,
              ),
              deductionsMinor: payslips.reduce(
                (sum, slip) => sum + slip.deductionsMinor,
                0,
              ),
              netMinor: payslips.reduce((sum, slip) => sum + slip.netMinor, 0),
            }
          : null,
      };
    });
  }

  async overview(auth: AuthPrincipal) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      const today = todayIso();
      const thisMonthStart = dateValue(`${today.slice(0, 7)}-01`);
      const lastMonthStart = new Date(thisMonthStart);
      lastMonthStart.setUTCMonth(lastMonthStart.getUTCMonth() - 1);

      const [
        students,
        previousStudents,
        staff,
        currentPayments,
        previousPayments,
        openInvoices,
        attendanceRows,
        pendingAdmissions,
      ] = await Promise.all([
        tx.student.count({ where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' } }),
        tx.student.count({
          where: {
            schoolId: auth.schoolId,
            deletedAt: null,
            createdAt: { lt: thisMonthStart },
          },
        }),
        tx.staff.count({ where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' } }),
        tx.payment.aggregate({
          where: { schoolId: auth.schoolId, status: 'POSTED', paidAt: { gte: thisMonthStart } },
          _sum: { amountMinor: true },
        }),
        tx.payment.aggregate({
          where: {
            schoolId: auth.schoolId,
            status: 'POSTED',
            paidAt: { gte: lastMonthStart, lt: thisMonthStart },
          },
          _sum: { amountMinor: true },
        }),
        tx.invoice.findMany({
          where: { schoolId: auth.schoolId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
          select: { dueDate: true, totalMinor: true, paidMinor: true },
        }),
        tx.attendanceRecord.groupBy({
          by: ['status'],
          where: { schoolId: auth.schoolId, date: { gte: dateValue(today) } },
          _count: { _all: true },
        }),
        tx.admissionApplication.count({
          where: {
            schoolId: auth.schoolId,
            status: { in: ['INQUIRY', 'APPLIED', 'DOCUMENTS_PENDING'] },
          },
        }),
      ]);

      const attendanceTotal = attendanceRows.reduce((sum, row) => sum + row._count._all, 0);
      const attendancePresent = attendanceRows
        .filter((row) => row.status === 'PRESENT' || row.status === 'LATE' || row.status === 'HALF_DAY')
        .reduce((sum, row) => sum + row._count._all, 0);
      const collected = currentPayments._sum.amountMinor ?? 0;
      const previousCollected = previousPayments._sum.amountMinor ?? 0;
      return {
        students,
        studentGrowthPercent: percentChange(students, previousStudents),
        staff,
        collectedThisMonthMinor: collected,
        collectionChangePercent: percentChange(collected, previousCollected),
        outstandingMinor: openInvoices.reduce(
          (sum, invoice) => sum + invoice.totalMinor - invoice.paidMinor,
          0,
        ),
        attendanceRate: safePercent(attendancePresent, attendanceTotal),
        pendingAdmissions,
        aging: agingBuckets(
          openInvoices.map((invoice) => ({
            dueDate: invoice.dueDate,
            outstandingMinor: invoice.totalMinor - invoice.paidMinor,
          })),
        ),
      };
    });
  }

  async moduleSummary(auth: AuthPrincipal) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      const [libraryBooks, libraryIssued, routes, hostelBeds, inventoryItems, threads] =
        await Promise.all([
          tx.libraryBook.count({ where: { schoolId: auth.schoolId } }),
          tx.libraryIssue.count({ where: { schoolId: auth.schoolId, status: 'ISSUED' } }),
          tx.transportRoute.count({ where: { schoolId: auth.schoolId, active: true } }),
          tx.hostelRoom.aggregate({
            where: { schoolId: auth.schoolId },
            _sum: { capacity: true, occupied: true },
          }),
          tx.inventoryItem.count({ where: { schoolId: auth.schoolId } }),
          tx.messageThread.count({ where: { schoolId: auth.schoolId } }),
        ]);
      return {
        libraryBooks,
        libraryIssued,
        transportRoutes: routes,
        hostelBeds: hostelBeds._sum.capacity ?? 0,
        hostelOccupied: hostelBeds._sum.occupied ?? 0,
        inventoryItems,
        messageThreads: threads,
      };
    });
  }

  async refreshRollups(
    auth: AuthPrincipal,
    query: z.infer<typeof rangeQuerySchema>,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const to = query.to ?? todayIso();
      const from =
        query.from ??
        new Date(new Date(`${to}T00:00:00.000Z`).getTime() - 29 * 86_400_000)
          .toISOString()
          .slice(0, 10);
      const attendance = await refreshAttendanceRollup(tx, auth.schoolId, { from, to });
      const fees = await refreshFeeRollup(tx, auth.schoolId, { from, to });
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
          action: 'report.rollups_refreshed',
          entity: 'ReportRollup',
          after: { from, to, attendance, fees },
        },
      );
      return { from, to, attendance, fees };
    });
  }

  async savedReports(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const rows = await tx.savedView.findMany({
        where: { schoolId: auth.schoolId, userId: auth.userId, resource: SAVED_REPORT_RESOURCE },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        config: row.config,
        isDefault: row.isDefault,
        createdAt: row.createdAt,
      }));
    });
  }

  async saveReport(
    auth: AuthPrincipal,
    input: SaveReportInput,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      if (input.isDefault) {
        await tx.savedView.updateMany({
          where: {
            schoolId: auth.schoolId,
            userId: auth.userId,
            resource: SAVED_REPORT_RESOURCE,
          },
          data: { isDefault: false },
        });
      }
      const existing = await tx.savedView.findUnique({
        where: {
          userId_resource_name: {
            userId: auth.userId,
            resource: SAVED_REPORT_RESOURCE,
            name: input.name,
          },
        },
      });
      const saved = existing
        ? await tx.savedView.update({
            where: { id: existing.id },
            data: { config: input.config as never, isDefault: input.isDefault },
          })
        : await tx.savedView.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              userId: auth.userId,
              resource: SAVED_REPORT_RESOURCE,
              name: input.name,
              config: input.config as never,
              isDefault: input.isDefault,
            },
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
          action: existing ? 'report.saved_view_updated' : 'report.saved_view_created',
          entity: 'SavedView',
          entityId: saved.id,
          after: { name: saved.name, config: input.config },
        },
      );
      return {
        id: saved.id,
        name: saved.name,
        config: saved.config,
        isDefault: saved.isDefault,
        createdAt: saved.createdAt,
      };
    });
  }

  async deleteSavedReport(
    auth: AuthPrincipal,
    id: string,
    meta: { requestId: string; ip?: string; userAgent?: string },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const saved = await tx.savedView.findFirst({
        where: {
          id,
          schoolId: auth.schoolId,
          userId: auth.userId,
          resource: SAVED_REPORT_RESOURCE,
        },
      });
      if (!saved) throw new NotFoundError('Saved report');
      await tx.savedView.delete({ where: { id } });
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
          action: 'report.saved_view_deleted',
          entity: 'SavedView',
          entityId: id,
          before: { name: saved.name },
        },
      );
      return { deleted: true };
    });
  }

  async runSavedReport(auth: AuthPrincipal, id: string) {
    const saved = await this.getSavedReport(auth, id);
    const data = await this.executeReport(auth, saved.config);
    return { saved: { id: saved.id, name: saved.name }, data };
  }

  async exportSavedReport(auth: AuthPrincipal, id: string) {
    const saved = await this.getSavedReport(auth, id);
    const csv = await this.exportCsv(auth, saved.config.report, saved.config);
    return {
      fileName: `${saved.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.csv`,
      csv,
    };
  }

  private async getSavedReport(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const saved = await tx.savedView.findFirst({
        where: {
          id,
          schoolId: auth.schoolId,
          userId: auth.userId,
          resource: SAVED_REPORT_RESOURCE,
        },
      });
      if (!saved) throw new NotFoundError('Saved report');
      return { id: saved.id, name: saved.name, config: saved.config as SavedReportConfig };
    });
  }

  private async executeReport(auth: AuthPrincipal, config: SavedReportConfig) {
    switch (config.report) {
      case 'overview':
        return this.overview(auth);
      case 'enrollment':
        return this.enrollment(auth);
      case 'attendance':
        return this.attendance(auth, config);
      case 'fees':
        return this.fees(auth, config);
      case 'payroll':
        return this.payroll(auth);
      case 'modules':
        return this.moduleSummary(auth);
    }
  }

  async exportCsv(
    auth: AuthPrincipal,
    report: ReportKey,
    query: { from?: string; to?: string; classId?: string } = {},
  ) {
    return withTenantRead({ schoolId: auth.schoolId }, async (tx) => {
      if (report === 'enrollment') {
        const students = await tx.student.findMany({
          where: { schoolId: auth.schoolId, deletedAt: null },
          include: { class: { select: { name: true } }, section: { select: { name: true } } },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        });
        return csv(
          ['admissionNo', 'firstName', 'lastName', 'gender', 'class', 'section', 'status', 'admissionDate'],
          students.map((student) => [
            student.admissionNo,
            student.firstName,
            student.lastName,
            student.gender,
            student.class.name,
            student.section.name,
            student.status,
            student.admissionDate.toISOString().slice(0, 10),
          ]),
        );
      }
      if (report === 'attendance') {
        const from = query.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
        const to = query.to ?? todayIso();
        const records = await tx.attendanceRecord.findMany({
          where: {
            schoolId: auth.schoolId,
            date: { gte: dateValue(from), lte: dateValue(to) },
            ...(query.classId ? { session: { classId: query.classId } } : {}),
          },
          select: { date: true, status: true },
          take: 20_000,
        });
        const byDay = new Map<string, { present: number; total: number }>();
        for (const record of records) {
          const key = record.date.toISOString().slice(0, 10);
          const entry = byDay.get(key) ?? { present: 0, total: 0 };
          entry.total += 1;
          if (['PRESENT', 'LATE', 'HALF_DAY'].includes(record.status)) entry.present += 1;
          byDay.set(key, entry);
        }
        return csv(
          ['date', 'present', 'total', 'rate'],
          [...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, entry]) => [
              date,
              String(entry.present),
              String(entry.total),
              String(safePercent(entry.present, entry.total)),
            ]),
        );
      }

      if (report === 'payroll') {
        const run = await tx.payrollRun.findFirst({
          where: { schoolId: auth.schoolId },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        const slips = run
          ? await tx.payslip.findMany({
              where: { schoolId: auth.schoolId, payrollRunId: run.id },
              include: {
                staff: { select: { employeeNo: true, firstName: true, lastName: true } },
              },
              orderBy: { staff: { employeeNo: 'asc' } },
            })
          : [];
        return csv(
          ['period', 'employeeNo', 'staff', 'baseMinor', 'allowancesMinor', 'deductionsMinor', 'netMinor'],
          slips.map((slip) => [
            run ? `${run.year}-${String(run.month).padStart(2, '0')}` : '',
            slip.staff.employeeNo,
            `${slip.staff.firstName} ${slip.staff.lastName}`.trim(),
            String(slip.baseMinor),
            String(slip.allowancesMinor),
            String(slip.deductionsMinor),
            String(slip.netMinor),
          ]),
        );
      }

      if (report === 'modules') {
        const [books, issued, routes, rooms, items, threads] = await Promise.all([
          tx.libraryBook.count({ where: { schoolId: auth.schoolId } }),
          tx.libraryIssue.count({ where: { schoolId: auth.schoolId, status: 'ISSUED' } }),
          tx.transportRoute.count({ where: { schoolId: auth.schoolId, active: true } }),
          tx.hostelRoom.aggregate({
            where: { schoolId: auth.schoolId },
            _sum: { capacity: true, occupied: true },
          }),
          tx.inventoryItem.count({ where: { schoolId: auth.schoolId } }),
          tx.messageThread.count({ where: { schoolId: auth.schoolId } }),
        ]);
        return csv(
          ['module', 'metric', 'value'],
          [
            ['library', 'books', String(books)],
            ['library', 'issued', String(issued)],
            ['transport', 'activeRoutes', String(routes)],
            ['hostel', 'beds', String(rooms._sum.capacity ?? 0)],
            ['hostel', 'occupied', String(rooms._sum.occupied ?? 0)],
            ['inventory', 'items', String(items)],
            ['messaging', 'threads', String(threads)],
          ],
        );
      }

      if (report === 'overview') {
        const [students, staff, invoices, payments] = await Promise.all([
          tx.student.count({ where: { schoolId: auth.schoolId, deletedAt: null } }),
          tx.staff.count({ where: { schoolId: auth.schoolId, deletedAt: null } }),
          tx.invoice.count({ where: { schoolId: auth.schoolId } }),
          tx.payment.count({ where: { schoolId: auth.schoolId, status: 'POSTED' } }),
        ]);
        return csv(
          ['metric', 'value'],
          [
            ['students', String(students)],
            ['staff', String(staff)],
            ['invoices', String(invoices)],
            ['payments', String(payments)],
          ],
        );
      }

      const invoices = await tx.invoice.findMany({
        where: { schoolId: auth.schoolId },
        include: { student: { select: { admissionNo: true, firstName: true, lastName: true } } },
        orderBy: { issueDate: 'desc' },
      });
      return csv(
        ['number', 'admissionNo', 'student', 'issueDate', 'dueDate', 'totalMinor', 'paidMinor', 'status'],
        invoices.map((invoice) => [
          invoice.number,
          invoice.student.admissionNo,
          `${invoice.student.firstName} ${invoice.student.lastName}`.trim(),
          invoice.issueDate.toISOString().slice(0, 10),
          invoice.dueDate.toISOString().slice(0, 10),
          String(invoice.totalMinor),
          String(invoice.paidMinor),
          invoice.status,
        ]),
      );
    });
  }
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
  const last = new Date(`${to.slice(0, 7)}-01T00:00:00.000Z`);
  while (cursor <= last && months.length < 60) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function csv(headers: string[], rows: string[][]): string {
  const escape = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
}

export type ReportsTx = TxClient;
