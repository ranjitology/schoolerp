/** Payroll arithmetic. All amounts are integer minor units. */

export interface PayslipInput {
  baseMinor: number;
  allowancesMinor?: number;
  deductionsMinor?: number;
  /** Optional flat tax in minor units; the caller owns tax policy. */
  taxMinor?: number;
}

export interface PayslipTotals {
  baseMinor: number;
  allowancesMinor: number;
  deductionsMinor: number;
  taxMinor: number;
  netMinor: number;
}

export function computePayslip(input: PayslipInput): PayslipTotals {
  const base = Math.max(0, Math.trunc(input.baseMinor));
  const allowances = Math.max(0, Math.trunc(input.allowancesMinor ?? 0));
  const deductions = Math.max(0, Math.trunc(input.deductionsMinor ?? 0));
  const tax = Math.max(0, Math.trunc(input.taxMinor ?? 0));
  return {
    baseMinor: base,
    allowancesMinor: allowances,
    deductionsMinor: deductions,
    taxMinor: tax,
    netMinor: Math.max(0, base + allowances - deductions - tax),
  };
}

export function summarizePayroll(payslips: PayslipTotals[]): {
  count: number;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
} {
  return payslips.reduce(
    (summary, slip) => ({
      count: summary.count + 1,
      grossMinor: summary.grossMinor + slip.baseMinor + slip.allowancesMinor,
      deductionsMinor: summary.deductionsMinor + slip.deductionsMinor + slip.taxMinor,
      netMinor: summary.netMinor + slip.netMinor,
    }),
    { count: 0, grossMinor: 0, deductionsMinor: 0, netMinor: 0 },
  );
}

/** Prorates a monthly base by paid days (e.g. unpaid leave). */
export function prorateMonthly(baseMinor: number, paidDays: number, monthDays: number): number {
  if (monthDays <= 0) return 0;
  const safePaid = Math.min(Math.max(0, paidDays), monthDays);
  return Math.round((baseMinor * safePaid) / monthDays);
}
