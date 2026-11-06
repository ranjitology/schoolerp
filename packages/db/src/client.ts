/**
 * Prisma client singleton plus the only sanctioned ways to touch tenant data.
 *
 * Every tenant query MUST run inside `withTenant()` (or `withPlatform()` for
 * audited control-plane work). The wrapper sets PostgreSQL session variables
 * inside the same transaction, so connection pooling can never leak one
 * school's context into another request.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantDbRoutes } from './routing';

export * from './routing';

export type DbClient = PrismaClient;
export type TxClient = Prisma.TransactionClient;

export interface TenantScope {
  schoolId: string;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  readPrisma?: PrismaClient;
  tenantPrisma?: Map<string, PrismaClient>;
};

/** Dedicated-database routing helpers live in ./routing to keep them testable. */

const tenantPrismaClients: Map<string, PrismaClient> =
  globalForPrisma.tenantPrisma ?? new Map<string, PrismaClient>();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.tenantPrisma = tenantPrismaClients;
}

/** Returns the dedicated client for a routed tenant, else the shared primary. */
export function tenantPrismaClient(schoolId?: string): PrismaClient {
  if (!schoolId) return prisma;
  const url = tenantDbRoutes().get(schoolId);
  if (!url) return prisma;
  const existing = tenantPrismaClients.get(schoolId);
  if (existing) return existing;
  const client = createPrismaClient(url);
  tenantPrismaClients.set(schoolId, client);
  return client;
}

function readClientForTenant(schoolId: string): PrismaClient {
  // A dedicated database is authoritative for reads as well; do not mix a
  // shared-database replica with a dedicated primary.
  if (tenantDbRoutes().has(schoolId)) return tenantPrismaClient(schoolId);
  return readPrisma;
}

/** Disconnects cached dedicated clients (shutdown/tests). */
export async function disconnectTenantPrismaClients(): Promise<void> {
  const clients = [...tenantPrismaClients.values()];
  tenantPrismaClients.clear();
  await Promise.all(clients.map((client) => client.$disconnect()));
}

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

/**
 * Optional read replica. Read-only report queries opt in through
 * `withTenantRead()`; when READ_REPLICA_URL is unset this is the primary so
 * behaviour is identical in local, CI and single-database deployments.
 */
export const readPrisma: PrismaClient =
  process.env.READ_REPLICA_URL && process.env.READ_REPLICA_URL.trim().length > 0
    ? (globalForPrisma.readPrisma ?? createPrismaClient(process.env.READ_REPLICA_URL))
    : prisma;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  if (readPrisma !== prisma) globalForPrisma.readPrisma = readPrisma;
}

/**
 * Applies tenant context to an existing transaction. Useful when a service
 * already owns a transaction (e.g. attendance bulk write + audit + outbox).
 */
export async function applyTenantScope(tx: TxClient, scope: TenantScope): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.school_id', ${scope.schoolId}, true)`;
  await tx.$queryRaw`SELECT set_config('app.is_platform', 'false', true)`;
}

export async function applyPlatformScope(tx: TxClient): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.school_id', '', true)`;
  await tx.$queryRaw`SELECT set_config('app.is_platform', 'true', true)`;
}

export interface TenantTransactionOptions {
  timeoutMs?: number;
  maxWaitMs?: number;
}

/** Runs `fn` inside a transaction scoped to exactly one school. */
export async function withTenant<T>(
  scope: TenantScope,
  fn: (tx: TxClient) => Promise<T>,
  options: TenantTransactionOptions = {},
): Promise<T> {
  return tenantPrismaClient(scope.schoolId).$transaction(
    async (tx) => {
      await applyTenantScope(tx, scope);
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? 15_000, maxWait: options.maxWaitMs ?? 5_000 },
  );
}

/**
 * Read-only tenant transaction. Uses READ_REPLICA_URL when configured and the
 * primary otherwise. Callers must not write; RLS still applies because the
 * tenant variables are set inside the transaction.
 */
export async function withTenantRead<T>(
  scope: TenantScope,
  fn: (tx: TxClient) => Promise<T>,
  options: TenantTransactionOptions = {},
): Promise<T> {
  return readClientForTenant(scope.schoolId).$transaction(
    async (tx) => {
      await applyTenantScope(tx, scope);
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? 15_000, maxWait: options.maxWaitMs ?? 5_000 },
  );
}

/**
 * Cross-tenant / control-plane access. Every caller must already have passed a
 * platform-admin authorisation check and must write a PlatformAuditLog entry.
 */
export async function withPlatform<T>(
  fn: (tx: TxClient) => Promise<T>,
  options: TenantTransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await applyPlatformScope(tx);
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? 30_000, maxWait: options.maxWaitMs ?? 5_000 },
  );
}

export { Prisma };
export type { PrismaClient };
