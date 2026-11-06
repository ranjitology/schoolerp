/**
 * Dedicated-tenant database routing contract.
 *
 * The default deployment keeps every tenant in the shared database and relies
 * on PostgreSQL RLS. A tenant that needs a dedicated database can be routed by
 * setting TENANT_DB_URLS to either a JSON object or comma separated pairs:
 *
 *   TENANT_DB_URLS='{"<schoolId>":"postgresql://..."}'
 *   TENANT_DB_URLS='<schoolId>=postgresql://...,<schoolId2>=postgresql://...'
 *
 * Keys are school ids (the same value used for `app.school_id`). Every dedicated
 * database must have the same migrations applied; routing only chooses the
 * connection, RLS still enforces isolation. Unknown tenants fall back to the
 * shared primary, so enabling routing is additive and safe.
 *
 * This module deliberately has no Prisma dependency so the contract can be
 * validated without opening a database connection.
 */

export interface TenantDbRoute {
  schoolId: string;
  url: string;
}

export function parseTenantDbRoutes(raw: string | undefined): Map<string, string> {
  const routes = new Map<string, string>();
  const value = raw?.trim();
  if (!value) return routes;

  if (value.startsWith('{') || value.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('TENANT_DB_URLS must be valid JSON or key=url pairs');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('TENANT_DB_URLS JSON must be an object of schoolId -> url');
    }
    for (const [key, url] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof url === 'string' && key.trim() && url.trim()) {
        routes.set(key.trim(), url.trim());
      }
    }
    return routes;
  }

  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const schoolId = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    if (schoolId && url) routes.set(schoolId, url);
  }
  return routes;
}

export function tenantDbRoutes(raw?: string): Map<string, string> {
  return parseTenantDbRoutes(raw ?? process.env.TENANT_DB_URLS);
}

export function hasDedicatedTenantDatabase(schoolId: string, raw?: string): boolean {
  return tenantDbRoutes(raw).has(schoolId);
}

export function tenantRoutingSummary(raw?: string): {
  mode: 'shared' | 'hybrid';
  dedicatedTenants: number;
} {
  const dedicatedTenants = tenantDbRoutes(raw).size;
  return { mode: dedicatedTenants > 0 ? 'hybrid' : 'shared', dedicatedTenants };
}
