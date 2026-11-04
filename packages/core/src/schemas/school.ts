import { z } from 'zod';
import { DEFAULT_GRADE_BANDS, GradeBand, validateGradeBands } from '../grading';
import {
  hexColorSchema,
  isoDateSchema,
  longTextSchema,
  optionalTrimmed,
  uuidSchema,
} from './common';

export const calendarSystemSchema = z.enum(['AD', 'BS']);

export const gradeBandSchema = z.object({
  grade: z.string().trim().min(1).max(4),
  minPercent: z.number().min(0).max(100),
  maxPercent: z.number().min(0).max(100),
  gpa: z.number().min(0).max(10),
  remark: z.string().trim().max(80).optional(),
});

export const gradingScaleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).default('Default'),
    bands: z.array(gradeBandSchema).min(1).max(20).default([...DEFAULT_GRADE_BANDS]),
    passPercent: z.number().min(0).max(100).default(33),
  })
  .superRefine((value, ctx) => {
    try {
      validateGradeBands(value.bands as GradeBand[]);
      if (!value.bands.some((b) => value.passPercent >= b.minPercent && value.passPercent < b.maxPercent)) {
        ctx.addIssue({ code: 'custom', path: ['passPercent'], message: 'Pass mark must fall in a grade band' });
      }
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['bands'],
        message: error instanceof Error ? error.message : 'Invalid grade bands',
      });
    }
  });

export const brandingSchema = z.object({
  primaryColor: hexColorSchema.default('#1d4ed8'),
  accentColor: hexColorSchema.default('#0f766e'),
  logoKey: optionalTrimmed(500),
  letterheadKey: optionalTrimmed(500),
  faviconKey: optionalTrimmed(500),
  tagline: optionalTrimmed(160),
  darkModeDefault: z.boolean().default(false),
});

export const attendancePolicySchema = z.object({
  lateCountsPresent: z.boolean().default(true),
  halfDayWeight: z.number().min(0).max(1).default(0.5),
  excludeLeaveFromDenominator: z.boolean().default(true),
  lowAttendanceThreshold: z.number().min(0).max(100).default(75),
});

export const feeSettingsSchema = z.object({
  receiptPrefix: z
    .string()
    .trim()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/)
    .default('RCPT'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(7),
  fiscalYearStartDay: z.number().int().min(1).max(28).default(16),
  lateFine: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('NONE') }),
      z.object({
        type: z.literal('FLAT_DAILY'),
        dailyMinor: z.number().int().min(0),
        graceDays: z.number().int().min(0).max(90),
        maxMinor: z.number().int().min(0).optional(),
      }),
      z.object({
        type: z.literal('PERCENT'),
        rateBps: z.number().int().min(0).max(10_000),
        graceDays: z.number().int().min(0).max(90),
        maxMinor: z.number().int().min(0).optional(),
      }),
    ])
    .default({ type: 'NONE' }),
  allowAdvancePayment: z.boolean().default(true),
});

export const schoolSettingsSchema = z.object({
  name: z.string().trim().min(2).max(160),
  legalName: optionalTrimmed(200),
  address: optionalTrimmed(500),
  phone: optionalTrimmed(24),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')),
  website: z.string().trim().url().max(200).optional().or(z.literal('')),
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .default('en-NP'),
  currency: z.string().regex(/^[A-Z]{3}$/).default('NPR'),
  timezone: z.string().min(1).max(64).default('Asia/Kathmandu'),
  calendarSystem: calendarSystemSchema.default('AD'),
  academicYearStartMonth: z.number().int().min(1).max(12).default(4),
  academicYearStartDay: z.number().int().min(1).max(28).default(1),
  workingDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5, 6]),
  periodsPerDay: z.number().int().min(1).max(14).default(8),
  periodMinutes: z.number().int().min(20).max(120).default(45),
  branding: brandingSchema.default({}),
  attendance: attendancePolicySchema.default({}),
  fees: feeSettingsSchema.default({}),
  grading: gradingScaleSchema,
  enableParentPortal: z.boolean().default(true),
  enableStudentPortal: z.boolean().default(true),
});
export type SchoolSettingsInput = z.infer<typeof schoolSettingsSchema>;

export const createAcademicYearSchema = z.object({
  name: z.string().trim().min(4).max(20),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  calendarSystem: calendarSystemSchema.default('AD'),
  isCurrent: z.boolean().default(false),
});
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;

export const termSchema = z.object({
  name: z.string().trim().min(1).max(60),
  sequence: z.number().int().min(1).max(12),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
});

export const createClassSchema = z.object({
  name: z.string().trim().min(1).max(60),
  sequence: z.number().int().min(1).max(100),
  sections: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(4),
        capacity: z.number().int().min(1).max(500).default(60),
        room: optionalTrimmed(40),
      }),
    )
    .min(1)
    .max(10),
});

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(20),
  type: z.enum(['THEORY', 'PRACTICAL', 'ACTIVITY']).default('THEORY'),
  credit: z.number().min(0).max(10).default(1),
  classIds: z.array(uuidSchema).max(30).default([]),
});

export const holidaySchema = z.object({
  name: z.string().trim().min(2).max(120),
  date: isoDateSchema,
  endDate: isoDateSchema.optional(),
  type: z.enum(['PUBLIC', 'SCHOOL', 'EXAM', 'OTHER']).default('PUBLIC'),
  description: longTextSchema.optional(),
});

export const updateSchoolProfileSchema = schoolSettingsSchema.partial();
