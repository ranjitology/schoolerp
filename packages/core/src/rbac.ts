/**
 * Role-based access control.
 *
 * Permissions are additive to a role's baseline; explicit deny overrides any
 * grant. Ownership scoping (e.g. a parent may only read their own child) is a
 * separate layer in the API — a permission is necessary but not sufficient.
 */
import { ForbiddenError } from './errors';

export const PERMISSIONS = [
  'dashboard:view',
  'students:read',
  'students:write',
  'students:delete',
  'students:import',
  'students:export',
  'admissions:read',
  'admissions:write',
  'staff:read',
  'staff:write',
  'payroll:read',
  'payroll:write',
  'academics:read',
  'academics:write',
  'attendance:read',
  'attendance:write',
  'timetable:read',
  'timetable:write',
  'exams:read',
  'exams:write',
  'results:publish',
  'fees:read',
  'fees:write',
  'fees:collect',
  'fees:refund',
  'fees:reconcile',
  'reports:read',
  'reports:export',
  'communication:read',
  'communication:write',
  'communication:send',
  'settings:read',
  'settings:write',
  'users:read',
  'users:write',
  'audit:read',
  'import:run',
  'portal:read',
  'portal:pay',
  'homework:read',
  'homework:write',
  'library:read',
  'library:write',
  'transport:read',
  'transport:write',
  'hostel:read',
  'hostel:write',
  'inventory:read',
  'inventory:write',
  'documents:read',
  'documents:write',
  'messages:read',
  'messages:write',
  'analytics:read',
  'analytics:export',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

export const ROLES = [
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'ACCOUNTANT',
  'TEACHER',
  'RECEPTIONIST',
  'PARENT',
  'STUDENT',
] as const;

export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  SCHOOL_ADMIN: 'School Admin',
  PRINCIPAL: 'Principal',
  ACCOUNTANT: 'Accountant',
  TEACHER: 'Teacher',
  RECEPTIONIST: 'Receptionist',
  PARENT: 'Parent',
  STUDENT: 'Student',
};

const SCHOOL_ADMIN: readonly Permission[] = [
  ...PERMISSIONS.filter((p) => !p.startsWith('portal:')),
];

const PRINCIPAL: readonly Permission[] = [
  'dashboard:view',
  'students:read',
  'students:write',
  'students:export',
  'admissions:read',
  'admissions:write',
  'staff:read',
  'payroll:read',
  'academics:read',
  'academics:write',
  'attendance:read',
  'attendance:write',
  'timetable:read',
  'timetable:write',
  'exams:read',
  'exams:write',
  'results:publish',
  'fees:read',
  'fees:reconcile',
  'reports:read',
  'reports:export',
  'communication:read',
  'communication:write',
  'communication:send',
  'settings:read',
  'users:read',
  'audit:read',
  'import:run',
  'homework:read',
  'library:read',
  'transport:read',
  'hostel:read',
  'inventory:read',
  'messages:read',
  'messages:write',
  'documents:read',
  'documents:write',
  'analytics:read',
  'analytics:export',
];

const ACCOUNTANT: readonly Permission[] = [
  'dashboard:view',
  'students:read',
  'students:export',
  'fees:read',
  'fees:write',
  'fees:collect',
  'fees:refund',
  'fees:reconcile',
  'reports:read',
  'reports:export',
  'communication:read',
  'settings:read',
  'import:run',
  'payroll:read',
  'payroll:write',
  'messages:read',
  'messages:write',
  'documents:read',
  'analytics:read',
  'analytics:export',
];

const TEACHER: readonly Permission[] = [
  'dashboard:view',
  'students:read',
  'attendance:read',
  'attendance:write',
  'timetable:read',
  'exams:read',
  'exams:write',
  'reports:read',
  'communication:read',
  'communication:write',
  'homework:read',
  'homework:write',
  'library:read',
  'transport:read',
  'messages:read',
  'messages:write',
  'analytics:read',
];

const RECEPTIONIST: readonly Permission[] = [
  'dashboard:view',
  'students:read',
  'students:write',
  'students:import',
  'students:export',
  'admissions:read',
  'admissions:write',
  'attendance:read',
  'timetable:read',
  'exams:read',
  'fees:read',
  'fees:collect',
  'communication:read',
  'communication:write',
  'settings:read',
  'import:run',
  'messages:read',
  'messages:write',
  'documents:read',
  'documents:write',
];

const PARENT: readonly Permission[] = ['dashboard:view', 'portal:read', 'portal:pay'];

const STUDENT: readonly Permission[] = ['dashboard:view', 'portal:read'];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  SCHOOL_ADMIN,
  PRINCIPAL,
  ACCOUNTANT,
  TEACHER,
  RECEPTIONIST,
  PARENT,
  STUDENT,
};

export interface PermissionOverrides {
  grant?: readonly Permission[];
  deny?: readonly Permission[];
}

export interface PrincipalLike {
  roleCode: string;
  permissions?: readonly string[];
  overrides?: PermissionOverrides;
}

/**
 * Computes the effective permission set. Role baseline + grants - denies.
 * Unknown permissions are ignored rather than granting anything implicitly.
 */
export function effectivePermissions(principal: PrincipalLike): Set<Permission> {
  const rolePerms = ROLE_PERMISSIONS[principal.roleCode as RoleCode] ?? [];
  const effective = new Set<Permission>(rolePerms);

  for (const permission of principal.permissions ?? []) {
    if (isPermission(permission)) effective.add(permission);
  }
  for (const permission of principal.overrides?.grant ?? []) {
    if (isPermission(permission)) effective.add(permission);
  }
  for (const permission of principal.overrides?.deny ?? []) {
    effective.delete(permission);
  }
  return effective;
}

export function can(
  principal: PrincipalLike | null | undefined,
  permission: Permission,
): boolean {
  if (!principal) return false;
  return effectivePermissions(principal).has(permission);
}

export function canAny(
  principal: PrincipalLike | null | undefined,
  permissions: readonly Permission[],
): boolean {
  if (!principal) return false;
  const effective = effectivePermissions(principal);
  return permissions.some((p) => effective.has(p));
}

export function canAll(
  principal: PrincipalLike | null | undefined,
  permissions: readonly Permission[],
): boolean {
  if (!principal) return false;
  const effective = effectivePermissions(principal);
  return permissions.every((p) => effective.has(p));
}

export function assertCan(
  principal: PrincipalLike | null | undefined,
  permission: Permission,
): void {
  if (!can(principal, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

/** System roles created for every new school. */
export interface SystemRoleDefinition {
  code: RoleCode;
  name: string;
  permissions: readonly Permission[];
  isSystem: true;
}

export function systemRoleDefinitions(): SystemRoleDefinition[] {
  return ROLES.map((code) => ({
    code,
    name: ROLE_LABELS[code],
    permissions: ROLE_PERMISSIONS[code],
    isSystem: true,
  }));
}
