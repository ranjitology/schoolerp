import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, isAppError } from '@schoolerp/core';
import type { AppRequest } from './request';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<AppRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (isAppError(exception)) {
      status = exception.status;
      code = exception.code;
      message = exception.expose ? exception.message : 'An unexpected error occurred';
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = 'VALIDATION_FAILED';
      message = 'Validation failed';
      details = exception.issues;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = httpCode(status);
      } else if (typeof body === 'object' && body) {
        const record = body as Record<string, unknown>;
        message = typeof record.message === 'string' ? record.message : exception.message;
        code = typeof record.code === 'string' ? record.code : httpCode(status);
        details = record.details ?? (Array.isArray(record.message) ? record.message : undefined);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        message = 'A record with the same unique value already exists';
        details = { fields: exception.meta?.target };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Record not found';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        message = 'This record is still referenced by other data';
      }
    } else if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} ${status} [${request.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId: request.requestId,
      },
    };
    response.status(status).json(body);
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}
