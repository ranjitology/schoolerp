import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { resolveTenant } from '@schoolerp/core';
import { prisma } from '@schoolerp/db';
import { loadEnv } from '../config/env';
import type { AppRequest } from './request';
import { toRequestSchool } from './request';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}

/**
 * Resolves the *requested* tenant from the host (or the dev header). It does
 * not authenticate; TenantAuthGuard compares this with the token claim and
 * rejects mismatches.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  async use(req: AppRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      const env = loadEnv();
      const resolution = resolveTenant({
        host: req.headers.host,
        headerSlug: req.header('x-school-slug'),
        baseDomain: env.BASE_DOMAIN,
        allowHeader: env.ALLOW_TENANT_HEADER,
        excludeHosts: ['localhost', '127.0.0.1', '::1'],
      });

      if (resolution.slug) {
        const school = await prisma.school.findUnique({
          where: { slug: resolution.slug },
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
        });
        if (school && !school.deletedAt) {
          req.school = toRequestSchool(school);
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  }
}
