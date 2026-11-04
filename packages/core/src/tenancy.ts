/**
 * Tenant resolution and isolation primitives.
 *
 * Resolution order is deliberate:
 *  1. The host subdomain establishes the *requested* tenant.
 *  2. The authenticated token carries the tenant the user actually belongs to.
 *  3. If both exist and differ, we reject — never silently fall back.
 *
 * Shared-database RLS is the final enforcement layer (see packages/db).
 */

import { TenantMismatchError, UnauthorizedError } from './errors';

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'console',
  'platform',
  'static',
  'assets',
  'cdn',
  'mail',
  'help',
  'support',
  'status',
  'docs',
  'demo',
  'test',
  'staging',
  'sandbox',
  'schoolerp',
]);

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export interface SlugValidation {
  ok: boolean;
  slug?: string;
  reason?: string;
}

/** Normalises user input into a DNS-safe slug. */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateSlug(input: string): SlugValidation {
  const slug = normalizeSlug(input);
  if (slug.length < 3) return { ok: false, reason: 'slug_too_short' };
  if (slug.length > 32) return { ok: false, reason: 'slug_too_long' };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, reason: 'slug_invalid_characters' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'slug_reserved' };
  if (/^(\d+)$/.test(slug)) return { ok: false, reason: 'slug_numeric_only' };
  return { ok: true, slug };
}

export interface TenantResolutionInput {
  host?: string | null;
  /** Explicit header used by the API and desktop client; disabled in production. */
  headerSlug?: string | null;
  /** Token claim (`sid` / `schoolId`), when an access token is present. */
  tokenSchoolId?: string | null;
  /** Apex domain, e.g. `example.com`. Subdomains of this become tenant slugs. */
  baseDomain?: string;
  /** Hosts that never represent a tenant. */
  excludeHosts?: string[];
  allowHeader?: boolean;
}

export interface TenantResolution {
  slug: string | null;
  schoolId: string | null;
  source: 'host' | 'header' | 'token' | 'none';
}

function stripPort(host: string): string {
  return host.split(':')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Extracts the tenant slug from a host. Supports:
 *  - `school.example.com` (baseDomain=example.com)
 *  - `school.localhost` and `school.127.0.0.1` in development
 *  - the first label of any host when no baseDomain is configured
 */
export function extractSlugFromHost(host: string, baseDomain: string): string | null {
  const clean = stripPort(host);
  if (!clean) return null;

  const apex = stripPort(baseDomain);
  if (apex && clean === apex) return null;
  const label = baseDomain ? (clean.endsWith(`.${apex}`) ? clean.slice(0, -(apex.length + 1)) : clean) : clean;

  // IP addresses do not carry a tenant.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(label)) return null;
  if (label === 'localhost' || label === '' || label === '127.0.0.1') return null;

  const firstLabel = label.split('.')[0] ?? '';
  if (!firstLabel || RESERVED_SLUGS.has(firstLabel)) return null;
  return firstLabel;
}

export function resolveTenant(input: TenantResolutionInput): TenantResolution {
  const baseDomain = input.baseDomain?.trim() ?? '';
  const exclude = (input.excludeHosts ?? []).map((h) => stripPort(h));

  if (input.tokenSchoolId) {
    return { slug: null, schoolId: input.tokenSchoolId, source: 'token' };
  }

  if (input.allowHeader && input.headerSlug) {
    const slug = normalizeSlug(input.headerSlug);
    if (!slug) return { slug: null, schoolId: null, source: 'none' };
    return { slug, schoolId: null, source: 'header' };
  }

  if (!input.host) return { slug: null, schoolId: null, source: 'none' };
  const clean = stripPort(input.host);
  if (exclude.includes(clean)) return { slug: null, schoolId: null, source: 'none' };

  const slug = extractSlugFromHost(clean, baseDomain);
  return slug
    ? { slug, schoolId: null, source: 'host' }
    : { slug: null, schoolId: null, source: 'none' };
}

export type ActorType = 'USER' | 'PLATFORM_USER' | 'SYSTEM' | 'DEVICE';

/**
 * Ensures the tenant established by the request host equals the tenant in the
 * token. This is the API-level defence against confused-deputy attacks; RLS is
 * the database-level defence.
 */
export function assertTenantMatch(
  requestTenantId: string | null,
  tokenTenantId: string | null,
): string {
  if (!requestTenantId) throw new TenantMismatchError('No school was resolved for this request');
  if (!tokenTenantId) throw new UnauthorizedError('Token is missing a school claim');
  if (requestTenantId !== tokenTenantId) throw new TenantMismatchError();
  return requestTenantId;
}

export interface TenantContext {
  schoolId: string;
  slug: string;
  userId: string | null;
  actorType: ActorType;
  roleCode: string | null;
  permissions: ReadonlySet<string>;
  requestId: string;
  /** True only for audited, reason-bearing super-admin impersonation. */
  impersonationId?: string;
  deviceId?: string;
}

export function hasTenant(ctx: TenantContext | null): ctx is TenantContext {
  return Boolean(ctx?.schoolId);
}
