import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common';
import { ATTENDANCE_STATUSES } from '../attendance';

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const attendanceRecordSchema = z.object({
  studentId: uuidSchema,
  status: attendanceStatusSchema,
  remark: z.string().trim().max(500).optional(),
});

export const bulkAttendanceSchema = z.object({
  date: isoDateSchema,
  classId: uuidSchema,
  sectionId: uuidSchema,
  /** 0 = daily attendance; 1..14 = period-wise. */
  period: z.number().int().min(0).max(14).default(0),
  records: z.array(attendanceRecordSchema).min(1).max(200),
  /** Client-generated key for retries; the server also derives a canonical hash. */
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  deviceId: z.string().uuid().optional(),
  clientTimestamp: z.string().datetime({ offset: true }).optional(),
});
export type BulkAttendanceInputSchema = z.infer<typeof bulkAttendanceSchema>;

export const attendanceQuerySchema = z.object({
  classId: uuidSchema.optional(),
  sectionId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
  date: isoDateSchema.optional(),
  period: z.coerce.number().int().min(0).max(14).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const attendanceSummaryQuerySchema = z.object({
  classId: uuidSchema.optional(),
  sectionId: uuidSchema.optional(),
  from: isoDateSchema,
  to: isoDateSchema,
  threshold: z.coerce.number().min(0).max(100).optional(),
});

export const attendanceSessionParamSchema = z.object({
  date: isoDateSchema,
  classId: uuidSchema,
  sectionId: uuidSchema,
  period: z.coerce.number().int().min(0).max(14).default(0),
});

export const timetablePeriodSchema = z.object({
  name: z.string().trim().min(1).max(40),
  sequence: z.number().int().min(1).max(20),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  isBreak: z.boolean().default(false),
});

export const timetableSlotSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  periodId: uuidSchema,
  classId: uuidSchema,
  sectionId: uuidSchema,
  subjectId: uuidSchema,
  teacherId: uuidSchema.optional(),
  room: z.string().trim().max(40).optional(),
});
export type TimetableSlotInputSchema = z.infer<typeof timetableSlotSchema>;

export const timetableQuerySchema = z.object({
  classId: uuidSchema,
  sectionId: uuidSchema,
  academicYearId: uuidSchema.optional(),
});
