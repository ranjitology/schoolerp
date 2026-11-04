import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common';

export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'ESEWA',
  'KHALTI',
  'CHEQUE',
  'OTHER',
] as const;

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const feeHeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/)
    .transform((v) => v.toUpperCase()),
  description: z.string().trim().max(500).optional(),
  isRecurring: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type FeeHeadInput = z.infer<typeof feeHeadSchema>;

export const feeStructureSchema = z.object({
  academicYearId: uuidSchema,
  classId: uuidSchema,
  feeHeadId: uuidSchema,
  amountMinor: z.number().int().min(0).max(2_147_483_647),
  installments: z.number().int().min(1).max(12).default(1),
  dueDay: z.number().int().min(1).max(28).default(10),
});
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;

export const studentDiscountSchema = z
  .object({
    studentId: uuidSchema,
    feeHeadId: uuidSchema.optional(),
    percentBps: z.number().int().min(0).max(10_000).optional(),
    amountMinor: z.number().int().min(0).max(2_147_483_647).optional(),
    reason: z.string().trim().min(3).max(500),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.optional(),
    approvedBy: uuidSchema,
  })
  .refine((value) => (value.percentBps === undefined) !== (value.amountMinor === undefined), {
    message: 'Provide either percentBps or amountMinor, not both',
  });

export const invoiceLineSchema = z.object({
  feeHeadId: uuidSchema.optional(),
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().min(0).max(2_147_483_647),
  discountMinor: z.number().int().min(0).max(2_147_483_647).default(0),
});

export const createInvoiceSchema = z.object({
  studentId: uuidSchema,
  academicYearId: uuidSchema,
  issueDate: isoDateSchema,
  dueDate: isoDateSchema,
  lines: z.array(invoiceLineSchema).min(1).max(50),
  invoiceDiscountMinor: z.number().int().min(0).default(0),
  fineMinor: z.number().int().min(0).default(0),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const recordPaymentSchema = z.object({
  studentId: uuidSchema,
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  method: paymentMethodSchema,
  paidAt: z.string().datetime({ offset: true }),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Client UUIDv7; unique per tenant makes receipt posting idempotent. */
  idempotencyKey: z.string().uuid(),
  invoiceIds: z.array(uuidSchema).max(50).optional(),
  /** Offline device receipt from a reserved number block. */
  deviceId: z.string().uuid().optional(),
  offlineReceiptNumber: z.string().trim().max(40).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const refundPaymentSchema = z.object({
  paymentId: uuidSchema,
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  reason: z.string().trim().min(3).max(500),
  method: paymentMethodSchema,
  refundedAt: z.string().datetime({ offset: true }),
});

export const expenseSchema = z.object({
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(2).max(500),
  amountMinor: z.number().int().min(1).max(2_147_483_647),
  paidAt: isoDateSchema,
  method: paymentMethodSchema,
  receiptKey: z.string().trim().max(500).optional(),
});

export const feeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  classId: uuidSchema.optional(),
  sectionId: uuidSchema.optional(),
  status: z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const defaulterQuerySchema = z.object({
  classId: uuidSchema.optional(),
  asOf: isoDateSchema.optional(),
  minOverdueDays: z.coerce.number().int().min(0).max(365).default(0),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const receiptBlockRequestSchema = z.object({
  deviceId: uuidSchema,
  size: z.number().int().min(1).max(500).default(50),
  fiscalYear: z.string().trim().max(20).optional(),
});
