import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_LIMITS,
  checkLimit,
  effectiveLimit,
  emptyModules,
  isModuleKey,
  moduleEnabled,
  assertWithinLimit,
} from '../src/entitlements';
import { PlanLimitError } from '../src/errors';

const context = {
  plan: { code: 'standard', limits: DEFAULT_PLAN_LIMITS.standard! },
  overrides: {},
};

describe('entitlements', () => {
  it('checks usage against plan limits', () => {
    expect(checkLimit(context, 'students', 1000, 500).allowed).toBe(true);
    expect(checkLimit(context, 'students', 1500, 1)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(() => assertWithinLimit(context, 'students', 1499, 2)).toThrow(PlanLimitError);
    expect(() => assertWithinLimit(context, 'students', 1498, 2)).not.toThrow();
  });

  it('applies per-school quotas', () => {
    const overridden = { ...context, overrides: { limits: { storageMb: 99_999 } } };
    expect(effectiveLimit(overridden, 'storageMb')).toBe(99_999);
    expect(effectiveLimit(context, 'storageMb')).toBe(10_240);
  });

  it('resolves module flags with override > plan > default', () => {
    expect(moduleEnabled(context, 'library')).toBe(true);
    expect(moduleEnabled(context, 'hostel')).toBe(false);
    expect(
      moduleEnabled({ ...context, overrides: { modules: { hostel: true } } }, 'hostel'),
    ).toBe(true);
    expect(
      moduleEnabled({ ...context, overrides: { modules: { library: false } } }, 'library'),
    ).toBe(false);
    expect(moduleEnabled({ ...context, suspended: true }, 'library')).toBe(false);
    expect(isModuleKey('transport')).toBe(true);
    expect(isModuleKey('nope')).toBe(false);
    expect(emptyModules().inventory).toBe(false);
  });

  it('rejects invalid usage and limits', () => {
    expect(() => checkLimit(context, 'students', -1)).toThrow();
    expect(() =>
      effectiveLimit(
        { ...context, plan: { code: 'x', limits: { ...context.plan.limits, students: -5 } } },
        'students',
      ),
    ).toThrow();
  });
});
