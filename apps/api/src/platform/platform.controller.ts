import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  announcementSchema,
  auditQuerySchema,
  impersonationSchema,
  onboardingSchema,
  platformLoginSchema,
  schoolStatusSchema,
  updateTenantSchema,
  uuidSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import {
  CurrentPlatform,
  PlatformOnly,
  RequestId,
  RequirePlatformRoles,
} from '../common/decorators';
import { AuthRateLimitGuard } from '../common/rate-limit';
import type { AppRequest, PlatformPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import {
  PlatformService,
  changePlanSchema,
  dunningRunSchema,
  invoiceRunSchema,
  markInvoicePaidSchema,
  purgeSchoolSchema,
  retentionRunSchema,
  schoolDeletionSchema,
  voidInvoiceSchema,
} from './platform.service';

const listSchoolsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  status: schoolStatusSchema.optional(),
});

const schoolIdParamSchema = z.object({ schoolId: uuidSchema });
const invoiceIdParamSchema = z.object({ invoiceId: uuidSchema });
const impersonationParamSchema = z.object({ schoolId: uuidSchema, sessionId: uuidSchema });
const impersonationBodySchema = impersonationSchema.extend({ targetUserId: uuidSchema });
const announcementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('platform')
@PlatformOnly()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Post('auth/login')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  async login(
    @Body(zodBody(platformLoginSchema)) body: z.infer<typeof platformLoginSchema>,
    @Req() request: AppRequest,
  ) {
    return this.platform.login({
      email: body.email,
      password: body.password,
      ...(body.totpCode ? { totpCode: body.totpCode } : {}),
      ip: request.ip,
      userAgent: request.header('user-agent'),
      requestId: request.requestId,
    });
  }

  @Get('me')
  @UseGuards(PlatformAuthGuard)
  me(@CurrentPlatform() platform: PlatformPrincipal) {
    return this.platform.me(platform.platformUserId);
  }

  @Get('stats')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  stats() {
    return this.platform.stats();
  }

  @Get('schools')
  @UseGuards(PlatformAuthGuard)
  listSchools(@Query(zodBody(listSchoolsQuerySchema)) query: z.infer<typeof listSchoolsQuerySchema>) {
    return this.platform.listSchools(query);
  }

  @Post('schools')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  async onboard(
    @Body(zodBody(onboardingSchema)) body: z.infer<typeof onboardingSchema>,
    @Req() request: AppRequest,
  ) {
    return this.platform.onboard(body, {
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Get('schools/:schoolId')
  @UseGuards(PlatformAuthGuard)
  getSchool(@Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>) {
    return this.platform.getSchool(params.schoolId);
  }

  @Patch('schools/:schoolId')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  updateSchool(
    @Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>,
    @Body(zodBody(updateTenantSchema)) body: z.infer<typeof updateTenantSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.updateSchool(params.schoolId, body, {
      platformUserId: platform.platformUserId,
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Post('schools/:schoolId/impersonate')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  @HttpCode(200)
  impersonate(
    @Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>,
    @Body(zodBody(impersonationBodySchema)) body: z.infer<typeof impersonationBodySchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.impersonate(platform.platformUserId, params.schoolId, body, {
      requestId: request.requestId,
      ip: request.ip,
    });
  }

  @Post('schools/:schoolId/impersonation/:sessionId/end')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  @HttpCode(200)
  endImpersonation(
    @Param(zodBody(impersonationParamSchema)) params: z.infer<typeof impersonationParamSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @RequestId() requestId: string,
    @Req() request: AppRequest,
  ) {
    return this.platform.endImpersonation(
      platform.platformUserId,
      params.schoolId,
      params.sessionId,
      { requestId, ip: request.ip },
    );
  }

  @Post('schools/:schoolId/deletion')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  @HttpCode(202)
  requestSchoolDeletion(
    @Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>,
    @Body(zodBody(schoolDeletionSchema)) body: z.infer<typeof schoolDeletionSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.requestSchoolDeletion(params.schoolId, body, billingMeta(platform, request));
  }

  @Post('schools/:schoolId/deletion/cancel')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  @HttpCode(200)
  cancelSchoolDeletion(
    @Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.cancelSchoolDeletion(params.schoolId, billingMeta(platform, request));
  }

  @Post('schools/:schoolId/purge')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  @HttpCode(200)
  purgeSchool(
    @Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>,
    @Body(zodBody(purgeSchoolSchema)) body: z.infer<typeof purgeSchoolSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.purgeSchool(params.schoolId, body, billingMeta(platform, request));
  }

  @Post('retention/run')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  @HttpCode(200)
  runRetention(
    @Body(zodBody(retentionRunSchema)) body: z.infer<typeof retentionRunSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.runRetention(body, billingMeta(platform, request));
  }

  @Get('billing')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  billing() {
    return this.platform.billing();
  }

  @Post('billing/invoices/run')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  @HttpCode(200)
  runInvoices(
    @Body(zodBody(invoiceRunSchema)) body: z.infer<typeof invoiceRunSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.runInvoices(body, billingMeta(platform, request));
  }

  @Post('billing/dunning/run')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  @HttpCode(200)
  runDunning(
    @Body(zodBody(dunningRunSchema)) body: z.infer<typeof dunningRunSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.runDunning(body, billingMeta(platform, request));
  }

  @Post('billing/invoices/:invoiceId/paid')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  @HttpCode(200)
  markInvoicePaid(
    @Param(zodBody(invoiceIdParamSchema)) params: z.infer<typeof invoiceIdParamSchema>,
    @Body(zodBody(markInvoicePaidSchema)) body: z.infer<typeof markInvoicePaidSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.markInvoicePaid(params.invoiceId, body, billingMeta(platform, request));
  }

  @Post('billing/invoices/:invoiceId/void')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  @HttpCode(200)
  voidInvoice(
    @Param(zodBody(invoiceIdParamSchema)) params: z.infer<typeof invoiceIdParamSchema>,
    @Body(zodBody(voidInvoiceSchema)) body: z.infer<typeof voidInvoiceSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.voidInvoice(
      params.invoiceId,
      body.reason,
      billingMeta(platform, request),
    );
  }

  @Patch('schools/:schoolId/plan')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  changePlan(
    @Param(zodBody(schoolIdParamSchema)) params: z.infer<typeof schoolIdParamSchema>,
    @Body(zodBody(changePlanSchema)) body: z.infer<typeof changePlanSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @Req() request: AppRequest,
  ) {
    return this.platform.changePlan(params.schoolId, body, billingMeta(platform, request));
  }

  @Get('usage')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN', 'BILLING')
  usage() {
    return this.platform.usage();
  }

  @Get('announcements')
  @UseGuards(PlatformAuthGuard)
  listAnnouncements(
    @Query(zodBody(announcementQuerySchema)) query: z.infer<typeof announcementQuerySchema>,
  ) {
    return this.platform.listAnnouncements(query);
  }

  @Post('announcements')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  createAnnouncement(
    @Body(zodBody(announcementSchema)) body: z.infer<typeof announcementSchema>,
    @CurrentPlatform() platform: PlatformPrincipal,
    @RequestId() requestId: string,
  ) {
    return this.platform.createAnnouncement(body, {
      platformUserId: platform.platformUserId,
      requestId,
    });
  }

  @Get('audit')
  @UseGuards(PlatformAuthGuard)
  @RequirePlatformRoles('SUPER_ADMIN')
  listAudit(@Query(zodBody(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    return this.platform.listAudit(query);
  }
}

function billingMeta(platform: PlatformPrincipal, request: AppRequest) {
  return {
    platformUserId: platform.platformUserId,
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
