import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, uuidv7, computePayslip } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const createPayrollRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export const generatePayslipsSchema = z.object({
  payrollRunId: z.string().uuid(),
  includeInactive: z.boolean().default(false),
  overrideAllowancesMinor: z.number().int().min(0).optional(),
  overrideDeductionsMinor: z.number().int().min(0).optional(),
  overrideTaxMinor: z.number().int().min(0).optional(),
});

@Injectable()
export class PayrollService {
  constructor(private readonly audit: AuditService) {}

  async listRuns(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const runs = await tx.payrollRun.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: { _count: { select: { payslips: true } } },
      });
      return runs.map((run) => ({ ...run, payslipCount: run._count.payslips }));
    });
  }

  async getRun(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id, schoolId: auth.schoolId },
        include: {
          payslips: {
            include: {
              staff: { select: { id: true, firstName: true, lastName: true, employeeNo: true } },
            },
            orderBy: { staff: { firstName: 'asc' } },
          },
        },
      });
      if (!run) throw new NotFoundError('Payroll run');
      return {
        ...run,
        payslips: run.payslips.map((payslip) => ({
          ...payslip,
          staffName: `${payslip.staff.firstName} ${payslip.staff.lastName}`.trim(),
          employeeNo: payslip.staff.employeeNo,
        })),
      };
    });
  }

  async createRun(auth: AuthPrincipal, input: z.infer<typeof createPayrollRunSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.payrollRun.findFirst({
        where: { schoolId: auth.schoolId, year: input.year, month: input.month },
        select: { id: true },
      });
      if (existing) throw new ConflictError('Payroll run already exists for this period');
      const run = await tx.payrollRun.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          year: input.year,
          month: input.month,
          status: 'DRAFT',
          totalMinor: 0,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'payroll.run_created',
        entity: 'PayrollRun',
        entityId: run.id,
        after: { year: run.year, month: run.month },
      });
      return run;
    });
  }

  async generatePayslips(
    auth: AuthPrincipal,
    input: z.infer<typeof generatePayslipsSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: input.payrollRunId, schoolId: auth.schoolId },
      });
      if (!run) throw new NotFoundError('Payroll run');
      if (run.status === 'PROCESSED' || run.status === 'PAID') {
        throw new ConflictError('Payslips cannot be regenerated for a processed run');
      }

      const staffList = await tx.staff.findMany({
        where: {
          schoolId: auth.schoolId,
          deletedAt: null,
          ...(input.includeInactive ? {} : { status: { in: ['ACTIVE', 'ON_LEAVE'] } }),
        },
        select: { id: true, baseSalaryMinor: true },
      });
      let totalMinor = 0;
      for (const staff of staffList) {
        const base = staff.baseSalaryMinor ?? 0;
        const totals = computePayslip({
          baseMinor: base,
          allowancesMinor: input.overrideAllowancesMinor,
          deductionsMinor: input.overrideDeductionsMinor,
          taxMinor: input.overrideTaxMinor,
        });
        await tx.payslip.upsert({
          where: { payrollRunId_staffId: { payrollRunId: run.id, staffId: staff.id } },
          create: {
            id: uuidv7(),
            schoolId: auth.schoolId,
            payrollRunId: run.id,
            staffId: staff.id,
            baseMinor: totals.baseMinor,
            allowancesMinor: totals.allowancesMinor,
            deductionsMinor: totals.deductionsMinor,
            netMinor: totals.netMinor,
          },
          update: {
            baseMinor: totals.baseMinor,
            allowancesMinor: totals.allowancesMinor,
            deductionsMinor: totals.deductionsMinor,
            netMinor: totals.netMinor,
          },
        });
        totalMinor += totals.netMinor;
      }
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { totalMinor },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'payroll.payslips_generated',
        entity: 'PayrollRun',
        entityId: run.id,
        after: { count: staffList.length, totalMinor },
      });
      return { runId: run.id, count: staffList.length, totalMinor: updated.totalMinor };
    });
  }

  async processRun(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id, schoolId: auth.schoolId },
        include: { _count: { select: { payslips: true } } },
      });
      if (!run) throw new NotFoundError('Payroll run');
      if (run._count.payslips === 0) throw new ConflictError('Add payslips before processing');
      if (run.status !== 'DRAFT') throw new ConflictError('Only draft runs can be processed');
      const updated = await tx.payrollRun.update({
        where: { id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'payroll.run_processed',
        entity: 'PayrollRun',
        entityId: id,
      });
      return updated;
    });
  }

  async myPayslips(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const staff = await tx.staff.findFirst({ where: { schoolId: auth.schoolId, userId: auth.userId } });
      if (!staff) return { items: [] };
      const payslips = await tx.payslip.findMany({
        where: { schoolId: auth.schoolId, staffId: staff.id },
        orderBy: { createdAt: 'desc' },
        include: { payrollRun: { select: { year: true, month: true, status: true } } },
      });
      return { items: payslips };
    });
  }
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
