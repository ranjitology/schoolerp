import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Wraps successful responses in `{ data }`. Paginated services return
 * `{ items, page, pageSize, total }`, which stays inside `data`.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return next.handle().pipe(
      map((value: unknown): unknown => {
        if (value === undefined) return { data: null };
        if (typeof value === 'object' && value !== null && 'data' in value) return value;
        return { data: value };
      }),
    );
  }
}
