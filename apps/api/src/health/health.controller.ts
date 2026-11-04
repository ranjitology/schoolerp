import { Controller, Get, Header, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { prisma } from '@schoolerp/db';
import { Public } from '../common/decorators';

const startedAt = Date.now();

@Controller('health')
@Public()
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'schoolerp-api',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Database is not reachable',
      });
    }
  }

  @Get('live')
  live() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }
}

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'schoolerp_' });

export const httpRequests = new Counter({
  name: 'schoolerp_http_requests_total',
  help: 'HTTP requests handled by the API',
  labelNames: ['method', 'status'] as const,
  registers: [metricsRegistry],
});

@Controller('metrics')
@Public()
export class MetricsController {
  @Get()
  @Header('Cache-Control', 'no-store')
  async metrics(@Res() response: Response) {
    response.setHeader('Content-Type', metricsRegistry.contentType);
    response.send(await metricsRegistry.metrics());
  }
}
