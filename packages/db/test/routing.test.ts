import { describe, expect, it } from 'vitest';
import {
  hasDedicatedTenantDatabase,
  parseTenantDbRoutes,
  tenantDbRoutes,
  tenantRoutingSummary,
} from '../src/routing';

const SCHOOL_A = '01920000-0000-7000-8000-000000000001';
const SCHOOL_B = '01920000-0000-7000-8000-000000000002';

describe('dedicated tenant database routing contract', () => {
  it('parses a JSON map of school ids to URLs', () => {
    const routes = parseTenantDbRoutes(
      JSON.stringify({
        [SCHOOL_A]: 'postgresql://erp:secret@db-a:5432/school_a',
        [SCHOOL_B]: 'postgresql://erp:secret@db-b:5432/school_b',
      }),
    );
    expect([...routes.keys()]).toEqual([SCHOOL_A, SCHOOL_B]);
    expect(routes.get(SCHOOL_A)).toContain('db-a');
  });

  it('parses comma separated key=url pairs', () => {
    const routes = parseTenantDbRoutes(
      `${SCHOOL_A}=postgresql://erp:secret@db-a:5432/school_a, ${SCHOOL_B}=postgresql://erp:secret@db-b:5432/school_b`,
    );
    expect(routes.get(SCHOOL_A)).toBe('postgresql://erp:secret@db-a:5432/school_a');
    expect(routes.get(SCHOOL_B)).toBe('postgresql://erp:secret@db-b:5432/school_b');
  });

  it('falls back to an empty contract when unset', () => {
    expect(parseTenantDbRoutes(undefined).size).toBe(0);
    expect(parseTenantDbRoutes('   ').size).toBe(0);
    expect(tenantRoutingSummary(undefined)).toEqual({ mode: 'shared', dedicatedTenants: 0 });
  });

  it('ignores malformed non-JSON entries instead of crashing the process', () => {
    const routes = parseTenantDbRoutes(`nonsense, ${SCHOOL_A}=postgresql://db-a/school_a`);
    expect(routes.size).toBe(1);
    expect(routes.has(SCHOOL_A)).toBe(true);
  });

  it('rejects malformed JSON configuration', () => {
    expect(() => parseTenantDbRoutes('{not-json')).toThrow(/valid JSON/);
    expect(() => parseTenantDbRoutes('["a"]')).toThrow(/object of schoolId/);
  });

  it('reports hybrid routing only for configured tenants', () => {
    const raw = `${SCHOOL_A}=postgresql://db-a/school_a`;
    expect(hasDedicatedTenantDatabase(SCHOOL_A, raw)).toBe(true);
    expect(hasDedicatedTenantDatabase(SCHOOL_B, raw)).toBe(false);
    expect(tenantRoutingSummary(raw)).toEqual({ mode: 'hybrid', dedicatedTenants: 1 });
  });

  it('reads the contract from the environment when no override is passed', () => {
    const previous = process.env.TENANT_DB_URLS;
    process.env.TENANT_DB_URLS = `${SCHOOL_A}=postgresql://db-a/school_a`;
    try {
      expect(tenantDbRoutes().has(SCHOOL_A)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TENANT_DB_URLS;
      else process.env.TENANT_DB_URLS = previous;
    }
  });
});
