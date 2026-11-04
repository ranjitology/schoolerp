/**
 * Fee arithmetic. Every operation is integer-only and idempotent by design.
 * Payment allocation is oldest-due-first; unallocated remainder becomes an
 * advance credit on the student ledger.
 */
import { ValidationError } from './errors';
import { percentOfMinor, sumMinor } from './money';
import { roundPercent } from './grading';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type PaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'CARD'
  | 'ESEWA'
  | 'KHALTI'
  | 'CHEQUE'
  | 'OTHER';

export interface FiscalYear {
  startYear: number;
  endYear: number;
  label: string;
}

/**
 * Fiscal year for a date, using a configurable start month/day (Nepal's fiscal
 * year starts on Shrawan 1, approximately 16 July; the Gregorian default would
 * be January). Dates are treated as UTC calendar dates.
 */
export function fiscalYearFor(
  isoDate: string,
  startMonth = 7,
  startDay = 16,
  labelStyle: 'slash' | 'dash' = 'slash',
): FiscalYear {
  const date = parseIsoDate(isoDate);
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, startMonth - 1, startDay);
  const startYear = date.getTime() >= start ? year : year - 1;
  const endYear = startYear + 1;
  return {
    startYear,
    endYear,
    label:
      labelStyle === 'slash'
        ? `${startYear}/${String(endYear).slice(2)}`
        : `${startYear}-${endYear}`,
  };
}

export function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError('Expected YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('Invalid calendar date');
  }
  return date;
}

export function differenceInDays(laterIso: string, earlierIso: string): number {
  const later = parseIsoDate(laterIso).getTime();
  const earlier = parseIsoDate(earlierIso).getTime();
  return Math.floor((later - earlier) / 86_400_000);
}

export function receiptNumber(
  prefix: string,
  fiscalYear: FiscalYear,
  sequence: number,
  width = 6,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new ValidationError('Receipt sequence must be a positive integer');
  }
  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!cleanPrefix) throw new ValidationError('Receipt prefix is required');
  const period = fiscalYear.label.replace('/', '-');
  return `${cleanPrefix}-${period}-${String(sequence).padStart(width, '0')}`;
}

export interface AllocatableInvoice {
  id: string;
  number: string;
  dueDate: string;
  totalMinor: number;
  paidMinor: number;
  status: InvoiceStatus;
}

export interface Allocation {
  invoiceId: string;
  amountMinor: number;
  resultingPaidMinor: number;
  resultingStatus: InvoiceStatus;
}

export interface AllocationResult {
  allocations: Allocation[];
  unallocatedMinor: number;
  advanceMinor: number;
}

/**
 * Allocates a payment to outstanding invoices, oldest due first. Void/draft
 * invoices are skipped. The sum of allocations + advance always equals the
 * payment exactly.
 */
export function allocatePayment(
  paymentMinor: number,
  invoices: readonly AllocatableInvoice[],
): AllocationResult {
  if (!Number.isSafeInteger(paymentMinor) || paymentMinor <= 0) {
    throw new ValidationError('Payment amount must be a positive integer in minor units');
  }

  const sorted = invoices
    .filter((invoice) => invoice.status !== 'VOID' && invoice.status !== 'DRAFT')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));

  let remaining = paymentMinor;
  const allocations: Allocation[] = [];

  for (const invoice of sorted) {
    if (remaining <= 0) break;
    const outstanding = Math.max(0, invoice.totalMinor - invoice.paidMinor);
    if (outstanding === 0) continue;
    const amount = Math.min(outstanding, remaining);
    const resultingPaidMinor = invoice.paidMinor + amount;
    allocations.push({
      invoiceId: invoice.id,
      amountMinor: amount,
      resultingPaidMinor,
      resultingStatus: deriveInvoiceStatus(invoice.totalMinor, resultingPaidMinor),
    });
    remaining -= amount;
  }

  return { allocations, unallocatedMinor: remaining, advanceMinor: remaining };
}

export function deriveInvoiceStatus(totalMinor: number, paidMinor: number): InvoiceStatus {
  if (totalMinor < 0 || paidMinor < 0) throw new ValidationError('Amounts cannot be negative');
  if (paidMinor === 0) return 'ISSUED';
  if (paidMinor >= totalMinor) return 'PAID';
  return 'PARTIALLY_PAID';
}

export type LateFineRule =
  | { type: 'NONE' }
  | { type: 'FLAT_DAILY'; dailyMinor: number; graceDays: number; maxMinor?: number }
  | { type: 'PERCENT'; rateBps: number; graceDays: number; maxMinor?: number };

export interface LateFineInput {
  principalMinor: number;
  dueDate: string;
  asOfDate: string;
  rule: LateFineRule;
}

/** Deterministic late fine; called on a schedule and at receipt time. */
export function calculateLateFine(input: LateFineInput): number {
  if (input.rule.type === 'NONE') return 0;
  if (input.principalMinor < 0) throw new ValidationError('Principal cannot be negative');
  const overdueDays = Math.max(0, differenceInDays(input.asOfDate, input.dueDate));
  const chargeableDays = Math.max(0, overdueDays - input.rule.graceDays);
  if (chargeableDays === 0) return 0;

  let fine: number;
  if (input.rule.type === 'FLAT_DAILY') {
    if (!Number.isSafeInteger(input.rule.dailyMinor) || input.rule.dailyMinor < 0) {
      throw new ValidationError('Daily fine must be a non-negative integer');
    }
    fine = input.rule.dailyMinor * chargeableDays;
  } else {
    // Percentage fine accrues once for any overdue period (common in schools).
    fine = percentOfMinor(input.principalMinor, input.rule.rateBps);
  }

  if (!Number.isSafeInteger(fine)) throw new ValidationError('Fine overflow');
  return input.rule.maxMinor === undefined ? fine : Math.min(fine, input.rule.maxMinor);
}

export interface InvoiceLineInput {
  description: string;
  amountMinor: number;
  discountMinor?: number;
}

export interface InvoiceTotals {
  subtotalMinor: number;
  discountMinor: number;
  fineMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: InvoiceStatus;
}

export function computeInvoiceTotals(
  lines: readonly InvoiceLineInput[],
  options: { fineMinor?: number; paidMinor?: number; invoiceDiscountMinor?: number } = {},
): InvoiceTotals {
  if (lines.length === 0) throw new ValidationError('Invoice requires at least one line');
  let subtotal = 0;
  let lineDiscounts = 0;

  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor < 0) {
      throw new ValidationError('Line amounts must be non-negative integers');
    }
    if (!line.description.trim()) throw new ValidationError('Line description is required');
    const discount = line.discountMinor ?? 0;
    if (!Number.isSafeInteger(discount) || discount < 0 || discount > line.amountMinor) {
      throw new ValidationError('Line discount must be between zero and the line amount');
    }
    subtotal += line.amountMinor;
    lineDiscounts += discount;
  }

  const invoiceDiscount = options.invoiceDiscountMinor ?? 0;
  if (!Number.isSafeInteger(invoiceDiscount) || invoiceDiscount < 0) {
    throw new ValidationError('Invoice discount must be a non-negative integer');
  }
  const fine = options.fineMinor ?? 0;
  if (!Number.isSafeInteger(fine) || fine < 0) throw new ValidationError('Fine must be non-negative');

  const discount = lineDiscounts + invoiceDiscount;
  if (discount > subtotal) throw new ValidationError('Discount cannot exceed subtotal');
  const total = subtotal - discount + fine;
  const paid = options.paidMinor ?? 0;
  if (!Number.isSafeInteger(paid) || paid < 0) throw new ValidationError('Paid amount is invalid');

  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    fineMinor: fine,
    totalMinor: total,
    paidMinor: paid,
    outstandingMinor: Math.max(0, total - paid),
    status: paid === 0 ? 'ISSUED' : paid >= total ? 'PAID' : 'PARTIALLY_PAID',
  };
}

export interface LedgerSummary {
  totalBilledMinor: number;
  totalPaidMinor: number;
  outstandingMinor: number;
  advanceMinor: number;
  netDueMinor: number;
}

/** Student ledger summary; advance credit offsets outstanding balance. */
export function summarizeLedger(invoices: readonly AllocatableInvoice[]): LedgerSummary {
  let billed = 0;
  let paid = 0;
  for (const invoice of invoices) {
    if (invoice.status === 'VOID' || invoice.status === 'DRAFT') continue;
    billed += invoice.totalMinor;
    paid += invoice.paidMinor;
  }
  const outstanding = Math.max(0, billed - paid);
  return {
    totalBilledMinor: billed,
    totalPaidMinor: paid,
    outstandingMinor: outstanding,
    advanceMinor: Math.max(0, paid - billed),
    netDueMinor: outstanding,
  };
}

export function collectionRate(invoices: readonly AllocatableInvoice[]): number {
  const billed = sumMinor(
    invoices
      .filter((i) => i.status !== 'VOID' && i.status !== 'DRAFT')
      .map((i) => i.totalMinor),
  );
  if (billed === 0) return 0;
  const paid = sumMinor(
    invoices
      .filter((i) => i.status !== 'VOID' && i.status !== 'DRAFT')
      .map((i) => Math.min(i.paidMinor, i.totalMinor)),
  );
  return roundPercent((paid / billed) * 100);
}
