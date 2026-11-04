import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { output, ZodSchema, ZodTypeAny } from 'zod';

/** Validates and coerces a request body with a shared Zod contract. */
@Injectable()
export class ZodBodyPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: result.error.issues,
      });
    }
    return result.data;
  }
}

export function zodBody<S extends ZodTypeAny>(schema: S): ZodBodyPipe<output<S>> {
  return new ZodBodyPipe(schema as unknown as ZodSchema<output<S>>);
}
