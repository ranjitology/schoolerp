import { describe, expect, it } from 'vitest';
import { agingBuckets, percentChange } from '../src/analytics';
import { computePayslip, prorateMonthly, summarizePayroll } from '../src/payroll';

describe('payroll', () => {
  it('computes net pay without float drift', () => {
    expect(
      computePayslip({ baseMinor: 5_000_00, allowancesMinor: 500_00, deductionsMinor: 250_00, taxMinor: 100_00 }),
    ).toEqual({
      baseMinor: 500_000,
      allowancesMinor: 50_000,
      deductionsMinor: 25_000,
      taxMinor: 10_000,
      netMinor: 515_000,
    });
  });

  it('prorates by paid days', () => {
    expect(prorateMonthly(300_00, 15, 30)).toBe(150_00);
    expect(prorateMonthly(300_00, 0, 30)).toBe(0);
  });

  it('summarises a payroll run', () => {
    const summary = summarizePayroll([
      computePayslip({ baseMinor: 100_00 }),
      computePayslip({ baseMinor: 200_00, deductionsMinor: 20_00 }),
    ]);
    expect(summary.count).toBe(2);
    expect(summary.grossMinor).toBe(300_00);
    expect(summary.netMinor).toBe(280_00);
  });
});

describe('analytics', () => {
  it('computes percent change safely', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(0, 0)).toBe(0);
  });

  it('buckets receivables by age', () => {
    const asOf = new Date('2026-02-01T00:00:00Z');
    const buckets = agingBuckets(
      [
        { dueDate: '2026-02-10', outstandingMinor: 100 },
        { dueDate: '2026-01-20', outstandingMinor: 200 },
        { dueDate: '2025-11-01', outstandingMinor: 300 },
      ],
      asOf,
    );
    const byKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.amountMinor]));
    expect(byKey.current).toBe(100);
    expect(byKey['1-30']).toBe(200);
    expect(byKey['90+']).toBe(300);
  });
});
