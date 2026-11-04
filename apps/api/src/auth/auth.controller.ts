import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ForbiddenError,
  TenantMismatchError,
  changePasswordSchema,
  confirmTwoFactorSchema,
  disableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  normalizeSlug,
  refreshTokenSchema,
  resetPasswordSchema,
  tenantSlugSchema,
  uuidSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import {
  CurrentAuth,
  CurrentSchool,
  Public,
  RequestId,
  SkipTenantAuth,
} from '../common/decorators';
import { clearRefreshCookie, isDesktopClient, readRefreshCookie, setRefreshCookie } from '../common/cookies';
import { AuthRateLimitGuard } from '../common/rate-limit';
import type { AppRequest, AuthPrincipal, RequestSchool } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const tenantLoginSchema = loginSchema.extend({ schoolSlug: tenantSlugSchema });
const tenantForgotSchema = forgotPasswordSchema.extend({ schoolSlug: tenantSlugSchema });
const resetSchema = resetPasswordSchema.extend({ schoolSlug: tenantSlugSchema.optional() });
const sessionParamSchema = z.object({ id: uuidSchema });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @SkipTenantAuth()
  @UseGuards(AuthRateLimitGuard)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zodBody(tenantLoginSchema)) body: z.infer<typeof tenantLoginSchema>,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.school && request.school.slug !== normalizeSlug(body.schoolSlug)) {
      throw new TenantMismatchError('Sign in at the address for your own school');
    }
    const result = await this.auth.login({
      schoolSlug: normalizeSlug(body.schoolSlug),
      email: body.email,
      password: body.password,
      ...(body.totpCode ? { totpCode: body.totpCode } : {}),
      ip: request.ip,
      userAgent: request.header('user-agent'),
      requestId: request.requestId,
    });
    setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresIn);
    return {
      ...result,
      refreshToken: isDesktopClient(request) ? result.refreshToken : undefined,
    };
  }

  @Public()
  @SkipTenantAuth()
  @UseGuards(AuthRateLimitGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(zodBody(refreshTokenSchema)) body: z.infer<typeof refreshTokenSchema>,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readRefreshCookie(request) ?? body.refreshToken;
    if (!token) throw new ForbiddenError('No refresh token was supplied');
    const result = await this.auth.refresh(token, {
      ip: request.ip,
      userAgent: request.header('user-agent'),
      requestId: request.requestId,
    });
    setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresIn);
    return {
      ...result,
      refreshToken: isDesktopClient(request) ? result.refreshToken : undefined,
    };
  }

  @Public()
  @SkipTenantAuth()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Body(zodBody(refreshTokenSchema)) body: z.infer<typeof refreshTokenSchema>,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readRefreshCookie(request) ?? body.refreshToken;
    if (token) {
      await this.auth.logout(token, {
        ip: request.ip,
        userAgent: request.header('user-agent'),
        requestId: request.requestId,
      });
    }
    clearRefreshCookie(response);
    return { loggedOut: true };
  }

  @Public()
  @SkipTenantAuth()
  @UseGuards(AuthRateLimitGuard)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body(zodBody(tenantForgotSchema)) body: z.infer<typeof tenantForgotSchema>,
    @Req() request: AppRequest,
  ) {
    const result = await this.auth.requestPasswordReset({
      schoolSlug: normalizeSlug(body.schoolSlug),
      email: body.email,
      requestId: request.requestId,
      ip: request.ip,
    });
    return {
      message: 'If the account exists, a reset link has been sent.',
      ...(result.token ? { developmentToken: result.token } : {}),
    };
  }

  @Public()
  @SkipTenantAuth()
  @UseGuards(AuthRateLimitGuard)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(zodBody(resetSchema)) body: z.infer<typeof resetSchema>,
    @Req() request: AppRequest,
  ) {
    await this.auth.resetPassword({
      token: body.token,
      password: body.password,
      requestId: request.requestId,
      ip: request.ip,
    });
    return { message: 'Password updated. Please sign in.' };
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthPrincipal, @CurrentSchool() school: RequestSchool) {
    return {
      user: {
        id: auth.userId,
        email: auth.email,
        fullName: auth.fullName,
        roleCode: auth.roleCode,
        permissions: [...auth.permissions],
        actorType: auth.actorType,
        impersonationId: auth.impersonationId,
      },
      school,
    };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Body(zodBody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @CurrentAuth() auth: AuthPrincipal,
    @Req() request: AppRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changePassword(
      {
        userId: auth.userId,
        schoolId: auth.schoolId,
        requestId: request.requestId,
        ip: request.ip,
        userAgent: request.header('user-agent'),
      },
      body.currentPassword,
      body.newPassword,
    );
    clearRefreshCookie(response);
    return { message: 'Password changed. Please sign in again.' };
  }

  @Post('2fa/setup')
  async beginTwoFactorSetup(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.beginTwoFactorSetup({
      userId: auth.userId,
      schoolId: auth.schoolId,
      email: auth.email,
    });
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  async confirmTwoFactor(
    @Body(zodBody(confirmTwoFactorSchema)) body: z.infer<typeof confirmTwoFactorSchema>,
    @CurrentAuth() auth: AuthPrincipal,
    @Req() request: AppRequest,
  ) {
    await this.auth.confirmTwoFactor(
      { userId: auth.userId, schoolId: auth.schoolId, requestId: request.requestId },
      body.code,
    );
    return { enabled: true };
  }

  @Post('2fa/disable')
  @HttpCode(200)
  async disableTwoFactor(
    @Body(zodBody(disableTwoFactorSchema)) body: z.infer<typeof disableTwoFactorSchema>,
    @CurrentAuth() auth: AuthPrincipal,
    @Req() request: AppRequest,
  ) {
    await this.auth.disableTwoFactor(
      { userId: auth.userId, schoolId: auth.schoolId, requestId: request.requestId },
      body.password,
      body.code,
    );
    return { enabled: false };
  }

  @Get('sessions')
  async sessions(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.listSessions({ userId: auth.userId, schoolId: auth.schoolId });
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(
    @Param(zodBody(sessionParamSchema)) params: z.infer<typeof sessionParamSchema>,
    @CurrentAuth() auth: AuthPrincipal,
    @RequestId() requestId: string,
  ) {
    await this.auth.revokeSession(
      { userId: auth.userId, schoolId: auth.schoolId, requestId },
      params.id,
    );
    return { revoked: true };
  }

  @Public()
  @Get('password-policy')
  passwordPolicy() {
    return {
      minLength: 10,
      maxLength: 128,
      classesRequired: 3,
      hint: 'Mix upper case, lower case, numbers or symbols',
    };
  }
}
