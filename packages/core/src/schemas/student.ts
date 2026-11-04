import { z } from 'zod';
import {
  isoDateSchema,
  longTextSchema,
  optionalTrimmed,
  paginationQuerySchema,
  phoneSchema,
} from './common';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export const STUDENT_STATUSES = [
  'ACTIVE',
  'TRANSFERRED',
  'GRADUATED',
  'WITHDRAWN',
  'SUSPENDED',
] as const;

export const genderSchema = z.enum(GENDERS);
export const studentStatusSchema = z.enum(STUDENT_STATUSES);

export const guardianSchema = z.object({
  relation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']).default('GUARDIAN'),
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  occupation: optionalTrimmed(80),
  isPrimary: z.boolean().default(false),
});
export type GuardianInput = z.infer<typeof guardianSchema>;

export const createStudentSchema = z.object({
  admissionNo: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/-]*$/, 'Use letters, numbers, hyphen or slash'),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).default(''),
  gender: genderSchema,
  dateOfBirth: isoDateSchema.optional(),
  classId: z.string().uuid(),
  sectionId: z.string().uuid(),
  rollNo: optionalTrimmed(20),
  admissionDate: isoDateSchema.optional(),
  status: studentStatusSchema.default('ACTIVE'),
  phone: phoneSchema.optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  address: optionalTrimmed(500),
  medicalNotes: optionalTrimmed(2000),
  previousSchool: optionalTrimmed(160),
  photoKey: optionalTrimmed(500),
  guardian: guardianSchema.optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema
  .omit({ admissionNo: true })
  .partial()
  .extend({
    version: z.number().int().min(1).optional(),
  });
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const studentListQuerySchema = paginationQuerySchema.extend({
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  status: studentStatusSchema.optional(),
  gender: genderSchema.optional(),
  sort: z.enum(['createdAt', 'firstName', 'admissionNo', 'rollNo']).default('createdAt'),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;

export const studentIdParamSchema = z.object({ id: z.string().uuid() });

export const promoteStudentsSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1).max(500),
  targetClassId: z.string().uuid(),
  targetSectionId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
});
export type PromoteStudentsInput = z.infer<typeof promoteStudentsSchema>;

export const transferStudentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  destinationSchool: optionalTrimmed(160),
  effectiveDate: isoDateSchema,
  issueTransferCertificate: z.boolean().default(true),
});

export const bulkImportOptionsSchema = z.object({
  mode: z.enum(['PREVIEW', 'COMMIT']).default('PREVIEW'),
  createMissingClasses: z.boolean().default(false),
  defaultSection: z.string().trim().min(1).max(4).default('A'),
  defaultAcademicYearId: z.string().uuid().optional(),
});

export const studentSearchSchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const admissionInquirySchema = z.object({
  studentName: z.string().trim().min(2).max(120),
  guardianName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  classId: z.string().uuid(),
  notes: longTextSchema.optional(),
  source: z.enum(['WALK_IN', 'PHONE', 'WEB', 'REFERRAL', 'OTHER']).default('WALK_IN'),
});

export type StudentStatus = (typeof STUDENT_STATUSES)[number];
