import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  calculateLateFine,
  collectionRate,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  fiscalYearFor,
  receiptNumber,
  summarizeLedger,
} from '../src/fees';
import { ValidationError } from '../src/errors';

describe('fees', () => {
  it('derives the configured fiscal year around the boundary', () => {
    expect(fiscalYearFor('2026-07-15')).toEqual({
      startYear: 2025,
      endYear: 2026,
      label: '2025/26',
    });
    expect(fiscalYearFor('2026-07-16').label).toBe('2026/27');
    expect(fiscalYearFor('2026-01-01').label).toBe('2025/26');
    expect(fiscalYearFor('2026-01-01', 1, 1, 'dash').label).toBe('2026-2027');
  });

  it('formats auto-numbered receipts', () => {
    const fy = fiscalYearFor('2026-07-20');
    expect(receiptNumber('rcpt', fy, 12)).toBe('RCPT-2026-27-000012');
    expect(receiptNumber('R-1', fy, 1, 4)).toBe('R-1-2026-27-0001');
    expect(() => receiptNumber('', fy, 1)).toThrow();
    expect(() => receiptNumber('R', fy, 0)).toThrow();
  });

  const invoices = [
    {
      id: 'b',
      number: 'INV-2',
      dueDate: '2026-05-01',
      totalMinor: 500_00,
      paidMinor: 0,
      status: 'ISSUED' as const,
    },
    {
      id: 'a',
      number: 'INV-1',
      dueDate: '2026-04-01',
      totalMinor: 1000_00,
      paidMinor: 200_00,
      status: 'PARTIALLY_PAID' as const,
    },
    {
      id: 'void',
      number: 'INV-3',
      dueDate: '2026-03-01',
      totalMinor: 999_00,
      paidMinor: 0,
      status: 'VOID' as const,
    },
  ];

  it('allocates oldest invoices first and skips void invoices', () => {
    const result = allocatePayment(1000_00, invoices);
    expect(result.allocations.map((a) => [a.invoiceId, a.amountMinor])).toEqual([
      ['a', 800_00],
      ['b', 200_00],
    ]);
    expect(result.allocations[0]?.resultingStatus).toBe('PAID');
    expect(result.allocations[1]?.resultingStatus).toBe('PARTIALLY_PAID');
    expect(result.advanceMinor).toBe(0);
  });

  it('records overpayment as an advance', () => {
    const result = allocatePayment(2000_00, invoices);
    expect(result.unallocatedMinor).toBe(700_00);
    expect(result.advanceMinor).toBe(700_00);
    expect(() => allocatePayment(0, invoices)).toThrow(ValidationError);
  });

  it('derives invoice statuses', () => {
    expect(deriveInvoiceStatus(100, 0)).toBe('ISSUED');
    expect(deriveInvoiceStatus(100, 40)).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus(100, 100)).toBe('PAID');
    expect(() => deriveInvoiceStatus(-1, 0)).toThrow();
  });

  it('calculates flat-daily and percentage late fines', () => {
    expect(
      calculateLateFine({
        principalMinor: 100_000,
        dueDate: '2026-01-01',
        asOfDate: '2026-01-11',
        rule: { type: 'FLAT_DAILY', dailyMinor: 50, graceDays: 2 },
      }),
    ).toBe(400);
    expect(
      calculateLateFine({
        principalMinor: 100_000,
        dueDate: '2026-01-01',
        asOfDate: '2026-01-11',
        rule: { type: 'FLAT_DAILY', dailyMinor: 50, graceDays: 2, maxMinor: 100 },
      }),
    ).toBe(100);
    expect(
      calculateLateFine({
        principalMinor: 100_000,
        dueDate: '2026-01-01',
        asOfDate: '2026-01-02',
        rule: { type: 'PERCENT', rateBps: 500, graceDays: 5 },
      }),
    ).toBe(0);
    expect(
      calculateLateFine({
        principalMinor: 100_000,
        dueDate: '2026-01-01',
        asOfDate: '2026-01-11',
        rule: { type: 'PERCENT', rateBps: 500, graceDays: 0 },
      }),
    ).toBe(5000);
    expect(
      calculateLateFine({
        principalMinor: 100_000,
        dueDate: '2026-01-01',
        asOfDate: '2026-01-11',
        rule: { type: 'NONE' },
      }),
    ).toBe(0);
  });

  it('computes invoice totals with line and invoice discounts', () => {
    const totals = computeInvoiceTotals(
      [
        { description: 'Tuition', amountMinor: 100_000, discountMinor: 5_000 },
        { description: 'Transport', amountMinor: 50_000 },
      ],
      { invoiceDiscountMinor: 10_000, fineMinor: 2_000, paidMinor: 50_000 },
    );
    expect(totals).toMatchObject({
      subtotalMinor: 150_000,
      discountMinor: 15_000,
      fineMinor: 2_000,
      totalMinor: 137_000,
      paidMinor: 50_000,
      outstandingMinor: 87_000,
      status: 'PARTIALLY_PAID',
    });
    expect(() => computeInvoiceTotals([])).toThrow();
    expect(() =>
      computeInvoiceTotals([{ description: 'x', amountMinor: 10, discountMinor: 11 }]),
    ).toThrow();
  });

  it('summarises the student ledger and collection rate', () => {
    const summary = summarizeLedger(invoices);
    expect(summary.totalBilledMinor).toBe(150_000);
    expect(summary.totalPaidMinor).toBe(20_000);
    expect(summary.outstandingMinor).toBe(130_000);
    expect(collectionRate(invoices)).toBe(13.33);

    const advance = summarizeLedger([
      { ...invoices[1]!, paidMinor: 120_000 },
    ]);
    expect(advance.outstandingMinor).toBe(0);
    expect(advance.advanceMinor).toBe(20_000);
    expect(collectionRate([])).toBe(0);
  });
});
