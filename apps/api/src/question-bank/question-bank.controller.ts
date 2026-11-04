import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  QuestionBankService,
  createQuestionSchema,
  generatePaperSchema,
  questionQuerySchema,
  updateQuestionSchema,
} from './question-bank.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('question-bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  @Get()
  @RequirePermissions('exams:read')
  list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(questionQuerySchema)) query: z.infer<typeof questionQuerySchema>,
  ) {
    return this.bank.list(auth, query);
  }

  @Post()
  @RequirePermissions('exams:write')
  create(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createQuestionSchema)) body: z.infer<typeof createQuestionSchema>,
    @Req() request: AppRequest,
  ) {
    return this.bank.create(auth, body, meta(request));
  }

  @Patch(':id')
  @RequirePermissions('exams:write')
  update(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateQuestionSchema)) body: z.infer<typeof updateQuestionSchema>,
    @Req() request: AppRequest,
  ) {
    return this.bank.update(auth, params.id, body, meta(request));
  }

  @Delete(':id')
  @RequirePermissions('exams:write')
  remove(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Req() request: AppRequest,
  ) {
    return this.bank.remove(auth, params.id, meta(request));
  }

  @Post('papers/generate')
  @RequirePermissions('exams:write')
  generate(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(generatePaperSchema)) body: z.infer<typeof generatePaperSchema>,
    @Req() request: AppRequest,
  ) {
    return this.bank.generatePaper(auth, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
