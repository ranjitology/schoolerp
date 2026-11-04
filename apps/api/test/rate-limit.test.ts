import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AuthRateLimitGuard, TenantRateLimitGuard } from '../src/common/rate-limit';

function contextFor(path: string, ip: string): ExecutionContext {
  return contextForRequest({ method: 'POST', path, route: { path }, ip });
}

function contextForRequest(request: Record<string, unknown>): ExecutionContext {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    get headers() {
      return headers;
    },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function tenantContext(schoolId: string, userId: string): ExecutionContext {
  return contextForRequest({
    method: 'GET',
    path: '/api/v1/students',
    schoolId,
    auth: { schoolId, userId },
  });
}

describe('AuthRateLimitGuard', () => {
  afterEach(() => AuthRateLimitGuard.reset());

  it('allows requests below the per-window limit', () => {
    const guard = new AuthRateLimitGuard();
    const context = contextFor('/api/v1/auth/login', '10.0.0.1');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('blocks the request that exceeds the limit and sets Retry-After', () => {
    const guard = new AuthRateLimitGuard();
    const context = contextFor('/api/v1/auth/login', '10.0.0.2');
    for (let attempt = 0; attempt < 20; attempt += 1) guard.canActivate(context);

    try {
      guard.canActivate(context);
      throw new Error('expected the limiter to reject');
    } catch (error) {
      const response = (error as { getResponse: () => { code: string } }).getResponse();
      expect(response.code).toBe('RATE_LIMITED');
      const httpResponse = context.switchToHttp().getResponse() as unknown as {
        headers: Record<string, string>;
      };
      expect(Number(httpResponse.headers['Retry-After'])).toBeGreaterThan(0);
    }
  });

  it('keys the window by client address', () => {
    const guard = new AuthRateLimitGuard();
    const first = contextFor('/api/v1/auth/login', '10.0.0.3');
    const second = contextFor('/api/v1/auth/login', '10.0.0.4');
    for (let attempt = 0; attempt < 20; attempt += 1) guard.canActivate(first);

    expect(guard.canActivate(second)).toBe(true);
  });
});

describe('TenantRateLimitGuard', () => {
  const originalLimit = process.env.TENANT_RATE_LIMIT_PER_MINUTE;

  afterEach(() => {
    TenantRateLimitGuard.reset();
    if (originalLimit === undefined) delete process.env.TENANT_RATE_LIMIT_PER_MINUTE;
    else process.env.TENANT_RATE_LIMIT_PER_MINUTE = originalLimit;
  });

  it('allows anonymous requests without counting them', () => {
    process.env.TENANT_RATE_LIMIT_PER_MINUTE = '1';
    const guard = new TenantRateLimitGuard();
    const context = contextForRequest({ method: 'GET', path: '/api/v1/health' });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('keys the window by school and user so tenants do not share a budget', () => {
    process.env.TENANT_RATE_LIMIT_PER_MINUTE = '2';
    const guard = new TenantRateLimitGuard();
    const first = tenantContext('school-a', 'user-1');
    const secondTenant = tenantContext('school-b', 'user-2');

    expect(guard.canActivate(first)).toBe(true);
    expect(guard.canActivate(first)).toBe(true);
    expect(guard.canActivate(secondTenant)).toBe(true);
    expect(guard.canActivate(secondTenant)).toBe(true);
  });

  it('rejects over-budget requests with a retry hint', () => {
    process.env.TENANT_RATE_LIMIT_PER_MINUTE = '1';
    const guard = new TenantRateLimitGuard();
    const context = tenantContext('school-a', 'user-1');
    expect(guard.canActivate(context)).toBe(true);

    try {
      guard.canActivate(context);
      throw new Error('expected the tenant limiter to reject');
    } catch (error) {
      expect((error as { getResponse: () => { code: string } }).getResponse().code).toBe(
        'RATE_LIMITED',
      );
      const response = context.switchToHttp().getResponse() as unknown as {
        headers: Record<string, string>;
      };
      expect(Number(response.headers['Retry-After'])).toBeGreaterThan(0);
      expect(response.headers['X-RateLimit-Remaining']).toBe('0');
    }
  });
});
