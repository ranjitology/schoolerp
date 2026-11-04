import { z } from 'zod';
import { emailSchema, newPasswordSchema } from './auth';
import {
  calendarSystemSchema,
  gradeBandSchema,
} from './school';
import { hexColorSchema, moduleSchema, uuidSchema } from './common';
import { validateSlug } from '../tenancy';

export const schoolStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']);
export type SchoolStatus = z.infer<typeof schoolStatusSchema>;

export const subscriptionStatusSchema = z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']);

export const planCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{1,30}$/);

export const tenantSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .superRefine((value, ctx) => {
    const result = validateSlug(value);
    if (!result.ok) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid subdomain (${result.reason ?? 'unknown'})`,
      });
    }
  });

export const onboardingSchema = z.object({
  school: z.object({
    name: z.string().trim().min(2).max(160),
    slug: tenantSlugSchema,
    timezone: z.string().min(1).max(64).default('Asia/Kathmandu'),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default('en-NP'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('NPR'),
    calendarSystem: calendarSystemSchema.default('AD'),
    planCode: planCodeSchema.default('trial'),
    seedSampleData: z.boolean().default(true),
    branding: z
      .object({
        primaryColor: hexColorSchema.default('#1d4ed8'),
        accentColor: hexColorSchema.default('#0f766e'),
        darkModeDefault: z.boolean().default(false),
      })
      .default({}),
  }),
  admin: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: emailSchema,
    password: newPasswordSchema,
  }),
  academicYear: z
    .object({
      name: z.string().trim().min(4).max(20),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const createPlanSchema = z.object({
  code: planCodeSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  priceMinor: z.number().int().min(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('NPR'),
  interval: z.enum(['MONTHLY', 'YEARLY']).default('YEARLY'),
  limits: z.object({
    students: z.number().int().min(0),
    staff: z.number().int().min(0),
    storageMb: z.number().int().min(0),
    smsCredits: z.number().int().min(0),
    modules: z.record(moduleSchema, z.boolean()),
  }),
  isActive: z.boolean().default(true),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  planCode: planCodeSchema.optional(),
  limitsOverride: z
    .object({
      students: z.number().int().min(0).optional(),
      staff: z.number().int().min(0).optional(),
      storageMb: z.number().int().min(0).optional(),
      smsCredits: z.number().int().min(0).optional(),
    })
    .optional(),
  modulesOverride: z.record(moduleSchema, z.boolean()).optional(),
  status: schoolStatusSchema.optional(),
  reason: z.string().trim().min(5).max(500).optional(),
});

export const tenantIdParamSchema = z.object({ schoolId: z.string().uuid() });

export const impersonationSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  /** Ticket/consent reference supplied by the school. */
  consentRef: z.string().trim().min(3).max(120),
  durationMinutes: z.number().int().min(5).max(60).default(15),
  totpCode: z.string().regex(/^\d{6}$/),
});
export type ImpersonationInput = z.infer<typeof impersonationSchema>;

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(5000),
  audience: z.enum(['ALL', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'SELECTED']).default('ALL'),
  schoolIds: z.array(z.string().uuid()).max(150).default([]),
  publishAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('INFO'),
});

export const tenantUsageQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['DAY', 'MONTH']).default('MONTH'),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(80).optional(),
  actorUserId: uuidSchema.optional(),
  schoolId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const gradingPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bands: z.array(gradeBandSchema).min(1).max(20),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
