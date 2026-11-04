/**
 * Platform billing arithmetic: billing periods, proration and dunning.
 *
 * All money is integer minor units. Dates are handled in UTC so an invoice run
 * is deterministic no matter which operation team member clicks the button.
 */

export type BillingInterval = 'MONTHLY' | 'YEARLY';

export type DunningAction = 'NONE' | 'REMIND' | 'PAST_DUE' | 'SUSPEND';

export interface DunningStep {
  afterDays: number;
  action: DunningAction;
}

/** Grace period before a past-due subscription is suspended. */
export const DUNNING_STEPS: readonly DunningStep[] = [
  { afterDays: 0, action: 'REMIND' },
  { afterDays: 3, action: 'REMIND' },
  { afterDays: 7, action: 'PAST_DUE' },
  { afterDays: 14, action: 'SUSPEND' },
];

export function addUtcMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/** End of the billing period that starts at `start`. */
export function billingPeriodEnd(start: Date, interval: BillingInterval): Date {
  return addUtcMonths(start, interval === 'YEARLY' ? 12 : 1);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/**
 * Amount for the unused part of a period. Used both for credits when a tenant
 * downgrades and for the first invoice when a tenant upgrades mid-period.
 */
export function prorationMinor(input: {
  amountMinor: number;
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
}): number {
  const totalDays = daysBetween(input.periodStart, input.periodEnd);
  if (totalDays === 0) return 0;
  const remainingDays = daysBetween(input.changeAt, input.periodEnd);
  return Math.round((input.amountMinor * remainingDays) / totalDays);
}

/** The most severe dunning action that applies to an invoice today. */
export function dunningActionFor(dueAt: Date, now: Date = new Date()): DunningAction {
  if (now.getTime() < dueAt.getTime()) return 'NONE';
  const overdueDays = daysBetween(dueAt, now);
  let action: DunningAction = 'NONE';
  for (const step of DUNNING_STEPS) {
    if (overdueDays >= step.afterDays) action = step.action;
  }
  return action;
}

/** Stable, human-readable invoice number, e.g. `PI-GREEN-VALLEY-2026-11`. */
export function platformInvoiceNumber(
  schoolSlug: string,
  period: string,
  sequence = 1,
): string {
  const slug = schoolSlug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = sequence > 1 ? `-${sequence}` : '';
  return `PI-${slug || 'TENANT'}-${period}${suffix}`;
}

export interface ProrationLine {
  description: string;
  amountMinor: number;
  quantity: number;
}

export function prorationLine(input: {
  fromPlanName: string;
  toPlanName: string;
  fromPriceMinor: number;
  toPriceMinor: number;
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
}): ProrationLine {
  const credit = prorationMinor({
    amountMinor: input.fromPriceMinor,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    changeAt: input.changeAt,
  });
  const charge = prorationMinor({
    amountMinor: input.toPriceMinor,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    changeAt: input.changeAt,
  });
  return {
    description: `Proration ${input.fromPlanName} → ${input.toPlanName}`,
    amountMinor: charge - credit,
    quantity: 1,
  };
}
