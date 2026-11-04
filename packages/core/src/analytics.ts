/** Analytics helpers shared by dashboard, reports and platform billing. */

export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function safePercent(part: number, whole: number, digits = 1): number {
  if (whole <= 0) return 0;
  const factor = 10 ** digits;
  return Math.round((part / whole) * 100 * factor) / factor;
}

export type AgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  amountMinor: number;
  count: number;
}

const AGING_DEFINITIONS: { key: AgingBucketKey; label: string; min: number; max: number }[] = [
  { key: 'current', label: 'Not due', min: -1_000_000, max: 0 },
  { key: '1-30', label: '1–30 days', min: 1, max: 30 },
  { key: '31-60', label: '31–60 days', min: 31, max: 60 },
  { key: '61-90', label: '61–90 days', min: 61, max: 90 },
  { key: '90+', label: '90+ days', min: 91, max: Number.MAX_SAFE_INTEGER },
];

/** Buckets outstanding invoices by days past due. */
export function agingBuckets(
  invoices: { dueDate: Date | string; outstandingMinor: number }[],
  asOf: Date = new Date(),
): AgingBucket[] {
  const buckets = AGING_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    amountMinor: 0,
    count: 0,
  }));
  const asOfTime = new Date(asOf).getTime();
  for (const invoice of invoices) {
    if (invoice.outstandingMinor <= 0) continue;
    const due = new Date(invoice.dueDate).getTime();
    const daysPastDue = Math.floor((asOfTime - due) / 86_400_000);
    const index = AGING_DEFINITIONS.findIndex(
      (definition) => daysPastDue >= definition.min && daysPastDue <= definition.max,
    );
    const bucket = buckets[index < 0 ? 0 : index]!;
    bucket.amountMinor += invoice.outstandingMinor;
    bucket.count += 1;
  }
  return buckets;
}

/** Fills missing months in a time series with zero values. */
export function fillMonthlySeries<T extends { period: string }>(
  rows: T[],
  months: string[],
  value: (row: T) => number,
): { period: string; value: number }[] {
  const byPeriod = new Map(rows.map((row) => [row.period, value(row)]));
  return months.map((period) => ({ period, value: byPeriod.get(period) ?? 0 }));
}
