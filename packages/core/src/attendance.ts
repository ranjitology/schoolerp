/**
 * Attendance domain rules. Bulk submissions are validated and canonicalised
 * client-side and re-validated server-side. The canonical hash powers
 * idempotent retries (offline outbox, double-clicks at 7 AM).
 */
import { roundPercent } from './grading';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  LEAVE: 'Leave',
};

export interface AttendancePolicy {
  lateCountsPresent: boolean;
  halfDayWeight: number;
  excludeLeaveFromDenominator: boolean;
  lowAttendanceThreshold: number;
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  lateCountsPresent: true,
  halfDayWeight: 0.5,
  excludeLeaveFromDenominator: true,
  lowAttendanceThreshold: 75,
};

export interface AttendanceRecordInput {
  studentId: string;
  status: AttendanceStatus;
  remark?: string;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  denominator: number;
  attendedEquivalent: number;
  attendancePercent: number;
}

export function summarizeAttendance(
  records: readonly { status: AttendanceStatus }[],
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY,
): AttendanceSummary {
  const counts: Record<AttendanceStatus, number> = {
    PRESENT: 0,
    ABSENT: 0,
    LATE: 0,
    HALF_DAY: 0,
    LEAVE: 0,
  };
  for (const record of records) {
    if (!ATTENDANCE_STATUSES.includes(record.status)) continue;
    counts[record.status] += 1;
  }

  const total = records.length;
  const denominator = Math.max(
    0,
    total - (policy.excludeLeaveFromDenominator ? counts.LEAVE : 0),
  );
  const attendedEquivalent =
    counts.PRESENT +
    (policy.lateCountsPresent ? counts.LATE : 0) +
    counts.HALF_DAY * policy.halfDayWeight;
  const attendancePercent =
    denominator === 0 ? 0 : roundPercent((attendedEquivalent / denominator) * 100);

  return {
    total,
    present: counts.PRESENT,
    absent: counts.ABSENT,
    late: counts.LATE,
    halfDay: counts.HALF_DAY,
    leave: counts.LEAVE,
    denominator,
    attendedEquivalent: Math.round(attendedEquivalent * 100) / 100,
    attendancePercent,
  };
}

export interface BulkAttendanceInput {
  date: string;
  classId: string;
  sectionId: string;
  period: number;
  records: readonly AttendanceRecordInput[];
}

export interface BulkAttendanceValidation {
  ok: boolean;
  errors: { index: number; field: string; message: string }[];
  records: AttendanceRecordInput[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validates a bulk attendance submit. Rejects duplicate students, unknown
 * statuses, future dates, oversized payloads and malformed ids.
 */
export function validateBulkAttendance(
  input: BulkAttendanceInput,
  options: { maxRecords?: number; today?: string; uuidPattern?: RegExp } = {},
): BulkAttendanceValidation {
  const maxRecords = options.maxRecords ?? 200;
  const errors: BulkAttendanceValidation['errors'] = [];

  if (!isIsoDate(input.date)) {
    errors.push({ index: -1, field: 'date', message: 'Date must be YYYY-MM-DD' });
  } else if (options.today && input.date > options.today) {
    errors.push({ index: -1, field: 'date', message: 'Attendance cannot be marked for a future date' });
  }
  if (!input.classId) errors.push({ index: -1, field: 'classId', message: 'Class is required' });
  if (!input.sectionId) errors.push({ index: -1, field: 'sectionId', message: 'Section is required' });
  if (!Number.isInteger(input.period) || input.period < 0) {
    errors.push({ index: -1, field: 'period', message: 'Period must be a non-negative integer' });
  }
  if (input.records.length === 0) {
    errors.push({ index: -1, field: 'records', message: 'At least one student is required' });
  }
  if (input.records.length > maxRecords) {
    errors.push({
      index: -1,
      field: 'records',
      message: `A single submission is limited to ${maxRecords} students`,
    });
  }

  const seen = new Set<string>();
  const records: AttendanceRecordInput[] = [];
  input.records.forEach((record, index) => {
    if (!record.studentId) {
      errors.push({ index, field: 'studentId', message: 'Student is required' });
    } else if (seen.has(record.studentId)) {
      errors.push({ index, field: 'studentId', message: 'Duplicate student in submission' });
    } else {
      seen.add(record.studentId);
    }
    if (!ATTENDANCE_STATUSES.includes(record.status)) {
      errors.push({ index, field: 'status', message: 'Unknown attendance status' });
    }
    if (record.remark && record.remark.length > 500) {
      errors.push({ index, field: 'remark', message: 'Remark is limited to 500 characters' });
    }
    records.push({
      studentId: record.studentId,
      status: record.status,
      ...(record.remark?.trim() ? { remark: record.remark.trim() } : {}),
    });
  });

  return { ok: errors.length === 0, errors, records };
}

/**
 * Deterministic JSON: object keys sorted recursively. Used for idempotency
 * hashes so logically identical retries produce the same digest.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * 64-bit FNV-1a in hex. Non-cryptographic: it detects accidental duplicates,
 * not attackers (the API also compares the stored request hash).
 */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function attendanceIdempotencyKey(input: BulkAttendanceInput): string {
  const canonical = {
    date: input.date,
    classId: input.classId,
    sectionId: input.sectionId,
    period: input.period,
    records: [...input.records]
      .map((r) => ({ studentId: r.studentId, status: r.status, remark: r.remark ?? '' }))
      .sort((a, b) => a.studentId.localeCompare(b.studentId)),
  };
  return fnv1a64(stableStringify(canonical));
}

export interface LowAttendanceStudent {
  studentId: string;
  attendancePercent: number;
  present: number;
  total: number;
}

export function findLowAttendance(
  summaries: readonly { studentId: string; summary: AttendanceSummary }[],
  threshold = DEFAULT_ATTENDANCE_POLICY.lowAttendanceThreshold,
): LowAttendanceStudent[] {
  return summaries
    .filter(({ summary }) => summary.denominator > 0 && summary.attendancePercent < threshold)
    .map(({ studentId, summary }) => ({
      studentId,
      attendancePercent: summary.attendancePercent,
      present: summary.present,
      total: summary.total,
    }))
    .sort((a, b) => a.attendancePercent - b.attendancePercent);
}
