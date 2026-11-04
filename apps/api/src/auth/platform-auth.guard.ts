import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, UnauthorizedError } from '@schoolerp/core';
import { prisma } from '@schoolerp/db';
import { PLATFORM_ROLES_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';
import { bearerToken } from './auth.guard';
import { TokenService } from './token.service';

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedError('Platform authentication required');

    const claims = this.tokens.verifyPlatformAccess(token);
    const user = await prisma.platformUser.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        lockedUntil: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedError('Platform account is not active');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Platform account is locked', 423);
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && required.length > 0 && !required.includes(user.role)) {
      throw new AppError('FORBIDDEN', 'Your platform role cannot perform this action', 403);
    }

    request.platform = {
      platformUserId: user.id,
      email: user.email,
      role: user.role,
    };
    return true;
  }
}
