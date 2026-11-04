import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  can,
  canAll,
  canAny,
  effectivePermissions,
  isPermission,
  assertCan,
  systemRoleDefinitions,
} from '../src/rbac';
import { ForbiddenError } from '../src/errors';

describe('RBAC', () => {
  it('denies by default and grants role baselines', () => {
    expect(can(null, 'students:read')).toBe(false);
    expect(can({ roleCode: 'TEACHER' }, 'attendance:write')).toBe(true);
    expect(can({ roleCode: 'TEACHER' }, 'fees:refund')).toBe(false);
    expect(can({ roleCode: 'ACCOUNTANT' }, 'fees:collect')).toBe(true);
    expect(can({ roleCode: 'UNKNOWN' }, 'students:read')).toBe(false);
  });

  it('supports explicit grants, explicit denies and ignores unknown permissions', () => {
    const effective = effectivePermissions({
      roleCode: 'TEACHER',
      permissions: ['fees:read', 'not:a:permission'],
      overrides: { grant: ['reports:export'], deny: ['attendance:write'] },
    });
    expect(effective.has('fees:read')).toBe(true);
    expect(effective.has('reports:export')).toBe(true);
    expect(effective.has('attendance:write')).toBe(false);
    expect(effective.has('not:a:permission' as never)).toBe(false);
  });

  it('implements any/all checks', () => {
    const principal = { roleCode: 'PRINCIPAL' };
    expect(canAll(principal, ['students:read', 'exams:write'])).toBe(true);
    expect(canAll(principal, ['students:read', 'fees:refund'])).toBe(false);
    expect(canAny(principal, ['fees:refund', 'reports:read'])).toBe(true);
    expect(canAny(principal, ['fees:refund'])).toBe(false);
  });

  it('throws a forbidden error with the missing permission', () => {
    expect(() => assertCan({ roleCode: 'STUDENT' }, 'students:write')).toThrow(ForbiddenError);
    expect(() => assertCan({ roleCode: 'SCHOOL_ADMIN' }, 'students:write')).not.toThrow();
  });

  it('builds system roles for each school', () => {
    const roles = systemRoleDefinitions();
    expect(roles).toHaveLength(7);
    expect(roles.find((r) => r.code === 'SCHOOL_ADMIN')?.permissions).toContain('settings:write');
    expect(ROLE_PERMISSIONS.PARENT).toContain('portal:read');
    expect(new Set(ROLE_PERMISSIONS.SCHOOL_ADMIN).size).toBe(ROLE_PERMISSIONS.SCHOOL_ADMIN.length);
  });

  it('validates permission names', () => {
    expect(isPermission('students:read')).toBe(true);
    expect(isPermission('students:destroy')).toBe(false);
  });
});
