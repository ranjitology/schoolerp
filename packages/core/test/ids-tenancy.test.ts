import { describe, expect, it } from 'vitest';
import { isUuidV7, uuidv7, uuidv7Timestamp } from '../src/ids';
import { resolveTenant, extractSlugFromHost, validateSlug, normalizeSlug, assertTenantMatch } from '../src/tenancy';
import { TenantMismatchError, UnauthorizedError } from '../src/errors';

describe('uuidv7', () => {
  it('produces valid, versioned UUIDs', () => {
    const id = uuidv7();
    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]?.toLowerCase());
  });

  it('embeds the timestamp and is monotonic for the same millisecond', () => {
    const now = 1_760_000_000_000;
    const ids = Array.from({ length: 100 }, () => uuidv7({ now }));
    expect(uuidv7Timestamp(ids[0]!)).toBe(now);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(100);
  });

  it('remains monotonic when the clock moves backwards', () => {
    const now = 1_760_000_000_000;
    const first = uuidv7({ now });
    const second = uuidv7({ now: now - 5000 });
    expect(second > first).toBe(true);
  });

  it('rejects non-v7 values', () => {
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(() => uuidv7Timestamp('not-a-uuid')).toThrow();
  });
});

describe('tenant resolution', () => {
  it('normalises slugs', () => {
    expect(normalizeSlug('  Green Valley  School ')).toBe('green-valley-school');
    expect(normalizeSlug('--a__b--')).toBe('a-b');
  });

  it('validates reserved, short and malformed slugs', () => {
    expect(validateSlug('green-valley')).toEqual({ ok: true, slug: 'green-valley' });
    expect(validateSlug('www')).toMatchObject({ ok: false, reason: 'slug_reserved' });
    expect(validateSlug('ab')).toMatchObject({ ok: false, reason: 'slug_too_short' });
    expect(validateSlug('12345')).toMatchObject({ ok: false, reason: 'slug_numeric_only' });
    expect(validateSlug('a'.repeat(40))).toMatchObject({ ok: false });
  });

  it('extracts subdomains and ignores apex, reserved and IP hosts', () => {
    expect(extractSlugFromHost('stmary.example.com', 'example.com')).toBe('stmary');
    expect(extractSlugFromHost('stmary.example.com:3000', 'example.com')).toBe('stmary');
    expect(extractSlugFromHost('stmary.localhost:5173', '')).toBe('stmary');
    expect(extractSlugFromHost('example.com', 'example.com')).toBeNull();
    expect(extractSlugFromHost('api.example.com', 'example.com')).toBeNull();
    expect(extractSlugFromHost('127.0.0.1:3000', '')).toBeNull();
  });

  it('prefers token claim and supports a dev header', () => {
    expect(
      resolveTenant({ host: 'other.example.com', tokenSchoolId: 'school-1', baseDomain: 'example.com' }),
    ).toEqual({ slug: null, schoolId: 'school-1', source: 'token' });
    expect(
      resolveTenant({ host: 'other.example.com', headerSlug: 'stmary', allowHeader: true }),
    ).toEqual({ slug: 'stmary', schoolId: null, source: 'header' });
    expect(resolveTenant({ host: 'stmary.example.com', baseDomain: 'example.com' })).toEqual({
      slug: 'stmary',
      schoolId: null,
      source: 'host',
    });
  });

  it('rejects tenant mismatches and missing claims', () => {
    expect(assertTenantMatch('a', 'a')).toBe('a');
    expect(() => assertTenantMatch('a', 'b')).toThrow(TenantMismatchError);
    expect(() => assertTenantMatch(null, 'b')).toThrow(TenantMismatchError);
    expect(() => assertTenantMatch('a', null)).toThrow(UnauthorizedError);
  });
});
