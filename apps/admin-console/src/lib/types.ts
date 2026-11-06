export interface PlatformUser {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';
}

export interface PlatformLoginResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  user: PlatformUser;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PlanSummary {
  code: string;
  name: string;
  priceMinor: number;
  currency: string;
  interval: string;
}

export interface PlatformStats {
  schools: Record<string, number>;
  totalSchools: number;
  plans: PlanSummary[];
  students: number;
  staff: number;
  recentAudit: PlatformAuditRow[];
}

export interface SchoolRow {
  id: string;
  slug: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  currency: string;
  timezone: string;
  trialEndsAt: string | null;
  createdAt: string;
  plan: { code: string; name: string } | null;
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  _count: { students: number };
}

export interface SchoolDetail {
  id: string;
  slug: string;
  name: string;
  status: SchoolRow['status'];
  currency: string;
  timezone: string;
  locale: string;
  calendarSystem: string;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  limitsOverride: Record<string, number> | null;
  modulesOverride: Record<string, boolean> | null;
  branding: Record<string, unknown> | null;
  plan: (PlanSummary & { id: string; limits: unknown }) | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  settings: { id: string; key: string; value: unknown }[];
  _count: { students: number; staff: number };
}

export interface PlatformAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: 'ALL' | 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'SELECTED';
  schoolIds: string[];
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  publishAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface PlatformAuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  schoolId: string | null;
  platformUserId: string | null;
  ip: string | null;
  createdAt: string;
  platformUser?: { email: string; fullName: string } | null;
}

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  interval: string;
  limits: unknown;
}

export interface BillingSubscription {
  id: string;
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  schoolStatus: string;
  planCode: string;
  planName: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingInvoice {
  id: string;
  number: string;
  schoolId: string;
  schoolName: string;
  amountMinor: number;
  currency: string;
  status: string;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
}

export interface BillingOverview {
  plans: BillingPlan[];
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  summary: {
    subscriptions: number;
    active: number;
    trialing: number;
    pastDue: number;
    cancelled: number;
    mrrMinor: number;
    outstandingMinor: number;
  };
}

export interface UsageSlo {
  targetPercent: number;
  windowDays: number;
  status: 'OK' | 'AT_RISK' | 'BREACH' | 'NO_DATA';
  successRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  jobs: {
    total: number;
    completed: number;
    failed: number;
    queued: number;
    running: number;
  };
}

export interface UsageCost {
  currency: string;
  monthlyMinor: number;
  annualMinor: number;
  perStudentMinor: number;
  basis: string;
}

export interface UsageSchool {
  id: string;
  name: string;
  slug: string;
  status: string;
  dataPlane: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
  students: number;
  staff: number;
  meters: Record<string, number>;
  slo: UsageSlo;
  cost: UsageCost;
}

export interface UsageOverview {
  period: string;
  slo: {
    targetPercent: number;
    windowDays: number;
    overallSuccessRate: number | null;
    ok: number;
    atRisk: number;
    breach: number;
    noData: number;
    jobs: { completed: number; failed: number };
  };
  cost: {
    currency: string;
    mrrMinor: number;
    arrMinor: number;
    perStudentMinor: number;
  };
  totals: {
    schools: number;
    students: number;
    staff: number;
    meters: Record<string, number>;
  };
  bySchool: UsageSchool[];
}

