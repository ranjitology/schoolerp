import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createAcademicYearSchema,
  createClassSchema,
  createSubjectSchema,
} from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequestId, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  AcademicsService,
  classQuerySchema,
  createExamSchema,
  createSubstitutionSchema,
  createTimetableSlotSchema,
  enterMarksSchema,
  moderateMarksSchema,
  reviewSubstitutionSchema,
  substitutionQuerySchema,
  timetableCheckSchema,
  transcriptQuerySchema,
} from './academics.service';

const idParamSchema = z.object({ id: z.string().uuid() });
const examSubjectParamSchema = z.object({ examSubjectId: z.string().uuid() });
const studentParamSchema = z.object({ studentId: z.string().uuid() });
const slotParamSchema = z.object({ id: z.string().uuid() });
const reportCardQuerySchema = z.object({
  classId: z.string().uuid(),
});
const examsQuerySchema = z.object({ academicYearId: z.string().uuid().optional() });
const timetableQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
});

@Controller('academics')
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('years')
  @RequirePermissions('academics:read')
  years(@CurrentAuth() auth: AuthPrincipal) {
    return this.academics.years(auth);
  }

  @Post('years')
  @RequirePermissions('academics:write')
  createYear(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createAcademicYearSchema)) body: z.infer<typeof createAcademicYearSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.createYear(auth, body, requestMeta(request));
  }

  @Get('classes')
  @RequirePermissions('academics:read')
  classes(@CurrentAuth() auth: AuthPrincipal) {
    return this.academics.classes(auth);
  }

  @Post('classes')
  @RequirePermissions('academics:write')
  createClass(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createClassSchema)) body: z.infer<typeof createClassSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.createClass(auth, body, requestMeta(request));
  }

  @Get('subjects')
  @RequirePermissions('academics:read')
  subjects(@CurrentAuth() auth: AuthPrincipal) {
    return this.academics.subjects(auth);
  }

  @Post('subjects')
  @RequirePermissions('academics:write')
  createSubject(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createSubjectSchema)) body: z.infer<typeof createSubjectSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.createSubject(auth, body, requestMeta(request));
  }

  @Get('timetable')
  @RequirePermissions('timetable:read')
  timetable(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(timetableQuerySchema)) query: z.infer<typeof timetableQuerySchema>,
  ) {
    return this.academics.timetable(auth, query);
  }

  @Post('timetable/check')
  @RequirePermissions('timetable:read')
  @HttpCode(200)
  checkTimetable(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(timetableCheckSchema)) body: z.infer<typeof timetableCheckSchema>,
  ) {
    return this.academics.checkTimetable(auth, body);
  }

  @Post('timetable/slots')
  @RequirePermissions('timetable:write')
  createSlot(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createTimetableSlotSchema)) body: z.infer<typeof createTimetableSlotSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.createSlot(auth, body, requestMeta(request));
  }

  @Delete('timetable/slots/:id')
  @RequirePermissions('timetable:write')
  @HttpCode(200)
  deleteSlot(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(slotParamSchema)) params: z.infer<typeof slotParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.deleteSlot(auth, params.id, requestMeta(request));
  }

  @Get('timetable/substitutions')
  @RequirePermissions('timetable:read')
  substitutions(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(substitutionQuerySchema)) query: z.infer<typeof substitutionQuerySchema>,
  ) {
    return this.academics.substitutions(auth, query);
  }

  @Post('timetable/substitutions')
  @RequirePermissions('timetable:write')
  requestSubstitution(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createSubstitutionSchema)) body: z.infer<typeof createSubstitutionSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.requestSubstitution(auth, body, requestMeta(request));
  }

  @Post('timetable/substitutions/:id/review')
  @RequirePermissions('timetable:write')
  @HttpCode(200)
  reviewSubstitution(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(slotParamSchema)) params: z.infer<typeof slotParamSchema>,
    @Body(zodBody(reviewSubstitutionSchema)) body: z.infer<typeof reviewSubstitutionSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.reviewSubstitution(auth, params.id, body, requestMeta(request));
  }

  @Post('timetable/substitutions/:id/cancel')
  @RequirePermissions('timetable:write')
  @HttpCode(200)
  cancelSubstitution(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(slotParamSchema)) params: z.infer<typeof slotParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.cancelSubstitution(auth, params.id, requestMeta(request));
  }

  @Get('exams')
  @RequirePermissions('exams:read')
  exams(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(examsQuerySchema)) query: z.infer<typeof examsQuerySchema>,
  ) {
    return this.academics.exams(auth, query);
  }

  @Post('exams')
  @RequirePermissions('exams:write')
  createExam(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createExamSchema)) body: z.infer<typeof createExamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.createExam(auth, body, requestMeta(request));
  }

  @Get('exams/:id')
  @RequirePermissions('exams:read')
  examDetail(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
  ) {
    return this.academics.examDetail(auth, params.id);
  }

  @Post('exams/subjects/:examSubjectId/marks')
  @RequirePermissions('exams:write')
  @HttpCode(200)
  enterMarks(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(examSubjectParamSchema)) params: z.infer<typeof examSubjectParamSchema>,
    @Body(zodBody(enterMarksSchema)) body: z.infer<typeof enterMarksSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.enterMarks(auth, params.examSubjectId, body, requestMeta(request));
  }

  @Post('exams/:id/moderate')
  @RequirePermissions('exams:write')
  @HttpCode(200)
  moderateMarks(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(moderateMarksSchema)) body: z.infer<typeof moderateMarksSchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.moderateMarks(auth, params.id, body, requestMeta(request));
  }

  @Get('exams/:id/report-cards')
  @RequirePermissions('exams:read')
  reportCards(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Query(zodBody(reportCardQuerySchema)) query: z.infer<typeof reportCardQuerySchema>,
  ) {
    return this.academics.reportCards(auth, params.id, query.classId);
  }

  @Post('exams/:id/report-cards/job')
  @RequirePermissions('results:publish')
  @HttpCode(202)
  queueReportCards(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(reportCardQuerySchema)) body: z.infer<typeof reportCardQuerySchema>,
    @Req() request: AppRequest,
  ) {
    return this.academics.queueReportCards(auth, params.id, body.classId, requestMeta(request));
  }

  @Get('students/:studentId/transcript')
  @RequirePermissions('exams:read')
  transcript(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(studentParamSchema)) params: z.infer<typeof studentParamSchema>,
    @Query(zodBody(transcriptQuerySchema)) query: z.infer<typeof transcriptQuerySchema>,
  ) {
    return this.academics.transcript(auth, params.studentId, query);
  }

  @Post('exams/:id/publish')
  @RequirePermissions('results:publish')
  @HttpCode(200)
  publish(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @RequestId() requestId: string,
    @Req() request: AppRequest,
  ) {
    return this.academics.publishResults(auth, params.id, requestMeta(request, requestId));
  }

  @Get('classes/summary')
  @RequirePermissions('academics:read')
  classSummary(
    @Query(zodBody(classQuerySchema)) query: z.infer<typeof classQuerySchema>,
  ) {
    return { classId: query.classId ?? null };
  }
}

function requestMeta(request: AppRequest, requestId?: string) {
  return {
    requestId: requestId ?? request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
