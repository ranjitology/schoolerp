import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTENDANCE_POLICY,
  attendanceIdempotencyKey,
  findLowAttendance,
  isIsoDate,
  stableStringify,
  summarizeAttendance,
  validateBulkAttendance,
} from '../src/attendance';

describe('attendance', () => {
  it('summarises statuses with the default policy', () => {
    const summary = summarizeAttendance([
      { status: 'PRESENT' },
      { status: 'PRESENT' },
      { status: 'LATE' },
      { status: 'ABSENT' },
      { status: 'LEAVE' },
      { status: 'HALF_DAY' },
    ]);
    expect(summary.total).toBe(6);
    expect(summary.denominator).toBe(5);
    expect(summary.attendedEquivalent).toBe(3.5);
    expect(summary.attendancePercent).toBe(70);
  });

  it('respects configurable policy', () => {
    const summary = summarizeAttendance(
      [{ status: 'LEAVE' }, { status: 'PRESENT' }, { status: 'HALF_DAY' }],
      { ...DEFAULT_ATTENDANCE_POLICY, excludeLeaveFromDenominator: false, lateCountsPresent: false },
    );
    expect(summary.denominator).toBe(3);
    expect(summary.attendancePercent).toBe(50);
    expect(summarizeAttendance([]).attendancePercent).toBe(0);
  });

  it('validates date format and future dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('28-02-2026')).toBe(false);
    const result = validateBulkAttendance(
      {
        date: '2026-03-01',
        classId: 'c1',
        sectionId: 's1',
        period: 0,
        records: [{ studentId: 'a', status: 'PRESENT' }],
      },
      { today: '2026-02-28' },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.field).toBe('date');
  });

  it('rejects duplicates, unknown statuses and oversized batches', () => {
    const result = validateBulkAttendance({
      date: '2026-02-01',
      classId: 'c1',
      sectionId: 's1',
      period: 0,
      records: [
        { studentId: 'a', status: 'PRESENT' },
        { studentId: 'a', status: 'ABSENT' },
        { studentId: 'b', status: 'INVALID' as never },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain('studentId');
    expect(result.errors.map((e) => e.field)).toContain('status');

    const oversized = validateBulkAttendance(
      {
        date: '2026-02-01',
        classId: 'c1',
        sectionId: 's1',
        period: 0,
        records: Array.from({ length: 3 }, (_, i) => ({
          studentId: String(i),
          status: 'PRESENT' as const,
        })),
      },
      { maxRecords: 2 },
    );
    expect(oversized.errors.some((e) => e.message.includes('limited'))).toBe(true);
  });

  it('produces stable idempotency keys independent of input order', () => {
    const base = {
      date: '2026-02-01',
      classId: 'c1',
      sectionId: 's1',
      period: 0,
      records: [
        { studentId: 'b', status: 'PRESENT' as const },
        { studentId: 'a', status: 'ABSENT' as const },
      ],
    };
    const reordered = { ...base, records: [...base.records].reverse() };
    expect(attendanceIdempotencyKey(base)).toBe(attendanceIdempotencyKey(reordered));
    expect(attendanceIdempotencyKey({ ...base, period: 1 })).not.toBe(
      attendanceIdempotencyKey(base),
    );
  });

  it('stable-stringifies recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, 1] } })).toBe(
      '{"a":{"c":[3,1],"d":2},"b":1}',
    );
  });

  it('finds low attendance sorted ascending', () => {
    const low = findLowAttendance([
      {
        studentId: 'a',
        summary: summarizeAttendance([{ status: 'ABSENT' }, { status: 'PRESENT' }]),
      },
      {
        studentId: 'b',
        summary: summarizeAttendance([{ status: 'PRESENT' }]),
      },
    ]);
    expect(low.map((s) => s.studentId)).toEqual(['a']);
  });
});
