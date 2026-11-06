import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AppError,
  ConflictError,
  DEFAULT_GRADE_BANDS,
  NotFoundError,
  UnauthorizedError,
  academicYearFor,
  billingPeriodEnd,
  dunningActionFor,
  effectivePermissions,
  platformInvoiceNumber,
  prorationLine,
  systemRoleDefinitions,
  todayIso,
  uuidv7,
} from '@schoolerp/core';
import { z } from 'zod';
import type {
  AnnouncementInput,
  ImpersonationInput,
  OnboardingInput,
  SchoolStatus,
  UpdateTenantInput,
} from '@schoolerp/core';
import { hashPassword, verifyPassword, verifyTotp } from '@schoolerp/core/server';
import { prisma, withPlatform, withTenant, type TxClient } from '@schoolerp/db';
import { AuditService, hashEntry } from '../audit/audit.service';
import { loadEnv } from '../config/env';
import { TokenService } from '../auth/token.service';

export interface PlatformLoginInput {
  email: string;
  password: string;
  totpCode?: string;
  ip?: string;
  userAgent?: string;
  requestId: string;
}

export interface PlatformDto {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const billingPeriod = z.string().regex(/^\d{4}-\d{2}$/);

export const invoiceRunSchema = z.object({
  period: billingPeriod.optional(),
  dryRun: z.boolean().default(false),
});
export type InvoiceRunInput = z.infer<typeof invoiceRunSchema>;

export const markInvoicePaidSchema = z.object({
  paidAt: isoDate.optional(),
  reference: z.string().trim().max(80).optional(),
});
export type MarkInvoicePaidInput = z.infer<typeof markInvoicePaidSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const dunningRunSchema = z.object({
  asOf: isoDate.optional(),
  dryRun: z.boolean().default(false),
});
export type DunningRunInput = z.infer<typeof dunningRunSchema>;

export const changePlanSchema = z.object({
  planId: z.string().uuid(),
  prorate: z.boolean().default(true),
  reason: z.string().trim().max(300).optional(),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export interface PlatformBillingMeta {
  platformUserId: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(input: PlatformLoginInput) {
    const user = await prisma.platformUser.findUnique({ where: { email: input.email } });
    if (!user) {
      await verifyPassword(await dummyPasswordHash(), input.password);
      throw new UnauthorizedError('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedError('This account is not active');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', 423);
    }

    const verification = await verifyPassword(user.passwordHash, input.password);
    if (!verification.valid) {
      const attempts = user.failedAttempts + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
      await prisma.platformUser.update({
        where: { id: user.id },
        data: { failedAttempts: attempts, lockedUntil },
      });
      await this.audit.recordPlatform({
        platformUserId: user.id,
        action: 'platform.login_failed',
        entity: 'PlatformUser',
        entityId: user.id,
        requestId: input.requestId,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (user.totpEnabled) {
      if (!input.totpCode) {
        throw new AppError('TWO_FACTOR_REQUIRED', 'Enter your authenticator code', 401);
      }
      if (!user.totpSecret) {
        throw new AppError('TWO_FACTOR_REQUIRED', 'Two-factor is misconfigured', 401);
      }
      const result = verifyTotp(user.totpSecret, input.totpCode);
      if (!result.valid || result.step === null) {
        throw new AppError('INVALID_TWO_FACTOR_CODE', 'Invalid authenticator code', 401);
      }
      if (user.totpLastStep !== null && result.step <= user.totpLastStep) {
        throw new AppError('INVALID_TWO_FACTOR_CODE', 'This code has already been used', 401);
      }
      await prisma.platformUser.update({
        where: { id: user.id },
        data: { totpLastStep: result.step },
      });
    }

    await prisma.platformUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
        ...(verification.needsRehash
          ? { passwordHash: await hashPassword(input.password) }
          : {}),
      },
    });
    await this.audit.recordPlatform({
      platformUserId: user.id,
      action: 'platform.login',
      entity: 'PlatformUser',
      entityId: user.id,
      requestId: input.requestId,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken: this.tokens.signPlatformAccess({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
      accessTokenExpiresIn: loadEnv().PLATFORM_TOKEN_TTL_SECONDS,
      user: toPlatformDto(user),
    };
  }

  async me(platformUserId: string): Promise<PlatformDto> {
    const user = await prisma.platformUser.findUnique({ where: { id: platformUserId } });
    if (!user) throw new UnauthorizedError('Platform account not found');
    return toPlatformDto(user);
  }

  async listSchools(query: { page: number; pageSize: number; q?: string; status?: SchoolStatus }) {
    const where = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { slug: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.school.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          currency: true,
          timezone: true,
          trialEndsAt: true,
          createdAt: true,
          plan: { select: { code: true, name: true } },
          subscription: {
            select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
          },
          _count: { select: { students: { where: { deletedAt: null } } } },
        },
      }),
      prisma.school.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async getSchool(schoolId: string) {
    const school = await prisma.school.findFirst({
      where: { id: schoolId, deletedAt: null },
      include: {
        plan: true,
        subscription: true,
        settings: true,
        _count: { select: { students: { where: { deletedAt: null } }, staff: true } },
      },
    });
    if (!school) throw new NotFoundError('School');
    return school;
  }

  async onboard(input: OnboardingInput, meta: { requestId: string; ip?: string; userAgent?: string }) {
    return withPlatform(async (tx) => {
      const existing = await tx.school.findUnique({ where: { slug: input.school.slug } });
      if (existing) throw new ConflictError('That subdomain is already in use');

      const plan = await tx.plan.findUnique({ where: { code: input.school.planCode } });
      if (!plan) throw new NotFoundError('Plan');

      const today = todayIso();
      const year = input.academicYear
        ? {
            name: input.academicYear.name,
            startDate: new Date(`${input.academicYear.startDate}T00:00:00.000Z`),
            endDate: new Date(`${input.academicYear.endDate}T00:00:00.000Z`),
          }
        : (() => {
            const range = academicYearFor(today);
            return {
              name: range.label,
              startDate: new Date(`${range.startDate}T00:00:00.000Z`),
              endDate: new Date(`${range.endDate}T00:00:00.000Z`),
            };
          })();

      const trialEndsAt = input.school.planCode === 'trial' ? new Date(Date.now() + 30 * 86_400_000) : null;
      const schoolId = uuidv7();
      const school = await tx.school.create({
        data: {
          id: schoolId,
          slug: input.school.slug,
          name: input.school.name,
          status: input.school.planCode === 'trial' ? 'TRIAL' : 'ACTIVE',
          planId: plan.id,
          timezone: input.school.timezone,
          locale: input.school.locale,
          currency: input.school.currency,
          calendarSystem: input.school.calendarSystem,
          trialEndsAt,
          branding: input.school.branding as never,
          settings: {
            create: {
              locale: input.school.locale,
              currency: input.school.currency,
              timezone: input.school.timezone,
              calendarSystem: input.school.calendarSystem,
              branding: input.school.branding as never,
            },
          },
          subscription: {
            create: {
              planId: plan.id,
              status: input.school.planCode === 'trial' ? 'TRIAL' : 'ACTIVE',
              trialEndsAt,
              currentPeriodStart: year.startDate,
              currentPeriodEnd: year.endDate,
            },
          },
        },
      });

      const roles = new Map<string, string>();
      for (const role of systemRoleDefinitions()) {
        const created = await tx.role.create({
          data: {
            id: uuidv7(),
            schoolId,
            code: role.code,
            name: role.name,
            permissions: [...role.permissions],
            isSystem: true,
          },
        });
        roles.set(role.code, created.id);
      }

      const adminId = uuidv7();
      await tx.user.create({
        data: {
          id: adminId,
          schoolId,
          roleId: roles.get('SCHOOL_ADMIN')!,
          email: input.admin.email,
          passwordHash: await hashPassword(input.admin.password),
          fullName: input.admin.fullName,
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      });

      const academicYear = await tx.academicYear.create({
        data: {
          id: uuidv7(),
          schoolId,
          name: year.name,
          startDate: year.startDate,
          endDate: year.endDate,
          calendarSystem: input.school.calendarSystem,
          isCurrent: true,
        },
      });

      await tx.gradingScale.create({
        data: {
          id: uuidv7(),
          schoolId,
          name: 'Default grading scale',
          isDefault: true,
          bands: {
            create: DEFAULT_GRADE_BANDS.map((band, index) => ({
              id: uuidv7(),
              schoolId,
              grade: band.grade,
              minPercent: band.minPercent,
              maxPercent: band.maxPercent,
              gpa: band.gpa,
              remark: band.remark ?? null,
              sequence: index + 1,
            })),
          },
        },
      });

      if (input.school.seedSampleData) {
        await seedStarterData(tx, schoolId, academicYear.id);
      }

      await this.audit.recordPlatform({
        platformUserId: null,
        action: 'platform.school_onboarded',
        entity: 'School',
        entityId: schoolId,
        schoolId,
        after: {
          slug: school.slug,
          plan: plan.code,
          adminEmail: input.admin.email,
          seeded: input.school.seedSampleData,
        },
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return {
        school: {
          id: school.id,
          slug: school.slug,
          name: school.name,
          status: school.status,
          planCode: plan.code,
        },
        adminUserId: adminId,
        academicYearId: academicYear.id,
      };
    });
  }

  async updateSchool(
    schoolId: string,
    input: UpdateTenantInput,
    meta: { platformUserId: string; requestId: string; ip?: string; userAgent?: string },
  ) {
    return withPlatform(async (tx) => {
      const before = await tx.school.findFirst({ where: { id: schoolId, deletedAt: null } });
      if (!before) throw new NotFoundError('School');

      let planId: string | undefined;
      if (input.planCode) {
        const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
        if (!plan) throw new NotFoundError('Plan');
        planId = plan.id;
      }

      const status = input.status as SchoolStatus | undefined;
      const school = await tx.school.update({
        where: { id: schoolId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(planId ? { planId } : {}),
          ...(status ? { status } : {}),
          ...(status === 'SUSPENDED' ? { suspendedAt: new Date() } : {}),
          ...(status === 'ACTIVE' ? { suspendedAt: null } : {}),
          ...(input.limitsOverride ? { limitsOverride: input.limitsOverride as never } : {}),
          ...(input.modulesOverride ? { modulesOverride: input.modulesOverride as never } : {}),
        },
      });

      if (status) {
        await tx.subscription.updateMany({
          where: { schoolId },
          data: {
            status:
              status === 'SUSPENDED'
                ? 'SUSPENDED'
                : status === 'CANCELLED'
                  ? 'CANCELLED'
                  : status === 'TRIAL'
                    ? 'TRIAL'
                    : 'ACTIVE',
          },
        });
      }

      await this.audit.recordPlatform({
        platformUserId: meta.platformUserId,
        action:
          status === 'SUSPENDED'
            ? 'platform.school_suspended'
            : status === 'ACTIVE'
              ? 'platform.school_reactivated'
              : 'platform.school_updated',
        entity: 'School',
        entityId: schoolId,
        schoolId,
        before: { name: before.name, status: before.status, planId: before.planId },
        after: {
          name: school.name,
          status: school.status,
          planId: school.planId,
          reason: input.reason ?? null,
        },
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return school;
    });
  }

  async impersonate(
    platformUserId: string,
    schoolId: string,
    input: ImpersonationInput & { targetUserId: string },
    meta: { requestId: string; ip?: string },
  ) {
    const platform = await prisma.platformUser.findUnique({ where: { id: platformUserId } });
    if (!platform) throw new UnauthorizedError('Platform account not found');
    if (platform.role !== 'SUPER_ADMIN') {
      throw new AppError('FORBIDDEN', 'Only a super admin can impersonate a user', 403);
    }
    if (platform.totpEnabled) {
      if (!platform.totpSecret) {
        throw new AppError('TWO_FACTOR_REQUIRED', 'Two-factor is misconfigured', 401);
      }
      const result = verifyTotp(platform.totpSecret, input.totpCode);
      if (!result.valid || result.step === null) {
        throw new AppError('INVALID_TWO_FACTOR_CODE', 'Invalid authenticator code', 401);
      }
      if (platform.totpLastStep !== null && result.step <= platform.totpLastStep) {
        throw new AppError('INVALID_TWO_FACTOR_CODE', 'This code has already been used', 401);
      }
      await prisma.platformUser.update({
        where: { id: platform.id },
        data: { totpLastStep: result.step },
      });
    }

    const result = await withTenant({ schoolId }, async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: input.targetUserId, schoolId, deletedAt: null },
        include: { role: true },
      });
      if (!target || target.status !== 'ACTIVE') throw new NotFoundError('User');

      const jti = randomBytes(16).toString('hex');
      const session = await tx.impersonationSession.create({
        data: {
          id: uuidv7(),
          platformUserId,
          schoolId,
          targetUserId: target.id,
          reason: input.reason,
          consentRef: input.consentRef,
          tokenJti: jti,
          expiresAt: new Date(Date.now() + input.durationMinutes * 60_000),
          ip: meta.ip ?? null,
        },
      });
      await this.audit.record(
        tx,
        {
          schoolId,
          userId: target.id,
          actorType: 'PLATFORM_USER',
          requestId: meta.requestId,
          impersonationId: session.id,
          ip: meta.ip,
        },
        {
          action: 'auth.impersonation_started',
          entity: 'User',
          entityId: target.id,
          after: { reason: input.reason, consentRef: input.consentRef },
        },
      );

      const accessToken = this.tokens.signTenantAccess(
        {
          sub: target.id,
          sid: schoolId,
          role: target.role.code,
          email: target.email,
          name: target.fullName,
          imp: true,
          impId: session.id,
          pid: platformUserId,
        },
        input.durationMinutes * 60,
      );

      return {
        accessToken,
        expiresAt: session.expiresAt,
        sessionId: session.id,
        user: {
          id: target.id,
          fullName: target.fullName,
          email: target.email,
          roleCode: target.role.code,
          permissions: [...effectivePermissions({ roleCode: target.role.code, permissions: target.role.permissions })],
        },
      };
    });

    await this.audit.recordPlatform({
      platformUserId,
      action: 'platform.impersonation_started',
      entity: 'User',
      entityId: input.targetUserId,
      schoolId,
      after: { reason: input.reason, consentRef: input.consentRef, sessionId: result.sessionId },
      requestId: meta.requestId,
      ip: meta.ip,
    });
    return result;
  }

  async endImpersonation(
    platformUserId: string,
    schoolId: string,
    sessionId: string,
    meta: { requestId: string; ip?: string },
  ) {
    await withTenant({ schoolId }, async (tx) => {
      const session = await tx.impersonationSession.findFirst({
        where: { id: sessionId, schoolId },
      });
      if (!session) throw new NotFoundError('Impersonation session');
      await tx.impersonationSession.update({
        where: { id: session.id },
        data: { endedAt: new Date() },
      });
      await this.audit.record(
        tx,
        {
          schoolId,
          userId: session.targetUserId,
          actorType: 'PLATFORM_USER',
          requestId: meta.requestId,
          impersonationId: session.id,
          ip: meta.ip,
        },
        { action: 'auth.impersonation_ended', entity: 'ImpersonationSession', entityId: session.id },
      );
    });
    await this.audit.recordPlatform({
      platformUserId,
      action: 'platform.impersonation_ended',
      entity: 'ImpersonationSession',
      entityId: sessionId,
      schoolId,
      requestId: meta.requestId,
      ip: meta.ip,
    });
    return { ended: true };
  }

  /** Subscription, plan and platform-invoice overview for the control plane. */
  async billing() {
    const [plans, subscriptions, invoices] = await Promise.all([
      prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMinor: 'asc' } }),
      withPlatform((tx) =>
        tx.subscription.findMany({
          include: {
            school: { select: { name: true, slug: true, status: true } },
            plan: { select: { code: true, name: true, priceMinor: true, currency: true, interval: true } },
          },
          orderBy: { currentPeriodEnd: 'asc' },
        }),
      ),
      withPlatform((tx) =>
        tx.platformInvoice.findMany({
          include: { school: { select: { name: true, slug: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ),
    ]);

    const priceByPlan = new Map(
      plans.map((plan) => [plan.id, plan.priceMinor / (plan.interval === 'YEARLY' ? 12 : 1)]),
    );
    const activeSubscriptions = subscriptions.filter((row) => row.status === 'ACTIVE');
    const mrrMinor = activeSubscriptions.reduce(
      (sum, row) => sum + (priceByPlan.get(row.planId) ?? 0),
      0,
    );
    const outstandingMinor = invoices
      .filter((invoice) => invoice.status === 'OPEN')
      .reduce((sum, invoice) => sum + invoice.amountMinor, 0);

    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        interval: plan.interval,
        limits: plan.limits,
      })),
      subscriptions: subscriptions.map((row) => ({
        id: row.id,
        schoolId: row.schoolId,
        schoolName: row.school.name,
        schoolSlug: row.school.slug,
        schoolStatus: row.school.status,
        planCode: row.plan.code,
        planName: row.plan.name,
        status: row.status,
        trialEndsAt: row.trialEndsAt,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        schoolId: invoice.schoolId,
        schoolName: invoice.school.name,
        amountMinor: invoice.amountMinor,
        currency: invoice.currency,
        status: invoice.status,
        dueAt: invoice.dueAt,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
      })),
      summary: {
        subscriptions: subscriptions.length,
        active: activeSubscriptions.length,
        trialing: subscriptions.filter((row) => row.status === 'TRIAL').length,
        pastDue: subscriptions.filter((row) => row.status === 'PAST_DUE').length,
        cancelled: subscriptions.filter((row) => row.status === 'CANCELLED').length,
        mrrMinor,
        outstandingMinor,
      },
    };
  }

  /**
   * Issues the platform invoices for one calendar month. Monthly plans are
   * billed every month; yearly plans are billed once in their anniversary
   * month. The run is idempotent per tenant and period.
   */
  async runInvoices(input: InvoiceRunInput, meta: PlatformBillingMeta) {
    const period = input.period ?? new Date().toISOString().slice(0, 7);
    const periodStart = new Date(`${period}-01T00:00:00.000Z`);
    const periodEnd = billingPeriodEnd(periodStart, 'MONTHLY');
    const dueAt = new Date(Date.now() + 14 * 86_400_000);

    return withPlatform(async (tx) => {
      const subscriptions = await tx.subscription.findMany({
        where: {
          status: { in: ['ACTIVE', 'PAST_DUE'] },
          school: { is: { deletedAt: null } },
        },
        include: {
          plan: true,
          school: { select: { name: true, slug: true, status: true } },
        },
        orderBy: { school: { name: 'asc' } },
      });

      const existing = await tx.platformInvoice.findMany({
        select: { number: true, schoolId: true },
      });
      const takenNumbers = new Set(existing.map((row) => row.number));
      const created: {
        id: string;
        number: string;
        schoolId: string;
        schoolName: string;
        amountMinor: number;
        currency: string;
        period: string;
      }[] = [];
      const skipped: { schoolId: string; schoolName: string; reason: string }[] = [];

      for (const subscription of subscriptions) {
        const yearlyDue =
          subscription.plan.interval !== 'YEARLY' ||
          subscription.currentPeriodStart.toISOString().slice(0, 7) === period;
        if (!yearlyDue) {
          skipped.push({
            schoolId: subscription.schoolId,
            schoolName: subscription.school.name,
            reason: 'Yearly plan is not due this month',
          });
          continue;
        }

        if (!subscription.school.slug) {
          skipped.push({
            schoolId: subscription.schoolId,
            schoolName: subscription.school.name,
            reason: 'Tenant has no slug',
          });
          continue;
        }

        const base = platformInvoiceNumber(subscription.school.slug, period, 1);
        const alreadyBilled = existing.some(
          (row) => row.schoolId === subscription.schoolId && row.number.startsWith(base),
        );
        if (alreadyBilled) {
          skipped.push({
            schoolId: subscription.schoolId,
            schoolName: subscription.school.name,
            reason: `Invoice already exists for ${period}`,
          });
          continue;
        }

        let sequence = 1;
        let number = platformInvoiceNumber(subscription.school.slug, period, sequence);
        while (takenNumbers.has(number)) {
          sequence += 1;
          number = platformInvoiceNumber(subscription.school.slug, period, sequence);
        }

        const amountMinor =
          subscription.plan.interval === 'YEARLY'
            ? subscription.plan.priceMinor
            : subscription.plan.priceMinor;
        const lineItems = [
          {
            description: `${subscription.plan.name} · ${period}`,
            quantity: 1,
            amountMinor,
            periodStart: periodStart.toISOString().slice(0, 10),
            periodEnd: periodEnd.toISOString().slice(0, 10),
          },
        ];

        if (!input.dryRun) {
          const invoice = await tx.platformInvoice.create({
            data: {
              id: uuidv7(),
              schoolId: subscription.schoolId,
              number,
              amountMinor,
              currency: subscription.plan.currency,
              status: 'OPEN',
              dueAt,
              lineItems: lineItems as never,
            },
          });
          created.push({
            id: invoice.id,
            number: invoice.number,
            schoolId: invoice.schoolId,
            schoolName: subscription.school.name,
            amountMinor: invoice.amountMinor,
            currency: invoice.currency,
            period,
          });
        } else {
          created.push({
            id: `preview-${subscription.schoolId}`,
            number,
            schoolId: subscription.schoolId,
            schoolName: subscription.school.name,
            amountMinor,
            currency: subscription.plan.currency,
            period,
          });
        }
        takenNumbers.add(number);
      }

      const summary = {
        period,
        dryRun: input.dryRun,
        invoicesCreated: created.length,
        invoicesSkipped: skipped.length,
        totalMinor: created.reduce((sum, invoice) => sum + invoice.amountMinor, 0),
      };

      if (!input.dryRun && created.length > 0) {
        await this.audit.recordPlatform({
          platformUserId: meta.platformUserId,
          action: 'platform.invoice_run',
          entity: 'PlatformInvoice',
          after: summary,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      return { ...summary, created, skipped };
    });
  }

  /** Marks an open invoice as paid and restores a dunning-suspended tenant. */
  async markInvoicePaid(
    invoiceId: string,
    input: MarkInvoicePaidInput,
    meta: PlatformBillingMeta,
  ) {
    return withPlatform(async (tx) => {
      const invoice = await tx.platformInvoice.findUnique({
        where: { id: invoiceId },
        include: { school: { select: { name: true, slug: true } } },
      });
      if (!invoice) throw new NotFoundError('Platform invoice');
      if (invoice.status === 'VOID') {
        throw new ConflictError('A void invoice cannot be marked paid');
      }

      const paidAt = input.paidAt ? new Date(`${input.paidAt}T00:00:00.000Z`) : new Date();
      const updated = await tx.platformInvoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt },
      });

      const remaining = await tx.platformInvoice.count({
        where: { schoolId: invoice.schoolId, status: 'OPEN' },
      });
      let subscriptionRestored = false;
      if (remaining === 0) {
        const restored = await tx.subscription.updateMany({
          where: {
            schoolId: invoice.schoolId,
            status: { in: ['PAST_DUE', 'SUSPENDED'] },
          },
          data: { status: 'ACTIVE' },
        });
        subscriptionRestored = restored.count > 0;
      }

      await this.audit.recordPlatform({
        platformUserId: meta.platformUserId,
        action: 'platform.invoice_paid',
        entity: 'PlatformInvoice',
        entityId: invoiceId,
        schoolId: invoice.schoolId,
        before: { status: invoice.status },
        after: {
          status: 'PAID',
          paidAt: paidAt.toISOString(),
          reference: input.reference ?? null,
          subscriptionRestored,
        },
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return {
        ...updated,
        schoolName: invoice.school.name,
        schoolSlug: invoice.school.slug,
        subscriptionRestored,
      };
    });
  }

  async voidInvoice(invoiceId: string, reason: string, meta: PlatformBillingMeta) {
    return withPlatform(async (tx) => {
      const invoice = await tx.platformInvoice.findUnique({
        where: { id: invoiceId },
        include: { school: { select: { name: true, slug: true } } },
      });
      if (!invoice) throw new NotFoundError('Platform invoice');
      if (invoice.status === 'PAID') {
        throw new ConflictError('A paid invoice cannot be voided');
      }
      const updated = await tx.platformInvoice.update({
        where: { id: invoiceId },
        data: { status: 'VOID' },
      });
      await this.audit.recordPlatform({
        platformUserId: meta.platformUserId,
        action: 'platform.invoice_voided',
        entity: 'PlatformInvoice',
        entityId: invoiceId,
        schoolId: invoice.schoolId,
        before: { status: invoice.status },
        after: { status: 'VOID', reason },
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ...updated, schoolName: invoice.school.name, schoolSlug: invoice.school.slug };
    });
  }

  /**
   * Escalates overdue platform invoices. REMIND is reported but left to the
   * notification pipeline; PAST_DUE and SUSPEND move the subscription state so
   * the control plane reflects the risk without deleting any tenant data.
   */
  async runDunning(input: DunningRunInput, meta: PlatformBillingMeta) {
    const asOf = input.asOf ? new Date(`${input.asOf}T00:00:00.000Z`) : new Date();
    return withPlatform(async (tx) => {
      const invoices = await tx.platformInvoice.findMany({
        where: { status: 'OPEN' },
        include: { school: { select: { name: true, slug: true } } },
        orderBy: { dueAt: 'asc' },
      });

      const results: {
        invoiceId: string;
        number: string;
        schoolId: string;
        schoolName: string;
        overdueDays: number;
        action: string;
        applied: boolean;
      }[] = [];

      for (const invoice of invoices) {
        const action = dunningActionFor(invoice.dueAt, asOf);
        if (action === 'NONE') continue;
        const overdueDays = Math.max(
          0,
          Math.round((asOf.getTime() - invoice.dueAt.getTime()) / 86_400_000),
        );
        let applied = false;

        if (!input.dryRun && action === 'PAST_DUE') {
          const result = await tx.subscription.updateMany({
            where: { schoolId: invoice.schoolId, status: 'ACTIVE' },
            data: { status: 'PAST_DUE' },
          });
          applied = result.count > 0;
        }
        if (!input.dryRun && action === 'SUSPEND') {
          const result = await tx.subscription.updateMany({
            where: { schoolId: invoice.schoolId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
            data: { status: 'SUSPENDED' },
          });
          applied = result.count > 0;
        }

        results.push({
          invoiceId: invoice.id,
          number: invoice.number,
          schoolId: invoice.schoolId,
          schoolName: invoice.school.name,
          overdueDays,
          action,
          applied,
        });
      }

      const summary = {
        asOf: asOf.toISOString().slice(0, 10),
        dryRun: input.dryRun,
        checked: invoices.length,
        escalated: results.filter((row) => row.action !== 'REMIND').length,
        reminders: results.filter((row) => row.action === 'REMIND').length,
        suspended: results.filter((row) => row.action === 'SUSPEND').length,
      };

      if (!input.dryRun && results.length > 0) {
        await this.audit.recordPlatform({
          platformUserId: meta.platformUserId,
          action: 'platform.dunning_run',
          entity: 'PlatformInvoice',
          after: summary,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      return { ...summary, items: results };
    });
  }

  /**
   * Changes a tenant's plan. When `prorate` is true the unused value of the
   * current plan is credited against the new plan and any positive difference
   * becomes a platform invoice.
   */
  async changePlan(schoolId: string, input: ChangePlanInput, meta: PlatformBillingMeta) {
    return withPlatform(async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { schoolId },
        include: {
          plan: true,
          school: { select: { name: true, slug: true, status: true } },
        },
      });
      if (!subscription) throw new NotFoundError('Subscription');
      const plan = await tx.plan.findUnique({ where: { id: input.planId } });
      if (!plan || !plan.isActive) throw new NotFoundError('Plan');
      if (plan.id === subscription.planId) {
        return {
          changed: false,
          subscription,
          invoice: null,
          proration: null,
        };
      }

      const now = new Date();
      const intervalChanged = plan.interval !== subscription.plan.interval;
      const proration = input.prorate
        ? prorationLine({
            fromPlanName: subscription.plan.name,
            toPlanName: plan.name,
            fromPriceMinor: subscription.plan.priceMinor,
            toPriceMinor: plan.priceMinor,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
            changeAt: now,
          })
        : null;

      const updated = await tx.subscription.update({
        where: { schoolId },
        data: {
          planId: plan.id,
          ...(intervalChanged
            ? {
                currentPeriodStart: now,
                currentPeriodEnd: billingPeriodEnd(now, plan.interval),
              }
            : {}),
        },
        include: { plan: true },
      });

      let invoice: { id: string; number: string; amountMinor: number; currency: string } | null =
        null;
      if (proration && proration.amountMinor !== 0) {
        const period = now.toISOString().slice(0, 7);
        const number = await nextInvoiceNumber(
          tx,
          subscription.schoolId,
          subscription.school.slug,
          period,
        );
        const dueAt = new Date(now.getTime() + 14 * 86_400_000);
        const created = await tx.platformInvoice.create({
          data: {
            id: uuidv7(),
            schoolId: subscription.schoolId,
            number,
            amountMinor: Math.max(0, proration.amountMinor),
            currency: plan.currency,
            status: 'OPEN',
            dueAt,
            lineItems: [
              {
                description: proration.description,
                quantity: proration.quantity,
                amountMinor: proration.amountMinor,
                reason: input.reason ?? null,
              },
            ] as never,
          },
        });
        invoice = {
          id: created.id,
          number: created.number,
          amountMinor: created.amountMinor,
          currency: created.currency,
        };
      }

      await this.audit.recordPlatform({
        platformUserId: meta.platformUserId,
        action: 'platform.plan_changed',
        entity: 'Subscription',
        entityId: subscription.id,
        schoolId,
        before: { planCode: subscription.plan.code, status: subscription.status },
        after: {
          planCode: plan.code,
          reason: input.reason ?? null,
          proration: proration ? proration.amountMinor : null,
          invoiceNumber: invoice?.number ?? null,
        },
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return {
        changed: true,
        subscription: {
          id: updated.id,
          schoolId: updated.schoolId,
          planCode: updated.plan.code,
          planName: updated.plan.name,
          status: updated.status,
          currentPeriodStart: updated.currentPeriodStart,
          currentPeriodEnd: updated.currentPeriodEnd,
        },
        invoice,
        proration,
      };
    });
  }

  /** Per-tenant usage meters plus observed job SLOs and allocated plan cost. */
  async usage() {
    const period = new Date().toISOString().slice(0, 7);
    const windowDays = 30;
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const configuredTarget = Number(process.env.TENANT_SLO_TARGET_PERCENT ?? '99');
    const targetPercent = Number.isFinite(configuredTarget)
      ? Math.min(100, Math.max(0, configuredTarget))
      : 99;

    const [schools, meters, jobs] = await Promise.all([
      prisma.school.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          dataPlane: true,
          plan: {
            select: {
              code: true,
              name: true,
              priceMinor: true,
              currency: true,
              interval: true,
            },
          },
          subscription: { select: { status: true, currentPeriodEnd: true } },
          _count: {
            select: {
              students: { where: { deletedAt: null } },
              staff: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      withPlatform((tx) =>
        tx.meterUsage.findMany({ where: { period }, orderBy: { metric: 'asc' } }),
      ),
      withPlatform((tx) =>
        tx.backgroundJob.findMany({
          where: { createdAt: { gte: since } },
          select: {
            schoolId: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50_000,
        }),
      ),
    ]);

    const meterBySchool = new Map<string, Record<string, number>>();
    for (const meter of meters) {
      const current = meterBySchool.get(meter.schoolId) ?? {};
      current[meter.metric] = meter.value;
      meterBySchool.set(meter.schoolId, current);
    }

    const jobsBySchool = new Map<
      string,
      {
        total: number;
        completed: number;
        failed: number;
        queued: number;
        running: number;
        durationsMs: number[];
      }
    >();
    for (const job of jobs) {
      const stats = jobsBySchool.get(job.schoolId) ?? {
        total: 0,
        completed: 0,
        failed: 0,
        queued: 0,
        running: 0,
        durationsMs: [],
      };
      stats.total += 1;
      if (job.status === 'COMPLETED') stats.completed += 1;
      else if (job.status === 'FAILED') stats.failed += 1;
      else if (job.status === 'RUNNING') stats.running += 1;
      else stats.queued += 1;
      if (job.startedAt && job.completedAt) {
        const duration = job.completedAt.getTime() - job.startedAt.getTime();
        if (Number.isFinite(duration) && duration >= 0) stats.durationsMs.push(duration);
      }
      jobsBySchool.set(job.schoolId, stats);
    }

    const bySchool = schools.map((school) => {
      const stats = jobsBySchool.get(school.id) ?? {
        total: 0,
        completed: 0,
        failed: 0,
        queued: 0,
        running: 0,
        durationsMs: [],
      };
      const finished = stats.completed + stats.failed;
      const successRate =
        finished > 0 ? Number(((stats.completed / finished) * 100).toFixed(2)) : null;
      const sloStatus =
        successRate === null
          ? ('NO_DATA' as const)
          : successRate >= targetPercent
            ? ('OK' as const)
            : successRate >= targetPercent - 1
              ? ('AT_RISK' as const)
              : ('BREACH' as const);
      const durations = [...stats.durationsMs].sort((a, b) => a - b);
      const avgDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
          : null;
      const p95Index = durations.length > 0
        ? Math.min(durations.length - 1, Math.floor(durations.length * 0.95))
        : -1;
      const p95DurationMs = p95Index >= 0 ? (durations[p95Index] ?? null) : null;

      const annualPlanMinor = school.plan?.priceMinor ?? 0;
      const monthlyPlanMinor =
        school.plan?.interval === 'YEARLY'
          ? Math.round(annualPlanMinor / 12)
          : annualPlanMinor;
      const meteredStudents =
        meterBySchool.get(school.id)?.students ?? school._count.students;

      return {
        id: school.id,
        name: school.name,
        slug: school.slug,
        status: school.status,
        dataPlane: school.dataPlane,
        planCode: school.plan?.code ?? null,
        planName: school.plan?.name ?? null,
        subscriptionStatus: school.subscription?.status ?? null,
        subscriptionPeriodEnd: school.subscription?.currentPeriodEnd ?? null,
        students: school._count.students,
        staff: school._count.staff,
        meters: meterBySchool.get(school.id) ?? {},
        slo: {
          targetPercent,
          windowDays,
          status: sloStatus,
          successRate,
          avgDurationMs,
          p95DurationMs,
          jobs: {
            total: stats.total,
            completed: stats.completed,
            failed: stats.failed,
            queued: stats.queued,
            running: stats.running,
          },
        },
        cost: {
          currency: school.plan?.currency ?? 'NPR',
          monthlyMinor: monthlyPlanMinor,
          annualMinor: annualPlanMinor,
          perStudentMinor:
            meteredStudents > 0 ? Math.round(monthlyPlanMinor / meteredStudents) : 0,
          basis: 'plan_allocation' as const,
        },
      };
    });

    const metricValues = new Map<string, number>();
    for (const meter of meters) {
      metricValues.set(meter.metric, (metricValues.get(meter.metric) ?? 0) + meter.value);
    }

    const mrrMinor = bySchool.reduce((sum, row) => sum + row.cost.monthlyMinor, 0);
    const totalStudents = bySchool.reduce((sum, row) => sum + row.students, 0);
    const totalCompleted = bySchool.reduce((sum, row) => sum + row.slo.jobs.completed, 0);
    const totalFailed = bySchool.reduce((sum, row) => sum + row.slo.jobs.failed, 0);
    const totalFinished = totalCompleted + totalFailed;
    const overallSuccessRate =
      totalFinished > 0
        ? Number(((totalCompleted / totalFinished) * 100).toFixed(2))
        : null;

    return {
      period,
      slo: {
        targetPercent,
        windowDays,
        overallSuccessRate,
        ok: bySchool.filter((row) => row.slo.status === 'OK').length,
        atRisk: bySchool.filter((row) => row.slo.status === 'AT_RISK').length,
        breach: bySchool.filter((row) => row.slo.status === 'BREACH').length,
        noData: bySchool.filter((row) => row.slo.status === 'NO_DATA').length,
        jobs: { completed: totalCompleted, failed: totalFailed },
      },
      cost: {
        currency: bySchool[0]?.cost.currency ?? 'NPR',
        mrrMinor,
        arrMinor: mrrMinor * 12,
        perStudentMinor: totalStudents > 0 ? Math.round(mrrMinor / totalStudents) : 0,
      },
      totals: {
        schools: schools.length,
        students: totalStudents,
        staff: bySchool.reduce((sum, row) => sum + row.staff, 0),
        meters: Object.fromEntries(metricValues),
      },
      bySchool,
    };
  }

  async listAnnouncements(query: { page: number; pageSize: number }) {    const [items, total] = await Promise.all([
      prisma.announcement.findMany({
        orderBy: { publishAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.announcement.count(),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async createAnnouncement(
    input: AnnouncementInput,
    meta: { platformUserId: string; requestId: string },
  ) {
    const announcement = await prisma.announcement.create({
      data: {
        id: uuidv7(),
        title: input.title,
        body: input.body,
        audience: input.audience,
        schoolIds: input.schoolIds,
        severity: input.severity,
        publishAt: input.publishAt ? new Date(input.publishAt) : new Date(),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: meta.platformUserId,
      },
    });
    await this.audit.recordPlatform({
      platformUserId: meta.platformUserId,
      action: 'platform.announcement_created',
      entity: 'Announcement',
      entityId: announcement.id,
      after: { title: input.title, audience: input.audience },
      requestId: meta.requestId,
    });
    return announcement;
  }

  async listAudit(query: {
    page: number;
    pageSize: number;
    action?: string;
    entity?: string;
    schoolId?: string;
    from?: string;
    to?: string;
  }) {
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.schoolId ? { schoolId: query.schoolId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { platformUser: { select: { email: true, fullName: true } } },
      }),
      prisma.platformAuditLog.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async stats() {
    const [schoolsByStatus, plans, students, staff, recentAudit] = await Promise.all([
      prisma.school.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      prisma.plan.findMany({
        where: { isActive: true },
        select: { code: true, name: true, priceMinor: true, currency: true, interval: true },
      }),
      withPlatform((tx) => tx.student.count({ where: { deletedAt: null } })),
      withPlatform((tx) => tx.staff.count({ where: { deletedAt: null } })),
      prisma.platformAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    return {
      schools: Object.fromEntries(schoolsByStatus.map((row) => [row.status, row._count])),
      totalSchools: schoolsByStatus.reduce((sum, row) => sum + row._count, 0),
      plans,
      students,
      staff,
      recentAudit,
    };
  }

  /** Exposed for the impersonation TOTP check in tests. */
  static auditHash(prevHash: string, payload: Record<string, unknown>): string {
    return hashEntry(prevHash, payload);
  }
}

let dummyHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-equaliser-not-a-real-password');
  }
  return dummyHashPromise;
}

async function nextInvoiceNumber(
  tx: TxClient,
  schoolId: string,
  schoolSlug: string,
  period: string,
): Promise<string> {
  const base = platformInvoiceNumber(schoolSlug, period, 1);
  const existing = await tx.platformInvoice.findMany({
    where: { schoolId, number: { startsWith: base } },
    select: { number: true },
  });
  const taken = new Set(existing.map((row) => row.number));
  let sequence = 1;
  let number = base;
  while (taken.has(number)) {
    sequence += 1;
    number = platformInvoiceNumber(schoolSlug, period, sequence);
  }
  return number;
}

function toPlatformDto(user: {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';
}): PlatformDto {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

async function seedStarterData(
  tx: TxClient,
  schoolId: string,
  academicYearId: string,
): Promise<void> {
  const subjects = [
    ['ENG', 'English'],
    ['NEP', 'Nepali'],
    ['MAT', 'Mathematics'],
    ['SCI', 'Science'],
  ] as const;
  const subjectIds = new Map<string, string>();
  for (const [code, name] of subjects) {
    const subject = await tx.subject.create({
      data: { id: uuidv7(), schoolId, code, name, type: 'THEORY', credit: 1 },
    });
    subjectIds.set(code, subject.id);
  }

  for (let index = 1; index <= 3; index += 1) {
    const klass = await tx.class.create({
      data: { id: uuidv7(), schoolId, name: `Class ${index}`, sequence: index },
    });
    const section = await tx.section.create({
      data: { id: uuidv7(), schoolId, classId: klass.id, name: 'A', capacity: 40 },
    });
    for (const subjectId of subjectIds.values()) {
      await tx.classSubject.create({
        data: {
          id: uuidv7(),
          schoolId,
          classId: klass.id,
          subjectId,
          weeklyPeriods: 4,
        },
      });
    }
    void section;
  }

  for (const [code, name] of [
    ['TUI', 'Tuition Fee'],
    ['ADM', 'Admission Fee'],
    ['EXM', 'Examination Fee'],
  ] as const) {
    await tx.feeHead.create({
      data: { id: uuidv7(), schoolId, code, name, isRecurring: code === 'TUI' },
    });
  }

  await tx.timetablePeriod.createMany({
    data: Array.from({ length: 6 }, (_, index) => ({
      id: uuidv7(),
      schoolId,
      name: `Period ${index + 1}`,
      sequence: index + 1,
      startTime: `${String(9 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
      endTime: `${String(9 + Math.floor((index + 1) / 2)).padStart(2, '0')}:${(index + 1) % 2 === 0 ? '00' : '30'}`,
    })),
  });

  void academicYearId;
}
