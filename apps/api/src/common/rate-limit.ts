import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from './request';

interface WindowState {
  count: number;
  resetAt: number;
}

/**
 * Small in-process fixed-window limiter for the authentication endpoints.
 *
 * It is intentionally dependency-free: the single API process needs a cheap
 * brute-force guard even before Redis is available. The Redis-backed global
 * limiter is layered in front of the API by the reverse proxy / gateway in
 * production (see docker/nginx.conf and the Phase 1 runbook).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private static readonly windows = new Map<string, WindowState>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const key = `${request.method}:${request.route?.path ?? request.path}:${request.ip ?? 'unknown'}`;
    const now = Date.now();
    const windowMs = 60_000;
    const max = 20;

    let state = AuthRateLimitGuard.windows.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + windowMs };
      AuthRateLimitGuard.windows.set(key, state);
    }
    state.count += 1;

    if (state.count > max) {
      const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please wait before trying again.',
          details: { retryAfterSeconds: retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (AuthRateLimitGuard.windows.size > 10_000) {
      for (const [entryKey, entry] of AuthRateLimitGuard.windows) {
        if (entry.resetAt <= now) AuthRateLimitGuard.windows.delete(entryKey);
      }
    }
    return true;
  }

  /** Test helper. */
  static reset(): void {
    AuthRateLimitGuard.windows.clear();
  }
}

/**
 * Per-tenant request budget. It sits after authentication so the key can use
 * the resolved school and user instead of a mutable header, and it protects
 * one noisy tenant from exhausting the shared API process. The limit is
 * configurable per deployment; the reverse proxy still enforces the coarse
 * global limit.
 */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private static readonly windows = new Map<string, WindowState>();
  private static readonly defaultMax = 600;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const auth = request.auth;
    if (!auth) return true;

    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    const windowMs = 60_000;
    const max = Number.parseInt(
      process.env.TENANT_RATE_LIMIT_PER_MINUTE ?? '',
      10,
    ) || TenantRateLimitGuard.defaultMax;
    const key = `tenant:${auth.schoolId}:${auth.userId}`;

    let state = TenantRateLimitGuard.windows.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + windowMs };
      TenantRateLimitGuard.windows.set(key, state);
    }
    state.count += 1;

    const remaining = Math.max(0, max - state.count);
    response.setHeader('X-RateLimit-Limit', String(max));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(state.resetAt / 1000)));

    if (state.count > max) {
      const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests for this tenant. Please slow down.',
          details: { retryAfterSeconds: retryAfter, scope: 'tenant' },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (TenantRateLimitGuard.windows.size > 20_000) {
      for (const [entryKey, entry] of TenantRateLimitGuard.windows) {
        if (entry.resetAt <= now) TenantRateLimitGuard.windows.delete(entryKey);
      }
    }
    return true;
  }

  /** Test helper. */
  static reset(): void {
    TenantRateLimitGuard.windows.clear();
  }
}
