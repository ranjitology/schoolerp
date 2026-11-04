import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AppRequest, AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';
import {
  LibraryService,
  bookQuerySchema,
  createBookSchema,
  issueBookSchema,
  issueQuerySchema,
  returnBookSchema,
  updateBookSchema,
} from './library.service';

const idParamSchema = z.object({ id: uuidSchema });

@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('summary')
  @RequirePermissions('library:read')
  summary(@CurrentAuth() auth: AuthPrincipal) {
    return this.library.summary(auth);
  }

  @Get('books')
  @RequirePermissions('library:read')
  listBooks(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(bookQuerySchema)) query: z.infer<typeof bookQuerySchema>,
  ) {
    return this.library.listBooks(auth, query);
  }

  @Post('books')
  @RequirePermissions('library:write')
  createBook(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(createBookSchema)) body: z.infer<typeof createBookSchema>,
    @Req() request: AppRequest,
  ) {
    return this.library.createBook(auth, body, meta(request));
  }

  @Patch('books/:id')
  @RequirePermissions('library:write')
  updateBook(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(updateBookSchema)) body: z.infer<typeof updateBookSchema>,
    @Req() request: AppRequest,
  ) {
    return this.library.updateBook(auth, params.id, body, meta(request));
  }

  @Get('issues')
  @RequirePermissions('library:read')
  listIssues(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(issueQuerySchema)) query: z.infer<typeof issueQuerySchema>,
  ) {
    return this.library.listIssues(auth, query);
  }

  @Post('issues')
  @RequirePermissions('library:write')
  issue(
    @CurrentAuth() auth: AuthPrincipal,
    @Body(zodBody(issueBookSchema)) body: z.infer<typeof issueBookSchema>,
    @Req() request: AppRequest,
  ) {
    return this.library.issueBook(auth, body, meta(request));
  }

  @Post('issues/:id/return')
  @RequirePermissions('library:write')
  @HttpCode(200)
  returnBook(
    @CurrentAuth() auth: AuthPrincipal,
    @Param(zodBody(idParamSchema)) params: z.infer<typeof idParamSchema>,
    @Body(zodBody(returnBookSchema)) body: z.infer<typeof returnBookSchema>,
    @Req() request: AppRequest,
  ) {
    return this.library.returnBook(auth, params.id, body, meta(request));
  }
}

function meta(request: AppRequest) {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.header('user-agent'),
  };
}
