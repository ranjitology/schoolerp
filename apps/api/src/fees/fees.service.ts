import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AppError,
  ConflictError,
  NotFoundError,
  allocatePayment,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  differenceInDays,
  feeHeadSchema,
  feeStructureSchema,
  fiscalYearFor,
  paymentMethodSchema,
  percentOfMinor,
  receiptNumber,
  summarizeLedger,
  todayIso,
  uuidv7,
  type AllocatableInvoice,
  type InvoiceStatus,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import {
  postExpense,
  postInvoiceIssued,
  postPaymentReceived,
  postRefund,
} from '../ledger/ledger.posting';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

interface StoredFeeSettings {
  receiptPrefix?: string;
  fiscalYearStartMonth?: number;
  fiscalYearStartDay?: number;
  allowAdvancePayment?: boolean;
}

export const generateInvoicesSchema = z.object({
  academicYearId: z.string().uuid(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Only generate for students who do not yet have a live invoice this year. */
  skipExisting: z.boolean().default(true),
  dryRun: z.boolean().default(false),
});
export type GenerateInvoicesInput = z.infer<typeof generateInvoicesSchema>;

export const recordPaymentRequestSchema = z.object({
  studentId: z.string().uuid(),
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  method: paymentMethodSchema,
  paidAt: z.string().datetime({ offset: true }),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
  invoiceIds: z.array(z.string().uuid()).max(50).optional(),
  deviceId: z.string().uuid().optional(),
  offlineReceiptNumber: z.string().trim().max(40).optional(),
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;

export const refundRequestSchema = z.object({
  paymentId: z.string().uuid(),
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  reason: z.string().trim().min(3).max(500),
  method: paymentMethodSchema,
  refundedAt: z.string().datetime({ offset: true }),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export const expenseRequestSchema = z.object({
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(2).max(500),
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: paymentMethodSchema,
  receiptKey: z.string().trim().max(500).optional(),
});

export const feeSummaryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const defaulterQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minOverdueDays: z.coerce.number().int().min(0).max(3650).default(0),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@Injectable()
export class FeesService {
  constructor(private readonly audit: AuditService) {}

  async heads(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.feeHead.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { feeStructures: true } } },
      }),
    );
  }

  async createHead(auth: AuthPrincipal, input: z.infer<typeof feeHeadSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const head = await tx.feeHead.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          name: input.name,
          code: input.code,
          description: input.description ?? null,
          isRecurring: input.isRecurring,
          isActive: input.isActive,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'fee_head.created',
        entity: 'FeeHead',
        entityId: head.id,
        after: { code: head.code, name: head.name },
      });
      return head;
    });
  }

  async updateHead(
    auth: AuthPrincipal,
    id: string,
    input: Partial<z.infer<typeof feeHeadSchema>>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.feeHead.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Fee head');
      const head = await tx.feeHead.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
          ...(input.isRecurring !== undefined ? { isRecurring: input.isRecurring } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'fee_head.updated',
        entity: 'FeeHead',
        entityId: id,
        before: { name: current.name, code: current.code, isActive: current.isActive },
        after: { name: head.name, code: head.code, isActive: head.isActive },
      });
      return head;
    });
  }

  async structures(auth: AuthPrincipal, query: { academicYearId?: string; classId?: string }) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.feeStructure.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
          ...(query.classId ? { classId: query.classId } : {}),
        },
        orderBy: [{ classId: 'asc' }, { createdAt: 'asc' }],
        include: {
          feeHead: { select: { id: true, name: true, code: true, isActive: true } },
          class: { select: { id: true, name: true } },
          academicYear: { select: { id: true, name: true } },
        },
      }),
    );
  }

  async upsertStructure(
    auth: AuthPrincipal,
    input: z.infer<typeof feeStructureSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.feeStructure.findFirst({
        where: {
          schoolId: auth.schoolId,
          academicYearId: input.academicYearId,
          classId: input.classId,
          feeHeadId: input.feeHeadId,
        },
        select: { id: true, amountMinor: true },
      });
      const structure = existing
        ? await tx.feeStructure.update({
            where: { id: existing.id },
            data: {
              amountMinor: input.amountMinor,
              installments: input.installments,
              dueDay: input.dueDay,
            },
            include: {
              feeHead: { select: { id: true, name: true, code: true } },
              class: { select: { id: true, name: true } },
            },
          })
        : await tx.feeStructure.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              academicYearId: input.academicYearId,
              classId: input.classId,
              feeHeadId: input.feeHeadId,
              amountMinor: input.amountMinor,
              installments: input.installments,
              dueDay: input.dueDay,
            },
            include: {
              feeHead: { select: { id: true, name: true, code: true } },
              class: { select: { id: true, name: true } },
            },
          });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: existing ? 'fee_structure.updated' : 'fee_structure.created',
        entity: 'FeeStructure',
        entityId: structure.id,
        before: existing ? { amountMinor: existing.amountMinor } : undefined,
        after: { amountMinor: structure.amountMinor, classId: input.classId },
      });
      return structure;
    });
  }

  async deleteStructure(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const structure = await tx.feeStructure.findFirst({
        where: { id, schoolId: auth.schoolId },
        select: { id: true, amountMinor: true, classId: true },
      });
      if (!structure) throw new NotFoundError('Fee structure');
      await tx.feeStructure.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'fee_structure.deleted',
        entity: 'FeeStructure',
        entityId: id,
        before: { amountMinor: structure.amountMinor, classId: structure.classId },
      });
      return { deleted: true };
    });
  }

  async generateInvoices(auth: AuthPrincipal, input: GenerateInvoicesInput, meta: AuditMeta) {
    return withTenant(
      { schoolId: auth.schoolId },
      async (tx) => {
        if (input.sectionId && !input.classId) {
          throw new AppError('VALIDATION_FAILED', 'Select a class when generating for a section', 422);
        }
        const [settings, year] = await Promise.all([
          tx.schoolSetting.findUnique({ where: { schoolId: auth.schoolId }, select: { fees: true } }),
          tx.academicYear.findFirst({
            where: { id: input.academicYearId, schoolId: auth.schoolId },
            select: { id: true, name: true },
          }),
        ]);
        if (!year) throw new NotFoundError('Academic year');
        const feeSettings = storedSettings(settings?.fees);

        const structures = await tx.feeStructure.findMany({
          where: {
            schoolId: auth.schoolId,
            academicYearId: input.academicYearId,
            ...(input.classId ? { classId: input.classId } : {}),
          },
          include: { feeHead: { select: { name: true } } },
        });
        if (structures.length === 0) {
          throw new AppError('VALIDATION_FAILED', 'No fee structure is configured for this year', 422);
        }

        const byClass = new Map<string, typeof structures>();
        for (const structure of structures) {
          const list = byClass.get(structure.classId) ?? [];
          list.push(structure);
          byClass.set(structure.classId, list);
        }

        const students = await tx.student.findMany({
          where: {
            schoolId: auth.schoolId,
            deletedAt: null,
            status: 'ACTIVE',
            classId: { in: [...byClass.keys()] },
            ...(input.sectionId ? { sectionId: input.sectionId } : {}),
          },
          select: { id: true, admissionNo: true, classId: true, firstName: true, lastName: true },
        });

        const existing = input.skipExisting
          ? await tx.invoice.findMany({
              where: {
                schoolId: auth.schoolId,
                academicYearId: input.academicYearId,
                studentId: { in: students.map((student) => student.id) },
                status: { notIn: ['VOID', 'DRAFT'] },
              },
              select: { studentId: true },
            })
          : [];
        const skip = new Set(existing.map((row) => row.studentId));

        const issueDate = input.issueDate ?? todayIso();
        const [discounts, sequencePrefix] = await Promise.all([
          tx.studentDiscount.findMany({
            where: {
              schoolId: auth.schoolId,
              studentId: { in: students.map((student) => student.id) },
            },
          }),
          Promise.resolve(feeSettings.receiptPrefix ?? 'RCPT'),
        ]);

        const generated: {
          studentId: string;
          admissionNo: string;
          name: string;
          invoiceId?: string;
          number?: string;
          totalMinor: number;
        }[] = [];

        for (const student of students) {
          if (skip.has(student.id)) continue;
          const studentStructures = byClass.get(student.classId) ?? [];
          if (studentStructures.length === 0) continue;

          const lines = studentStructures.map((structure) => {
            const amount = structure.amountMinor;
            const discount = discountFor(
              discounts.filter((row) => row.studentId === student.id),
              structure.feeHeadId,
              amount,
              issueDate,
            );
            return {
              feeHeadId: structure.feeHeadId,
              description: structure.feeHead.name,
              amountMinor: amount,
              discountMinor: discount,
            };
          });
          const totals = computeInvoiceTotals(lines);

          if (input.dryRun) {
            generated.push({
              studentId: student.id,
              admissionNo: student.admissionNo,
              name: `${student.firstName} ${student.lastName}`.trim(),
              totalMinor: totals.totalMinor,
            });
            continue;
          }

          const number = await nextDocumentNumber(
            tx,
            auth.schoolId,
            'invoice',
            'INV',
            issueDate,
            feeSettings,
          );
          const invoice = await tx.invoice.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              studentId: student.id,
              academicYearId: input.academicYearId,
              number,
              issueDate: date(issueDate),
              dueDate: date(input.dueDate),
              subtotalMinor: totals.subtotalMinor,
              discountMinor: totals.discountMinor,
              fineMinor: totals.fineMinor,
              totalMinor: totals.totalMinor,
              paidMinor: 0,
              status: 'ISSUED',
              createdByUserId: auth.userId,
              lines: {
                create: lines.map((line) => ({
                  id: uuidv7(),
                  schoolId: auth.schoolId,
                  feeHeadId: line.feeHeadId,
                  description: line.description,
                  amountMinor: line.amountMinor,
                  discountMinor: line.discountMinor,
                })),
              },
            },
            select: { id: true, number: true, totalMinor: true },
          });
          await postInvoiceIssued(tx, {
            schoolId: auth.schoolId,
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            entryDate: date(issueDate),
            totalMinor: invoice.totalMinor,
            createdByUserId: auth.userId,
          });
          generated.push({
            studentId: student.id,
            admissionNo: student.admissionNo,
            name: `${student.firstName} ${student.lastName}`.trim(),
            invoiceId: invoice.id,
            number: invoice.number,
            totalMinor: invoice.totalMinor,
          });
        }

        if (!input.dryRun && generated.length > 0) {
          await this.audit.record(tx, auditCtx(auth, meta), {
            action: 'fee_invoices.generated',
            entity: 'Invoice',
            after: {
              year: year.name,
              prefix: sequencePrefix,
              count: generated.length,
              totalMinor: generated.reduce((sum, row) => sum + row.totalMinor, 0),
            },
          });
        }

        return {
          dryRun: input.dryRun,
          academicYear: year,
          candidates: students.length,
          skipped: skip.size,
          generated: generated.length,
          totalMinor: generated.reduce((sum, row) => sum + row.totalMinor, 0),
          invoices: generated.slice(0, 500),
        };
      },
      { timeoutMs: 60_000 },
    );
  }

  async listInvoices(
    auth: AuthPrincipal,
    query: {
      page: number;
      pageSize: number;
      classId?: string;
      sectionId?: string;
      status?: InvoiceStatus;
      from?: string;
      to?: string;
      q?: string;
    },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.InvoiceWhereInput = {
        schoolId: auth.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.classId || query.sectionId
          ? {
              student: {
                ...(query.classId ? { classId: query.classId } : {}),
                ...(query.sectionId ? { sectionId: query.sectionId } : {}),
              },
            }
          : {}),
        ...(query.from || query.to
          ? {
              issueDate: {
                ...(query.from ? { gte: date(query.from) } : {}),
                ...(query.to ? { lte: date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.q
          ? {
              OR: [
                { number: { contains: query.q, mode: 'insensitive' } },
                { student: { admissionNo: { contains: query.q, mode: 'insensitive' } } },
                { student: { firstName: { contains: query.q, mode: 'insensitive' } } },
                { student: { lastName: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.invoice.findMany({
          where,
          orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            student: {
              select: {
                id: true,
                admissionNo: true,
                firstName: true,
                lastName: true,
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
            _count: { select: { lines: true } },
          },
        }),
        tx.invoice.count({ where }),
      ]);
      return {
        items: items.map((invoice) => invoiceDto(invoice)),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async getInvoice(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id, schoolId: auth.schoolId },
        include: {
          student: {
            select: {
              id: true,
              admissionNo: true,
              firstName: true,
              lastName: true,
              phone: true,
              class: { select: { name: true } },
              section: { select: { name: true } },
            },
          },
          lines: { include: { feeHead: { select: { code: true, name: true } } } },
          allocations: {
            include: {
              payment: {
                select: {
                  id: true,
                  receiptNumber: true,
                  paidAt: true,
                  method: true,
                  status: true,
                },
              },
            },
          },
        },
      });
      if (!invoice) throw new NotFoundError('Invoice');
      return invoiceDto(invoice, true);
    });
  }

  async studentLedger(auth: AuthPrincipal, studentId: string) {
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
      const invoices = await tx.invoice.findMany({
        where: { schoolId: auth.schoolId, studentId, status: { not: 'VOID' } },
        orderBy: { issueDate: 'asc' },
        include: { lines: true },
      });
      const payments = await tx.payment.findMany({
        where: { schoolId: auth.schoolId, studentId, status: { not: 'VOID' } },
        orderBy: { paidAt: 'asc' },
        include: { refunds: true },
      });
      const ledger = summarizeLedger(invoices.map(toAllocatable));
      return {
        student: {
          id: student.id,
          admissionNo: student.admissionNo,
          name: `${student.firstName} ${student.lastName}`.trim(),
          className: student.class.name,
          sectionName: student.section.name,
        },
        summary: ledger,
        invoices: invoices.map((invoice) => invoiceDto(invoice)),
        payments: payments.map((payment) => ({
          id: payment.id,
          receiptNumber: payment.receiptNumber,
          amountMinor: payment.amountMinor,
          method: payment.method,
          paidAt: payment.paidAt,
          status: payment.status,
          refundedMinor: payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0),
        })),
      };
    });
  }

  async recordPayment(auth: AuthPrincipal, input: RecordPaymentRequest, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const duplicate = await tx.payment.findFirst({
        where: { schoolId: auth.schoolId, idempotencyKey: input.idempotencyKey },
        include: { allocations: true },
      });
      if (duplicate) return paymentDto(duplicate, true);

      const [student, settings] = await Promise.all([
        tx.student.findFirst({
          where: { id: input.studentId, schoolId: auth.schoolId, deletedAt: null },
          select: { id: true, admissionNo: true, firstName: true, lastName: true },
        }),
        tx.schoolSetting.findUnique({ where: { schoolId: auth.schoolId }, select: { fees: true } }),
      ]);
      if (!student) throw new NotFoundError('Student');
      const feeSettings = storedSettings(settings?.fees);

      const invoices = await tx.invoice.findMany({
        where: {
          schoolId: auth.schoolId,
          studentId: input.studentId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}),
        },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      });
      const allocation = allocatePayment(input.amountMinor, invoices.map(toAllocatable));
      if (allocation.advanceMinor > 0 && feeSettings.allowAdvancePayment === false) {
        throw new AppError(
          'VALIDATION_FAILED',
          'The payment exceeds the outstanding balance and advance payments are disabled',
          422,
          { outstandingMinor: input.amountMinor - allocation.advanceMinor },
        );
      }

      const paidAt = new Date(input.paidAt);
      const receipt = await nextDocumentNumber(
        tx,
        auth.schoolId,
        'receipt',
        feeSettings.receiptPrefix ?? 'RCPT',
        paidAt.toISOString().slice(0, 10),
        feeSettings,
      );

      const payment = await tx.payment.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          studentId: input.studentId,
          amountMinor: input.amountMinor,
          method: input.method,
          paidAt,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          receiptNumber: receipt,
          idempotencyKey: input.idempotencyKey,
          deviceId: input.deviceId ?? null,
          offlineReceiptNumber: input.offlineReceiptNumber ?? null,
          receivedByUserId: auth.userId,
          allocations: {
            create: allocation.allocations.map((row) => ({
              id: uuidv7(),
              schoolId: auth.schoolId,
              invoiceId: row.invoiceId,
              amountMinor: row.amountMinor,
            })),
          },
        },
        include: { allocations: true },
      });

      for (const row of allocation.allocations) {
        await tx.invoice.update({
          where: { id: row.invoiceId },
          data: { paidMinor: row.resultingPaidMinor, status: row.resultingStatus },
        });
      }

      await postPaymentReceived(tx, {
        schoolId: auth.schoolId,
        paymentId: payment.id,
        receiptNumber: receipt,
        method: input.method,
        entryDate: paidAt,
        amountMinor: input.amountMinor,
        createdByUserId: auth.userId,
      });

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'payment.received',
        entity: 'Payment',
        entityId: payment.id,
        after: {
          receiptNumber: receipt,
          student: `${student.firstName} ${student.lastName}`.trim(),
          amountMinor: input.amountMinor,
          method: input.method,
          allocatedMinor: input.amountMinor - allocation.advanceMinor,
          advanceMinor: allocation.advanceMinor,
        },
      });

      return paymentDto(payment, true);
    });
  }

  async refund(auth: AuthPrincipal, input: RefundRequest, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: input.paymentId, schoolId: auth.schoolId },
        include: { refunds: true, allocations: true },
      });
      if (!payment) throw new NotFoundError('Payment');
      if (payment.status === 'VOID') throw new ConflictError('This payment has been voided');
      const alreadyRefunded = payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
      const refundable = payment.amountMinor - alreadyRefunded;
      if (input.amountMinor > refundable) {
        throw new AppError('VALIDATION_FAILED', 'The refund exceeds the refundable amount', 422, {
          refundableMinor: refundable,
        });
      }

      const refund = await tx.refund.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          paymentId: payment.id,
          amountMinor: input.amountMinor,
          reason: input.reason,
          method: input.method,
          refundedAt: new Date(input.refundedAt),
          createdByUserId: auth.userId,
        },
      });

      // Reverse the payment's allocations newest-due first and reduce invoice balances.
      const ordered = [...payment.allocations].sort((a, b) => b.amountMinor - a.amountMinor);
      let remaining = input.amountMinor;
      for (const allocation of ordered) {
        if (remaining <= 0) break;
        const invoice = await tx.invoice.findFirst({
          where: { id: allocation.invoiceId, schoolId: auth.schoolId },
          select: { id: true, totalMinor: true, paidMinor: true },
        });
        if (!invoice) continue;
        const reversal = Math.min(remaining, allocation.amountMinor, invoice.paidMinor);
        if (reversal <= 0) continue;
        const paidMinor = invoice.paidMinor - reversal;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidMinor,
            status: deriveInvoiceStatus(invoice.totalMinor, paidMinor) as InvoiceStatus,
          },
        });
        if (reversal === allocation.amountMinor) {
          await tx.paymentAllocation.delete({ where: { id: allocation.id } });
        } else {
          await tx.paymentAllocation.update({
            where: { id: allocation.id },
            data: { amountMinor: allocation.amountMinor - reversal },
          });
        }
        remaining -= reversal;
      }

      const totalRefunded = alreadyRefunded + input.amountMinor;
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: totalRefunded >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });

      await postRefund(tx, {
        schoolId: auth.schoolId,
        refundId: refund.id,
        receiptNumber: payment.receiptNumber,
        method: input.method,
        entryDate: new Date(input.refundedAt),
        amountMinor: input.amountMinor,
        createdByUserId: auth.userId,
      });

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'payment.refunded',
        entity: 'Refund',
        entityId: refund.id,
        after: {
          receiptNumber: payment.receiptNumber,
          amountMinor: input.amountMinor,
          reason: input.reason,
          totalRefundedMinor: totalRefunded,
        },
      });

      return {
        id: refund.id,
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        amountMinor: refund.amountMinor,
        refundedAt: refund.refundedAt,
        totalRefundedMinor: totalRefunded,
        paymentStatus: totalRefunded >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      };
    });
  }

  async summary(auth: AuthPrincipal, query: { from?: string; to?: string }) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const from = date(query.from ?? monthStartIso());
      const to = date(query.to ?? todayIso());
      const [invoices, payments, expenses, byMethod] = await Promise.all([
        tx.invoice.findMany({
          where: { schoolId: auth.schoolId, status: { notIn: ['VOID', 'DRAFT'] } },
          select: {
            id: true,
            number: true,
            dueDate: true,
            status: true,
            totalMinor: true,
            paidMinor: true,
          },
        }),
        tx.payment.aggregate({
          where: {
            schoolId: auth.schoolId,
            status: { not: 'VOID' },
            paidAt: { gte: from, lte: endOfDay(to) },
          },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        tx.expense.aggregate({
          where: { schoolId: auth.schoolId, paidAt: { gte: from, lte: to } },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        tx.payment.groupBy({
          by: ['method'],
          where: {
            schoolId: auth.schoolId,
            status: { not: 'VOID' },
            paidAt: { gte: from, lte: endOfDay(to) },
          },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
      ]);
      const ledger = summarizeLedger(invoices.map(toAllocatable));
      const overdue = invoices.filter(
        (invoice) =>
          invoice.dueDate < from &&
          invoice.status !== 'PAID' &&
          invoice.paidMinor < invoice.totalMinor,
      );
      return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        ledger: {
          ...ledger,
          collectionPercent:
            ledger.totalBilledMinor === 0
              ? 0
              : Math.round((ledger.totalPaidMinor / ledger.totalBilledMinor) * 10_000) / 100,
        },
        period: {
          collectedMinor: payments._sum.amountMinor ?? 0,
          paymentCount: payments._count._all,
          expensesMinor: expenses._sum.amountMinor ?? 0,
          expenseCount: expenses._count._all,
          netMinor: (payments._sum.amountMinor ?? 0) - (expenses._sum.amountMinor ?? 0),
        },
        byMethod: byMethod.map((row) => ({
          method: row.method,
          amountMinor: row._sum.amountMinor ?? 0,
          count: row._count._all,
        })),
        overdue: {
          count: overdue.length,
          amountMinor: overdue.reduce((sum, invoice) => sum + (invoice.totalMinor - invoice.paidMinor), 0),
        },
      };
    });
  }

  async defaulters(
    auth: AuthPrincipal,
    query: {
      classId?: string;
      asOf?: string;
      minOverdueDays: number;
      page: number;
      pageSize: number;
    },
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const asOf = query.asOf ?? todayIso();
      const invoices = await tx.invoice.findMany({
        where: {
          schoolId: auth.schoolId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          dueDate: { lt: date(asOf) },
          ...(query.classId ? { student: { classId: query.classId } } : {}),
        },
        include: {
          student: {
            select: {
              id: true,
              admissionNo: true,
              firstName: true,
              lastName: true,
              phone: true,
              class: { select: { name: true } },
              section: { select: { name: true } },
              guardians: { where: { isPrimary: true }, take: 1, select: { fullName: true, phone: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      const grouped = new Map<
        string,
        {
          studentId: string;
          admissionNo: string;
          name: string;
          className: string;
          sectionName: string;
          phone: string | null;
          guardianName: string | null;
          guardianPhone: string | null;
          outstandingMinor: number;
          invoiceCount: number;
          oldestDueDate: string;
          maxOverdueDays: number;
        }
      >();
      for (const invoice of invoices) {
        const due = invoice.dueDate.toISOString().slice(0, 10);
        const overdueDays = differenceInDays(asOf, due);
        if (overdueDays < query.minOverdueDays) continue;
        const outstanding = invoice.totalMinor - invoice.paidMinor;
        if (outstanding <= 0) continue;
        const existing = grouped.get(invoice.studentId) ?? {
          studentId: invoice.student.id,
          admissionNo: invoice.student.admissionNo,
          name: `${invoice.student.firstName} ${invoice.student.lastName}`.trim(),
          className: invoice.student.class.name,
          sectionName: invoice.student.section.name,
          phone: invoice.student.phone,
          guardianName: invoice.student.guardians[0]?.fullName ?? null,
          guardianPhone: invoice.student.guardians[0]?.phone ?? null,
          outstandingMinor: 0,
          invoiceCount: 0,
          oldestDueDate: due,
          maxOverdueDays: 0,
        };
        existing.outstandingMinor += outstanding;
        existing.invoiceCount += 1;
        existing.maxOverdueDays = Math.max(existing.maxOverdueDays, overdueDays);
        if (due < existing.oldestDueDate) existing.oldestDueDate = due;
        grouped.set(invoice.studentId, existing);
      }

      const rows = [...grouped.values()].sort((a, b) => b.outstandingMinor - a.outstandingMinor);
      const start = (query.page - 1) * query.pageSize;
      return {
        asOf,
        items: rows.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: rows.length,
        totalOutstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0),
      };
    });
  }

  async expenses(auth: AuthPrincipal, query: { from?: string; to?: string; page: number; pageSize: number }) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.ExpenseWhereInput = {
        schoolId: auth.schoolId,
        ...(query.from || query.to
          ? {
              paidAt: {
                ...(query.from ? { gte: date(query.from) } : {}),
                ...(query.to ? { lte: date(query.to) } : {}),
              },
            }
          : {}),
      };
      const [items, total, sum] = await Promise.all([
        tx.expense.findMany({
          where,
          orderBy: { paidAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.expense.count({ where }),
        tx.expense.aggregate({ where, _sum: { amountMinor: true } }),
      ]);
      return {
        items,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalMinor: sum._sum.amountMinor ?? 0,
      };
    });
  }

  async createExpense(auth: AuthPrincipal, input: z.infer<typeof expenseRequestSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const expense = await tx.expense.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          category: input.category,
          description: input.description,
          amountMinor: input.amountMinor,
          paidAt: date(input.paidAt),
          method: input.method,
          receiptKey: input.receiptKey ?? null,
          createdByUserId: auth.userId,
        },
      });
      await postExpense(tx, {
        schoolId: auth.schoolId,
        expenseId: expense.id,
        category: expense.category,
        method: input.method,
        entryDate: date(input.paidAt),
        amountMinor: expense.amountMinor,
        createdByUserId: auth.userId,
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'expense.recorded',
        entity: 'Expense',
        entityId: expense.id,
        after: { category: expense.category, amountMinor: expense.amountMinor },
      });
      return expense;
    });
  }
}

function storedSettings(value: unknown): StoredFeeSettings {
  return (value ?? {}) as StoredFeeSettings;
}

function date(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function endOfDay(value: Date): Date {
  return new Date(value.getTime() + 86_399_999);
}

function monthStartIso(): string {
  const now = new Date();
  return `${now.toISOString().slice(0, 7)}-01`;
}

function discountFor(
  discounts: {
    feeHeadId: string | null;
    percentBps: number | null;
    amountMinor: number | null;
    validFrom: Date;
    validTo: Date | null;
  }[],
  feeHeadId: string,
  amountMinor: number,
  asOf: string,
): number {
  const on = date(asOf);
  let total = 0;
  for (const discount of discounts) {
    if (discount.feeHeadId && discount.feeHeadId !== feeHeadId) continue;
    if (discount.validFrom > on) continue;
    if (discount.validTo && discount.validTo < on) continue;
    if (discount.percentBps !== null) {
      total += percentOfMinor(amountMinor, discount.percentBps);
    } else if (discount.amountMinor !== null) {
      total += discount.amountMinor;
    }
  }
  return Math.min(amountMinor, total);
}

async function nextDocumentNumber(
  tx: TxClient,
  schoolId: string,
  kind: 'invoice' | 'receipt',
  prefix: string,
  isoDate: string,
  settings: StoredFeeSettings,
): Promise<string> {
  const fiscal = fiscalYearFor(
    isoDate,
    settings.fiscalYearStartMonth ?? 7,
    settings.fiscalYearStartDay ?? 16,
  );
  const period = fiscal.label.replace('/', '-');
  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'RCPT';
  const sequence = await tx.numberSequence.upsert({
    where: { schoolId_kind_period: { schoolId, kind, period } },
    create: {
      id: uuidv7(),
      schoolId,
      kind,
      period,
      prefix: cleanPrefix,
      nextValue: 2,
    },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true, prefix: true },
  });
  return receiptNumber(sequence.prefix, fiscal, sequence.nextValue - 1);
}

function toAllocatable(invoice: {
  id: string;
  number: string;
  dueDate: Date;
  totalMinor: number;
  paidMinor: number;
  status: string;
}): AllocatableInvoice {
  return {
    id: invoice.id,
    number: invoice.number,
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    status: invoice.status as InvoiceStatus,
  };
}

type InvoiceRecord = {
  id: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  fineMinor: number;
  totalMinor: number;
  paidMinor: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  student?: {
    id: string;
    admissionNo: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    class?: { name: string };
    section?: { name: string };
  };
  _count?: { lines: number };
  lines?: {
    id: string;
    description: string;
    amountMinor: number;
    discountMinor: number;
    feeHead?: { code: string; name: string } | null;
  }[];
  allocations?: {
    id: string;
    amountMinor: number;
    payment: { id: string; receiptNumber: string; paidAt: Date; method: string; status: string };
  }[];
};

function invoiceDto(invoice: InvoiceRecord, full = false) {
  const base = {
    id: invoice.id,
    number: invoice.number,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    fineMinor: invoice.fineMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    outstandingMinor: Math.max(0, invoice.totalMinor - invoice.paidMinor),
    status: invoice.status,
    student: invoice.student
      ? {
          id: invoice.student.id,
          admissionNo: invoice.student.admissionNo,
          name: `${invoice.student.firstName} ${invoice.student.lastName}`.trim(),
          className: invoice.student.class?.name,
          sectionName: invoice.student.section?.name,
        }
      : undefined,
    lineCount: invoice._count?.lines,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
  if (!full) return base;
  return {
    ...base,
    notes: invoice.notes,
    student: invoice.student
      ? {
          ...base.student,
          phone: invoice.student.phone ?? null,
        }
      : undefined,
    lines: invoice.lines?.map((line) => ({
      id: line.id,
      description: line.description,
      feeHeadCode: line.feeHead?.code,
      feeHeadName: line.feeHead?.name,
      amountMinor: line.amountMinor,
      discountMinor: line.discountMinor,
      netMinor: line.amountMinor - line.discountMinor,
    })),
    allocations: invoice.allocations?.map((allocation) => ({
      id: allocation.id,
      amountMinor: allocation.amountMinor,
      payment: {
        id: allocation.payment.id,
        receiptNumber: allocation.payment.receiptNumber,
        paidAt: allocation.payment.paidAt,
        method: allocation.payment.method,
        status: allocation.payment.status,
      },
    })),
  };
}

function paymentDto(
  payment: {
    id: string;
    studentId: string;
    amountMinor: number;
    method: string;
    paidAt: Date;
    reference: string | null;
    notes: string | null;
    receiptNumber: string;
    idempotencyKey: string;
    status: string;
    createdAt: Date;
    allocations: { invoiceId: string; amountMinor: number }[];
  },
  includeAllocations: boolean,
) {
  return {
    id: payment.id,
    studentId: payment.studentId,
    receiptNumber: payment.receiptNumber,
    amountMinor: payment.amountMinor,
    method: payment.method,
    paidAt: payment.paidAt,
    reference: payment.reference,
    notes: payment.notes,
    status: payment.status,
    idempotencyKey: payment.idempotencyKey,
    createdAt: payment.createdAt,
    allocations: includeAllocations
      ? payment.allocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amountMinor: allocation.amountMinor,
        }))
      : undefined,
  };
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
