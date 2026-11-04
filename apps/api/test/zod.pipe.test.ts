import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodBody } from '../src/common/zod.pipe';

describe('zodBody pipe', () => {
  it('coerces query values and applies defaults', () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    });

    expect(zodBody(schema).transform({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
    expect(zodBody(schema).transform({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('supports transforming schemas whose input and output differ', () => {
    const schema = z.object({
      unreadOnly: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    });

    expect(zodBody(schema).transform({ unreadOnly: 'true' })).toEqual({ unreadOnly: true });
    expect(zodBody(schema).transform({})).toEqual({ unreadOnly: false });
  });

  it('rejects invalid input with structured details', () => {
    const schema = z.object({ email: z.string().email() });

    try {
      zodBody(schema).transform({ email: 'not-an-email' });
      throw new Error('expected validation to fail');
    } catch (error) {
      const response = error as { getResponse: () => { code: string; details: unknown[] } };
      const body = response.getResponse();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toHaveLength(1);
    }
  });
});
