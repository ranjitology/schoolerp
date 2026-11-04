import { describe, expect, it } from 'vitest';
import {
  onboardingSchema,
  tenantSlugSchema,
  impersonationSchema,
} from '../src/schemas/platform';
import { schoolSettingsSchema, gradingScaleSchema } from '../src/schemas/school';
import { createStudentSchema } from '../src/schemas/student';
import { bulkAttendanceSchema } from '../src/schemas/attendance';
import { createInvoiceSchema, recordPaymentSchema } from '../src/schemas/fees';
import { loginSchema, newPasswordSchema } from '../src/schemas/auth';

describe('Zod contracts', () => {
  it('validates tenant slugs and reserved names', () => {
    expect(tenantSlugSchema.safeParse('green-valley').success).toBe(true);
    expect(tenantSlugSchema.safeParse('www').success).toBe(false);
    expect(tenantSlugSchema.safeParse('a').success).toBe(false);
  });

  it('validates onboarding payloads', () => {
    const parsed = onboardingSchema.safeParse({
      school: { name: 'Green Valley School', slug: 'green-valley' },
      admin: {
        fullName: 'Asha Rai',
        email: 'ADMIN@EXAMPLE.COM',
        password: 'Str0ng-Passphrase!',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.admin.email).toBe('admin@example.com');
      expect(parsed.data.school.currency).toBe('NPR');
      expect(parsed.data.school.seedSampleData).toBe(true);
    }
    expect(
      onboardingSchema.safeParse({
        school: { name: 'X', slug: 'www' },
        admin: { fullName: 'A', email: 'bad', password: 'short' },
      }).success,
    ).toBe(false);
  });

  it('requires auditable impersonation', () => {
    expect(
      impersonationSchema.safeParse({
        reason: 'Support ticket #123',
        consentRef: 'TICKET-123',
        totpCode: '123456',
      }).success,
    ).toBe(true);
    expect(
      impersonationSchema.safeParse({ reason: 'x', consentRef: '', totpCode: '1' }).success,
    ).toBe(false);
  });

  it('validates student payloads', () => {
    const id = '0193a000-0000-7000-8000-000000000001';
    const parsed = createStudentSchema.safeParse({
      admissionNo: 'STU-001',
      firstName: 'John',
      lastName: 'Smith',
      gender: 'MALE',
      classId: id,
      sectionId: id,
      guardian: { fullName: 'Michael Smith', phone: '+977 9800000000', isPrimary: true },
    });
    expect(parsed.success).toBe(true);
    expect(
      createStudentSchema.safeParse({ admissionNo: 'bad id!', firstName: '', gender: 'X' }).success,
    ).toBe(false);
  });

  it('validates bulk attendance limits', () => {
    const id = '0193a000-0000-7000-8000-000000000001';
    expect(
      bulkAttendanceSchema.safeParse({
        date: '2026-02-01',
        classId: id,
        sectionId: id,
        records: [{ studentId: id, status: 'PRESENT' }],
      }).success,
    ).toBe(true);
    expect(
      bulkAttendanceSchema.safeParse({
        date: '2026-02-30',
        classId: id,
        sectionId: id,
        records: [],
      }).success,
    ).toBe(false);
  });

  it('validates invoices and idempotent payments', () => {
    const id = '0193a000-0000-7000-8000-000000000001';
    expect(
      createInvoiceSchema.safeParse({
        studentId: id,
        academicYearId: id,
        issueDate: '2026-04-01',
        dueDate: '2026-04-10',
        lines: [{ description: 'Tuition', amountMinor: 100_000 }],
      }).success,
    ).toBe(true);
    expect(
      recordPaymentSchema.safeParse({
        studentId: id,
        amountMinor: 100,
        method: 'CASH',
        paidAt: '2026-04-01T10:00:00+05:45',
        idempotencyKey: id,
      }).success,
    ).toBe(true);
  });

  it('validates grading scales and school settings', () => {
    expect(gradingScaleSchema.safeParse({}).success).toBe(true);
    const invalid = gradingScaleSchema.safeParse({
      bands: [{ grade: 'A', minPercent: 50, maxPercent: 100, gpa: 4 }],
    });
    expect(invalid.success).toBe(false);

    const settings = schoolSettingsSchema.safeParse({
      name: 'Green Valley',
      grading: {},
    });
    expect(settings.success).toBe(true);
    if (settings.success) {
      expect(settings.data.currency).toBe('NPR');
      expect(settings.data.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
      expect(settings.data.grading.bands.length).toBeGreaterThan(5);
    }
  });

  it('validates login and password policy', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(newPasswordSchema.safeParse('Str0ng-Passphrase!').success).toBe(true);
    expect(newPasswordSchema.safeParse('alllowercase').success).toBe(false);
  });
});
