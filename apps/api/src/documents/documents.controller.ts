import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
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
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
