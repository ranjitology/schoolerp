/**
 * Plan limits and feature flags. Flags resolve with a strict precedence:
 * school override > plan > platform default. Configuration is data, so a
 * large tenant can be given more storage without a deploy or code branch.
 */
import { PlanLimitError, ValidationError } from './errors';

export const MODULES = [
  'library',
  'transport',
  'hostel',
  'inventory',
  'homework',
  'online_payments',
] as const;

export type ModuleKey = (typeof MODULES)[number];

export type UsageMetric = 'students' | 'staff' | 'storageMb' | 'smsCredits';

export interface PlanLimits {
  students: number;
  staff: number;
  storageMb: number;
  smsCredits: number;
  modules: Record<ModuleKey, boolean>;
}

export const FREE_MODULES: Record<ModuleKey, boolean> = {
  library: false,
  transport: false,
  hostel: false,
  inventory: false,
  homework: false,
  online_payments: false,
};

export const PLAN_LIMIT_KEYS: readonly UsageMetric[] = [
  'students',
  'staff',
  'storageMb',
  'smsCredits',
];

export function emptyModules(): Record<ModuleKey, boolean> {
  return { ...FREE_MODULES };
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULES as readonly string[]).includes(value);
}

export interface EntitlementContext {
  plan: { code: string; limits: PlanLimits };
  /** Per-school overrides set by the platform (quotas or module toggles). */
  overrides: {
    limits?: Partial<Record<UsageMetric, number>>;
    modules?: Partial<Record<ModuleKey, boolean>>;
  };
  /** Emergency platform kill switch. */
  suspended?: boolean;
}

export function effectiveLimit(context: EntitlementContext, metric: UsageMetric): number {
  const override = context.overrides.limits?.[metric];
  const base = context.plan.limits[metric];
  const value = override ?? base;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`Invalid plan limit for ${metric}`);
  }
  return value;
}

export function moduleEnabled(context: EntitlementContext, module: ModuleKey): boolean {
  if (context.suspended) return false;
  const override = context.overrides.modules?.[module];
  return override ?? context.plan.limits.modules[module] ?? false;
}

export interface LimitCheck {
  allowed: boolean;
  metric: UsageMetric;
  limit: number;
  current: number;
  requested: number;
  remaining: number;
}

export function checkLimit(
  context: EntitlementContext,
  metric: UsageMetric,
  current: number,
  requested = 1,
): LimitCheck {
  if (!Number.isSafeInteger(current) || current < 0) throw new ValidationError('Invalid usage');
  if (!Number.isSafeInteger(requested) || requested < 0) throw new ValidationError('Invalid delta');
  const limit = effectiveLimit(context, metric);
  const remaining = Math.max(0, limit - current);
  return {
    allowed: current + requested <= limit,
    metric,
    limit,
    current,
    requested,
    remaining,
  };
}

export function assertWithinLimit(
  context: EntitlementContext,
  metric: UsageMetric,
  current: number,
  requested = 1,
): void {
  const result = checkLimit(context, metric, current, requested);
  if (!result.allowed) {
    throw new PlanLimitError(metric, result.limit, current, requested);
  }
}

export function assertModuleEnabled(context: EntitlementContext, module: ModuleKey): void {
  if (!moduleEnabled(context, module)) {
    throw new ValidationError(`The ${module} module is not enabled for this school`);
  }
}

export const DEFAULT_PLAN_LIMITS: Record<string, PlanLimits> = {
  trial: {
    students: 300,
    staff: 40,
    storageMb: 1024,
    smsCredits: 500,
    modules: { ...FREE_MODULES, homework: true },
  },
  starter: {
    students: 800,
    staff: 80,
    storageMb: 5_120,
    smsCredits: 2_000,
    modules: { ...FREE_MODULES, homework: true, library: true },
  },
  growth: {
    students: 1500,
    staff: 150,
    storageMb: 10_240,
    smsCredits: 5_000,
    modules: { ...FREE_MODULES, homework: true, library: true, transport: true },
  },
  enterprise: {
    students: 5000,
    staff: 500,
    storageMb: 51_200,
    smsCredits: 25_000,
    modules: {
      library: true,
      transport: true,
      hostel: true,
      inventory: true,
      homework: true,
      online_payments: true,
    },
  },
  // Legacy codes kept so existing tenants and older API clients keep resolving.
  standard: {
    students: 1500,
    staff: 150,
    storageMb: 10_240,
    smsCredits: 5000,
    modules: { ...FREE_MODULES, homework: true, library: true, transport: true },
  },
  premium: {
    students: 5000,
    staff: 500,
    storageMb: 51_200,
    smsCredits: 25_000,
    modules: {
      library: true,
      transport: true,
      hostel: true,
      inventory: true,
      homework: true,
      online_payments: true,
    },
  },
};
