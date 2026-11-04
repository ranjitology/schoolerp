import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AppError,
  UnauthorizedError,
  effectivePermissions,
  uuidv7,
  type Permission,
} from '@schoolerp/core';
import {
  generateTotpSecret,
  hashPassword,
  otpauthUrl,
  verifyPassword,
  verifyTotp,
} from '@schoolerp/core/server';
import { prisma, withPlatform, withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import { TokenService } from './token.service';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
  requestId: string;
}

export interface LoginInput extends SessionMeta {
  schoolSlug: string;
  email: string;
  password: string;
  totpCode?: string;
}

export interface AuthenticatedUserDto {
  id: string;
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  email: string;
  fullName: string;
  roleCode: string;
  permissions: string[];
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  avatarKey: string | null;
}

export interface LoginResult {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: AuthenticatedUserDto;
}

/** A real Argon2id hash used to equalise timing when the email is unknown. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-equaliser-not-a-real-password');
  }
  return dummyHashPromise;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const school = await prisma.school.findUnique({
      where: { slug: input.schoolSlug },
      select: { id: true, slug: true, name: true, status: true, deletedAt: true, trialEndsAt: true },
    });
    if (!school || school.deletedAt) throw new UnauthorizedError('School not found');
    if (school.status === 'SUSPENDED' || school.status === 'CANCELLED') {
      throw new AppError('SCHOOL_SUSPENDED', 'This school account is not active', 403);
    }
    if (school.status === 'TRIAL' && school.trialEndsAt && school.trialEndsAt < new Date()) {
      throw new AppError('SCHOOL_SUSPENDED', 'The trial period has ended', 402);
    }

    return withTenant({ schoolId: school.id }, async (tx) => {
      const user = await tx.user.findFirst({
        where: { schoolId: school.id, email: input.email, deletedAt: null },
        include: { role: true },
      });

      if (!user) {
        await verifyPassword(await dummyHash(), input.password);
        await tx.loginHistory.create({
          data: {
            id: uuidv7(),
            schoolId: school.id,
            email: input.email,
            success: false,
            reason: 'UNKNOWN_USER',
            ip: input.ip ?? null,
            userAgent: input.userAgent?.slice(0, 500) ?? null,
          },
        });
        throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
      }

      if (user.status === 'LOCKED' || (user.lockedUntil && user.lockedUntil > new Date())) {
        throw new AppError(
          'ACCOUNT_LOCKED',
          'Too many failed attempts. Try again later or contact your administrator.',
          423,
          { lockedUntil: user.lockedUntil },
        );
      }
      if (user.status !== 'ACTIVE') {
        throw new AppError('UNAUTHORIZED', 'This account is not active', 401);
      }

      const verification = await verifyPassword(user.passwordHash, input.password);
      if (!verification.valid) {
        const attempts = user.failedAttempts + 1;
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedAttempts: attempts,
            lockedUntil,
            status: lockedUntil ? 'LOCKED' : user.status,
          },
        });
        await tx.loginHistory.create({
          data: {
            id: uuidv7(),
            schoolId: school.id,
            userId: user.id,
            email: input.email,
            success: false,
            reason: lockedUntil ? 'LOCKED' : 'BAD_PASSWORD',
            ip: input.ip ?? null,
            userAgent: input.userAgent?.slice(0, 500) ?? null,
          },
        });
        await this.audit.record(
          tx,
          auditContext(school.id, user.id, input),
          { action: 'auth.login_failed', entity: 'User', entityId: user.id },
        );
        throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
      }

      if (user.totpEnabled) {
        if (!input.totpCode) {
          throw new AppError('TWO_FACTOR_REQUIRED', 'Enter your authenticator code', 401);
        }
        const secret = user.totpSecret;
        if (!secret) throw new AppError('TWO_FACTOR_REQUIRED', 'Two-factor is misconfigured', 401);
        const totp = verifyTotp(secret, input.totpCode);
        if (!totp.valid || totp.step === null || (user.totpLastStep !== null && totp.step <= user.totpLastStep)) {
          throw new AppError('INVALID_TWO_FACTOR_CODE', 'Invalid or already-used code', 401);
        }
        await tx.user.update({ where: { id: user.id }, data: { totpLastStep: totp.step } });
      }

      const permissions = [...effectivePermissions({ roleCode: user.role.code, permissions: user.role.permissions })];
      const refresh = this.tokens.createRefreshToken();
      const refreshExpiresAt = new Date(Date.now() + this.tokens.getRefreshTtlDays() * 86_400_000);

      await tx.refreshToken.create({
        data: {
          id: uuidv7(),
          schoolId: school.id,
          userId: user.id,
          familyId: uuidv7(),
          tokenHash: refresh.hash,
          expiresAt: refreshExpiresAt,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          ...(verification.needsRehash ? { passwordHash: await hashPassword(input.password) } : {}),
        },
      });
      await tx.loginHistory.create({
        data: {
          id: uuidv7(),
          schoolId: school.id,
          userId: user.id,
          email: user.email,
          success: true,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        },
      });
      await this.audit.record(tx, auditContext(school.id, user.id, input), {
        action: 'auth.login',
        entity: 'User',
        entityId: user.id,
      });

      return {
        accessToken: this.tokens.signTenantAccess({
          sub: user.id,
          sid: school.id,
          role: user.role.code,
          email: user.email,
          name: user.fullName,
        }),
        accessTokenExpiresIn: this.tokens.getAccessTtl(),
        refreshToken: refresh.token,
        refreshTokenExpiresIn: this.tokens.getRefreshTtlDays() * 86_400,
        user: toUserDto(school, user, user.role.code, permissions),
      };
    });
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<LoginResult> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const found = await withPlatform((tx) =>
      tx.refreshToken.findUnique({
        where: { tokenHash },
        select: { id: true, schoolId: true, userId: true, familyId: true, revokedAt: true, expiresAt: true, replacedByTokenId: true },
      }),
    );
    if (!found) throw new UnauthorizedError('Refresh token is invalid');

    return withTenant({ schoolId: found.schoolId }, async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { id: found.id },
        select: { id: true, userId: true, familyId: true, revokedAt: true, expiresAt: true, replacedByTokenId: true },
      });
      if (!current) throw new UnauthorizedError('Refresh token is invalid');

      if (current.revokedAt) {
        // Reuse of a rotated token means the token may be stolen. Kill the family.
        await tx.refreshToken.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record(tx, auditContext(found.schoolId, found.userId, meta), {
          action: 'auth.refresh_reuse_detected',
          entity: 'RefreshToken',
          entityId: found.id,
        });
        throw new AppError('TOKEN_REUSED', 'Refresh token reuse detected; please sign in again', 401);
      }
      if (current.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED', 'Refresh token expired', 401);

      const user = await tx.user.findFirst({
        where: { id: found.userId, schoolId: found.schoolId, deletedAt: null },
        include: { role: true },
      });
      const school = await prisma.school.findUnique({
        where: { id: found.schoolId },
        select: { id: true, slug: true, name: true, status: true, deletedAt: true },
      });
      if (!user || !school || school.deletedAt || user.status !== 'ACTIVE') {
        throw new UnauthorizedError('Session is no longer valid');
      }

      const next = this.tokens.createRefreshToken();
      const nextId = uuidv7();
      await tx.refreshToken.create({
        data: {
          id: nextId,
          schoolId: found.schoolId,
          userId: user.id,
          familyId: current.familyId,
          tokenHash: next.hash,
          expiresAt: new Date(Date.now() + this.tokens.getRefreshTtlDays() * 86_400_000),
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 500) ?? null,
        },
      });
      await tx.refreshToken.update({
        where: { id: current.id },
        data: { revokedAt: new Date(), replacedByTokenId: nextId },
      });

      const permissions = [...effectivePermissions({ roleCode: user.role.code, permissions: user.role.permissions })];
      return {
        accessToken: this.tokens.signTenantAccess({
          sub: user.id,
          sid: found.schoolId,
          role: user.role.code,
          email: user.email,
          name: user.fullName,
        }),
        accessTokenExpiresIn: this.tokens.getAccessTtl(),
        refreshToken: next.token,
        refreshTokenExpiresIn: this.tokens.getRefreshTtlDays() * 86_400,
        user: toUserDto(school, user, user.role.code, permissions),
      };
    });
  }

  async logout(refreshToken: string, meta: SessionMeta): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const found = await withPlatform((tx) =>
      tx.refreshToken.findUnique({ where: { tokenHash }, select: { id: true, schoolId: true, userId: true } }),
    );
    if (!found) return;
    await withTenant({ schoolId: found.schoolId }, async (tx) => {
      await tx.refreshToken.updateMany({
        where: { id: found.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, auditContext(found.schoolId, found.userId, meta), {
        action: 'auth.logout',
        entity: 'RefreshToken',
        entityId: found.id,
      });
    });
  }

  async changePassword(
    auth: { userId: string; schoolId: string; requestId: string; ip?: string; userAgent?: string },
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: auth.userId } });
      if (!user) throw new UnauthorizedError();
      const valid = await verifyPassword(user.passwordHash, currentPassword);
      if (!valid.valid) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);

      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(newPassword),
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        tx,
        { schoolId: auth.schoolId, userId: auth.userId, actorType: 'USER', requestId: auth.requestId, ip: auth.ip, userAgent: auth.userAgent },
        { action: 'auth.password_changed', entity: 'User', entityId: user.id },
      );
    });
  }

  async beginTwoFactorSetup(auth: { userId: string; schoolId: string; email: string }): Promise<{
    secret: string;
    otpauthUrl: string;
  }> {
    const secret = generateTotpSecret();
    await withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.user.update({ where: { id: auth.userId }, data: { totpSecret: secret, totpEnabled: false } }),
    );
    return {
      secret,
      otpauthUrl: otpauthUrl({ issuer: 'School ERP', account: auth.email, secret }),
    };
  }

  async confirmTwoFactor(
    auth: { userId: string; schoolId: string; requestId: string },
    code: string,
  ): Promise<void> {
    await withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: auth.userId } });
      if (!user?.totpSecret) throw new AppError('BAD_REQUEST', 'Start two-factor setup first', 400);
      const result = verifyTotp(user.totpSecret, code);
      if (!result.valid || result.step === null) {
        throw new AppError('INVALID_TWO_FACTOR_CODE', 'Invalid code', 400);
      }
      await tx.user.update({
        where: { id: user.id },
        data: { totpEnabled: true, totpLastStep: result.step },
      });
      await this.audit.record(
        tx,
        { schoolId: auth.schoolId, userId: auth.userId, actorType: 'USER', requestId: auth.requestId },
        { action: 'auth.2fa_enabled', entity: 'User', entityId: user.id },
      );
    });
  }

  async disableTwoFactor(
    auth: { userId: string; schoolId: string; requestId: string },
    password: string,
    code: string,
  ): Promise<void> {
    await withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: auth.userId } });
      if (!user?.totpSecret) throw new AppError('BAD_REQUEST', 'Two-factor is not enabled', 400);
      const passwordValid = await verifyPassword(user.passwordHash, password);
      const totp = verifyTotp(user.totpSecret, code);
      if (!passwordValid.valid || !totp.valid) {
        throw new AppError('INVALID_TWO_FACTOR_CODE', 'Password or code is incorrect', 400);
      }
      await tx.user.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecret: null, totpLastStep: null },
      });
      await this.audit.record(
        tx,
        { schoolId: auth.schoolId, userId: auth.userId, actorType: 'USER', requestId: auth.requestId },
        { action: 'auth.2fa_disabled', entity: 'User', entityId: user.id },
      );
    });
  }

  /**
   * Always returns a generic success. In development the token is returned so
   * the reset flow can be exercised without an SMTP server; production sends
   * it by email and never exposes it in the response.
   */
  async requestPasswordReset(input: {
    schoolSlug: string;
    email: string;
    requestId: string;
    ip?: string;
  }): Promise<{ token?: string }> {
    const school = await prisma.school.findUnique({
      where: { slug: input.schoolSlug },
      select: { id: true, deletedAt: true },
    });
    if (!school || school.deletedAt) return {};

    return withTenant({ schoolId: school.id }, async (tx) => {
      const user = await tx.user.findFirst({
        where: { schoolId: school.id, email: input.email, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') return {};

      const token = randomBytes(32).toString('base64url');
      await tx.passwordResetToken.create({
        data: {
          id: uuidv7(),
          schoolId: school.id,
          userId: user.id,
          tokenHash: this.tokens.hashRefreshToken(token),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      await this.audit.record(
        tx,
        {
          schoolId: school.id,
          userId: null,
          actorType: 'SYSTEM',
          requestId: input.requestId,
          ip: input.ip,
        },
        { action: 'auth.password_reset_requested', entity: 'User', entityId: user.id },
      );
      return process.env.NODE_ENV === 'production' ? {} : { token };
    });
  }

  async resetPassword(input: {
    token: string;
    password: string;
    requestId: string;
    ip?: string;
  }): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(input.token);
    const found = await withPlatform((tx) =>
      tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, schoolId: true, userId: true, usedAt: true, expiresAt: true },
      }),
    );
    if (!found || found.usedAt || found.expiresAt < new Date()) {
      throw new AppError('BAD_REQUEST', 'This reset link is invalid or has expired', 400);
    }

    await withTenant({ schoolId: found.schoolId }, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: found.userId } });
      if (!user || user.status !== 'ACTIVE') {
        throw new AppError('BAD_REQUEST', 'This reset link is invalid or has expired', 400);
      }
      await tx.passwordResetToken.update({
        where: { id: found.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(input.password),
          mustChangePassword: false,
          failedAttempts: 0,
          lockedUntil: null,
          status: 'ACTIVE',
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        tx,
        {
          schoolId: found.schoolId,
          userId: user.id,
          actorType: 'USER',
          requestId: input.requestId,
          ip: input.ip,
        },
        { action: 'auth.password_reset', entity: 'User', entityId: user.id },
      );
    });
  }

  async listSessions(auth: { userId: string; schoolId: string }) {
    const rows = await withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.refreshToken.findMany({
        where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      }),
    );
    return rows;
  }

  async revokeSession(auth: { userId: string; schoolId: string; requestId: string }, id: string): Promise<void> {
    await withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { id, userId: auth.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count === 0) throw new AppError('NOT_FOUND', 'Session not found', 404);
      await this.audit.record(
        tx,
        { schoolId: auth.schoolId, userId: auth.userId, actorType: 'USER', requestId: auth.requestId },
        { action: 'auth.session_revoked', entity: 'RefreshToken', entityId: id },
      );
    });
  }
}

function auditContext(schoolId: string, userId: string | null, meta: SessionMeta) {
  return {
    schoolId,
    userId,
    actorType: 'USER' as const,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

function toUserDto(
  school: { id: string; slug: string; name: string },
  user: { id: string; email: string; fullName: string; mustChangePassword: boolean; totpEnabled: boolean; avatarKey: string | null },
  roleCode: string,
  permissions: Permission[],
): AuthenticatedUserDto {
  return {
    id: user.id,
    schoolId: school.id,
    schoolSlug: school.slug,
    schoolName: school.name,
    email: user.email,
    fullName: user.fullName,
    roleCode,
    permissions,
    mustChangePassword: user.mustChangePassword,
    twoFactorEnabled: user.totpEnabled,
    avatarKey: user.avatarKey,
  };
}

/** Exported for platform login and tests. */
export async function verifyUserPassword(hash: string, password: string) {
  return verifyPassword(hash, password);
}

export async function hashNewPassword(password: string) {
  return hashPassword(password);
}
