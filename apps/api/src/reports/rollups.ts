import { uuidv7 } from '@schoolerp/core';
import type { TxClient } from '@schoolerp/db';

/**
 * Reporting rollups are ordinary tenant tables, not PostgreSQL materialised
 * views. That keeps RLS in force for every read and lets a tenant refresh its
 * own numbers without a privileged maintenance connection.
 */

export interface RollupRange {
  from: string;
  to: string;
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

export async function refreshAttendanceRollup(
  tx: TxClient,
  schoolId: string,
  range: RollupRange,
): Promise<{ rows: number; records: number }> {
  const rows = await tx.attendanceRecord.groupBy({
    by: ['date', 'status'],
    where: {
      schoolId,
      date: { gte: day(range.from), lte: day(range.to) },
    },
    _count: { _all: true },
  });

  await tx.reportDailyAttendance.deleteMany({
    where: { schoolId, date: { gte: day(range.from), lte: day(range.to) } },
  });

  let records = 0;
  for (const row of rows) {
    records += row._count._all;
    await tx.reportDailyAttendance.create({
      data: {
        id: uuidv7(),
        schoolId,
        date: row.date,
        status: row.status,
        count: row._count._all,
      },
    });
  }
  return { rows: rows.length, records };
}

export async function refreshFeeRollup(
  tx: TxClient,
  schoolId: string,
  range: RollupRange,
): Promise<{ rows: number; payments: number; amountMinor: number }> {
  const payments = await tx.payment.findMany({
    where: {
      schoolId,
      status: 'POSTED',
      paidAt: { gte: day(range.from), lte: endOfDay(range.to) },
    },
    select: { paidAt: true, method: true, amountMinor: true },
  });

  const buckets = new Map<
    string,
    { date: Date; method: string; amountMinor: number; count: number }
  >();
  for (const payment of payments) {
    const date = new Date(
      Date.UTC(
        payment.paidAt.getUTCFullYear(),
        payment.paidAt.getUTCMonth(),
        payment.paidAt.getUTCDate(),
      ),
    );
    const key = `${date.toISOString().slice(0, 10)}:${payment.method}`;
    const bucket = buckets.get(key) ?? {
      date,
      method: payment.method,
      amountMinor: 0,
      count: 0,
    };
    bucket.amountMinor += payment.amountMinor;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  await tx.reportFeeCollection.deleteMany({
    where: { schoolId, date: { gte: day(range.from), lte: day(range.to) } },
  });

  for (const bucket of buckets.values()) {
    await tx.reportFeeCollection.create({
      data: {
        id: uuidv7(),
        schoolId,
        date: bucket.date,
        method: bucket.method,
        amountMinor: bucket.amountMinor,
        count: bucket.count,
      },
    });
  }
  return {
    rows: buckets.size,
    payments: payments.length,
    amountMinor: payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
  };
}

/** True when every day in the range has at least one attendance rollup row. */
export async function attendanceRollupCovers(
  tx: TxClient,
  schoolId: string,
  range: RollupRange,
): Promise<boolean> {
  const rows = await tx.reportDailyAttendance.findMany({
    where: { schoolId, date: { gte: day(range.from), lte: day(range.to) } },
    select: { date: true },
    distinct: ['date'],
  });
  return rows.length >= countDays(range.from, range.to);
}

/** Fees may legitimately have no collection on a day, so only presence matters. */
export async function feeRollupCovers(
  tx: TxClient,
  schoolId: string,
  range: RollupRange,
): Promise<boolean> {
  const row = await tx.reportFeeCollection.findFirst({
    where: { schoolId, date: { gte: day(range.from), lte: day(range.to) } },
    select: { id: true },
  });
  return Boolean(row);
}

function countDays(from: string, to: string): number {
  const start = day(from).getTime();
  const end = day(to).getTime();
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}
