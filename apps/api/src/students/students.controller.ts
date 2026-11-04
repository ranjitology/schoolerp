import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  createStudentSchema,
  studentIdParamSchema,
  studentListQuerySchema,
  studentSearchSchema,
  updateStudentSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequestId, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import { StudentsService, promoteStudentsSchema } from './students.service';

const csvImportSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  mode: z.enum(['PREVIEW', 'COMMIT']).default('PREVIEW'),
  defaultSection: z.string().trim().min(1).max(4).default('A'),
});

const exportQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
});

@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequirePermissions('students:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(studentListQuerySchema)) query: z.infer<typeof studentListQuerySchema>,
  ) {
    return this.students.list(auth, query);
  }

  @Get('search')
  @RequirePermissions('students:read')
  search(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(studentSearchSchema)) query: z.infer<typeof studentSearchSchema>,
  ) {
    return this.students.search(auth, query);
  }

  @Get('export.csv')
  @RequirePermissions('students:export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="students.csv"')
  async exportCsv(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Res() response: Response,
  ) {
    const csv = await this.students.exportCsv(auth, query);
    response.send(csv);
  }

  @Post('import')
  @RequirePermissions('students:import')
  importCsv(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(csvImportSchema)) body: z.infer<typeof csvImportSchema>,
    @Req() request: AppRequest,
  ) {
    return this.students.importCsv(
      auth,
      body.csv,
      { mode: body.mode, defaultSection: body.defaultSection },
      { requestId: request.requestId, ip: request.ip, userAgent: request.header('user-agent') },
    );
  }

  @Post('promote')
  @RequirePermissions('students:write')
  @HttpCode(200)
  promote(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(promoteStudentsSchema)) body: z.infer<typeof promoteStudentsSchema>,
    @Req() request: AppRequest,
  ) {
    return this.students.promote(auth, body, {
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Get(':id')
  @RequirePermissions('students:read')
  get(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(studentIdParamSchema)) params: z.infer<typeof studentIdParamSchema>,
  ) {
    return this.students.get(auth, params.id);
  }

  @Post()
  @RequirePermissions('students:write')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createStudentSchema)) body: z.infer<typeof createStudentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.students.create(auth, body, {
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Patch(':id')
  @RequirePermissions('students:write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(studentIdParamSchema)) params: z.infer<typeof studentIdParamSchema>,
    @Body(zodBody(updateStudentSchema)) body: z.infer<typeof updateStudentSchema>,
    @Req() request: AppRequest,
  ) {
    return this.students.update(auth, params.id, body, {
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Delete(':id')
  @RequirePermissions('students:delete')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(studentIdParamSchema)) params: z.infer<typeof studentIdParamSchema>,
    @RequestId() requestId: string,
    @Req() request: AppRequest,
  ) {
    return this.students.archive(auth, params.id, {
      requestId,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }
}
