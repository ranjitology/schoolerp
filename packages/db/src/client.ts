/**
 * Prisma client singleton plus the only sanctioned ways to touch tenant data.
 *
 * Every tenant query MUST run inside `withTenant()` (or `withPlatform()` for
 * audited control-plane work). The wrapper sets PostgreSQL session variables
 * inside the same transaction, so connection pooling can never leak one
 * school's context into another request.
 */
import { Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient;
export type TxClient = Prisma.TransactionClient;

export interface TenantScope {
  schoolId: string;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
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
  return prisma.$transaction(
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
