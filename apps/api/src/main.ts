import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import type { NextFunction, Response } from 'express';
import { AppModule } from './app.module';
import { RequestIdMiddleware, TenantMiddleware } from './common/middleware';
import type { AppRequest } from './common/request';
import { loadEnv } from './config/env';
import { httpRequests } from './health/health.controller';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  const requestId = new RequestIdMiddleware();
  const tenant = new TenantMiddleware();
  app.use((request: AppRequest, response: Response, next: NextFunction) => {
    requestId.use(request, response, next);
  });
  app.use((request: AppRequest, response: Response, next: NextFunction) => {
    response.on('finish', () => {
      httpRequests.inc({ method: request.method, status: String(response.statusCode) });
    });
    next();
  });
  app.use((request: AppRequest, response: Response, next: NextFunction) => {
    void tenant.use(request, response, next);
  });

  if (env.TRUST_PROXY) {
    const instance = app.getHttpAdapter().getInstance() as { set: (key: string, value: unknown) => void };
    instance.set('trust proxy', 1);
  }

  const origins = env.APP_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (env.NODE_ENV !== 'production') {
    origins.push('http://localhost:5173', 'http://localhost:5174', 'tauri://localhost', 'https://tauri.localhost');
  }
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Request-Id',
      'X-School-Slug',
      'X-Client',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SchoolERP API')
    .setDescription(
      'Multi-tenant School ERP REST API. Tenant routes require a bearer access token; platform routes require a platform token.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addGlobalParameters({
      name: 'X-School-Slug',
      in: 'header',
      required: false,
      description: 'Development-only tenant override. Production resolves tenants from the subdomain.',
    })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: 'openapi.json',
  });

  await app.listen(env.PORT);
  logger.log(`API listening on http://localhost:${env.PORT}/api/v1`);
  logger.log(`OpenAPI UI at http://localhost:${env.PORT}/api/v1/docs`);
}

void bootstrap();
