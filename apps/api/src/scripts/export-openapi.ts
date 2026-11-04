/* eslint-disable no-console -- CLI export output is intentional */
import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();

  const config = new DocumentBuilder()
    .setTitle('SchoolERP API')
    .setDescription('Multi-tenant School ERP REST API')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const output = resolve(process.cwd(), 'openapi.json');
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();
  console.log(`OpenAPI document written to ${output}`);
}

void exportOpenApi();
