import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  DocumentsService,
  createStaffDocumentSchema,
  createStudentDocumentSchema,
  documentQuerySchema,
  generateDocumentSchema,
  generatedDocumentQuerySchema,
  templateQuerySchema,
  upsertTemplateSchema,
} from './documents.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('documents:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(documentQuerySchema)) query: z.infer<typeof documentQuerySchema>,
  ) {
    return this.documents.list(auth, query);
  }

  @Post('students')
  @RequirePermissions('documents:write')
  addStudent(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createStudentDocumentSchema)) body: z.infer<typeof createStudentDocumentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.documents.addStudentDocument(auth, body, meta(request));
  }

  @Post('staff')
  @RequirePermissions('documents:write')
  addStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createStaffDocumentSchema)) body: z.infer<typeof createStaffDocumentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.documents.addStaffDocument(auth, body, meta(request));
  }

  @Delete('students/:id')
  @RequirePermissions('documents:write')
  removeStudent(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.documents.removeStudentDocument(auth, params.id, meta(request));
  }

  @Delete('staff/:id')
  @RequirePermissions('documents:write')
  removeStaff(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.documents.removeStaffDocument(auth, params.id, meta(request));
  }

  @Get('templates')
  @RequirePermissions('documents:read')
  templates(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(templateQuerySchema)) query: z.infer<typeof templateQuerySchema>,
  ) {
    return this.documents.listTemplates(auth, query.code);
  }

  @Post('templates')
  @RequirePermissions('documents:write')
  upsertTemplate(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(upsertTemplateSchema)) body: z.infer<typeof upsertTemplateSchema>,
    @Req() request: AppRequest,
  ) {
    return this.documents.upsertTemplate(auth, body, meta(request));
  }

  @Post('generate')
  @RequirePermissions('documents:write')
  generate(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(generateDocumentSchema)) body: z.infer<typeof generateDocumentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.documents.generate(auth, body, meta(request));
  }

  @Get('generated')
  @RequirePermissions('documents:read')
  generated(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(generatedDocumentQuerySchema))
    query: z.infer<typeof generatedDocumentQuerySchema>,
  ) {
    return this.documents.listGenerated(auth, query);
  }

  @Get('generated/:id/download')
  @RequirePermissions('documents:read')
  async download(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Res() response: Response,
  ) {
    const file = await this.documents.downloadGenerated(auth, params.id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    response.send(file.content);
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
