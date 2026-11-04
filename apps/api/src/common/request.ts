import type { Request } from 'express';
import type { ActorType, Permission } from '@schoolerp/core';

export interface RequestSchool {
  id: string;
  slug: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  currency: string;
  timezone: string;
  locale: string;
  deletedAt: Date | null;
}

export interface AuthPrincipal {
  userId: string;
  schoolId: string;
  roleCode: string;
  permissions: ReadonlySet<Permission>;
  email: string;
  fullName: string;
  actorType: ActorType;
  impersonationId?: string;
  platformUserId?: string;
}

export interface PlatformPrincipal {
  platformUserId: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';
}

export interface AppRequest extends Request {
  requestId: string;
  school?: RequestSchool;
  auth?: AuthPrincipal;
  platform?: PlatformPrincipal;
}

export function toRequestSchool(school: {
  id: string;
  slug: string;
  name: string;
  status: string;
  currency: string;
  timezone: string;
  locale: string;
  deletedAt: Date | null;
}): RequestSchool {
  return {
    id: school.id,
    slug: school.slug,
    name: school.name,
    status: school.status as RequestSchool['status'],
    currency: school.currency,
    timezone: school.timezone,
    locale: school.locale,
    deletedAt: school.deletedAt,
  };
}
