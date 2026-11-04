import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AppError,
  TenantMismatchError,
  UnauthorizedError,
  effectivePermissions,
} from '@schoolerp/core';
import { prisma, withTenant } from '@schoolerp/db';
import {
  IS_PLATFORM_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  SKIP_TENANT_AUTH_KEY,
} from '../common/decorators';
import type { AppRequest } from '../common/request';
import { toRequestSchool } from '../common/request';
import { TokenService } from './token.service';

@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_AUTH_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, targets)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedError('Authentication required');

    const claims = this.tokens.verifyTenantAccess(token);
    if (request.school && request.school.id !== claims.sid) {
      throw new TenantMismatchError();
    }

    const school =
      request.school ??
      (await prisma.school.findUnique({
        where: { id: claims.sid },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          currency: true,
          timezone: true,
          locale: true,
          deletedAt: true,
        },
      }));

    if (!school || school.deletedAt) throw new UnauthorizedError('School not found');
    if (school.status === 'SUSPENDED' || school.status === 'CANCELLED') {
      throw new AppError('SCHOOL_SUSPENDED', 'This school account is not active', 403);
    }

    const result = await withTenant({ schoolId: school.id }, async (tx) => {
      if (claims.imp && claims.impId) {
        const session = await tx.impersonationSession.findFirst({
          where: {
            id: claims.impId,
            schoolId: school.id,
            endedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, platformUserId: true },
        });
        if (!session) throw new UnauthorizedError('Impersonation session has ended');
      }

      const user = await tx.user.findFirst({
        where: { id: claims.sub, schoolId: school.id, deletedAt: null },
        include: { role: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new UnauthorizedError('Account is not active');

      return {
        userId: user.id,
        schoolId: school.id,
        roleCode: user.role.code,
        permissions: effectivePermissions({
          roleCode: user.role.code,
          permissions: user.role.permissions,
        }),
        email: user.email,
        fullName: user.fullName,
        actorType: claims.imp ? ('PLATFORM_USER' as const) : ('USER' as const),
        impersonationId: claims.imp ? claims.impId : undefined,
        platformUserId: claims.imp ? claims.pid : undefined,
      };
    });

    request.school = toRequestSchool(school);
    request.auth = result;
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, targets)) return true;
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    const auth = request.auth;
    if (!auth) throw new UnauthorizedError();
    const missing = required.filter((permission) => !auth.permissions.has(permission as never));
    if (missing.length > 0) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action', 403, {
        missing,
      });
    }
    return true;
  }
}

export function bearerToken(request: AppRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
