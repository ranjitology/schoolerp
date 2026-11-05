import { Injectable } from '@nestjs/common';
import type { TxClient } from '@schoolerp/db';
import { withPlatform, withTenant } from '@schoolerp/db';
import { uuidv7, type ActorType } from '@schoolerp/core';
import { hashEntry } from '@schoolerp/core/server';

// Re-exported for callers/tests that import the helpers from this module.
export { hashEntry, stableStringify } from '@schoolerp/core/server';

export interface AuditContext {
  schoolId: string;
  userId: string | null;
  actorType: ActorType;
  requestId: string;
  impersonationId?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface PlatformAuditInput {
  platformUserId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  schoolId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

const MAX_HASHES = 500;

/**
 * Tenant audit trail with a per-school SHA-256 hash chain. The advisory lock
 * serialises appends for a school so concurrent requests cannot fork the chain.
 */
@Injectable()
export class AuditService {
  async record(tx: TxClient, context: AuditContext, input: AuditInput): Promise<string> {
    // `pg_advisory_xact_lock` returns void, which Prisma cannot deserialize
    // through `$queryRaw`; `$executeRaw` only needs the affected row count.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.schoolId}))`;

    const previous = await tx.auditLog.findFirst({
      where: { schoolId: context.schoolId },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const prevHash = previous?.hash ?? '0'.repeat(64);
    const createdAt = new Date();
    const hash = hashEntry(prevHash, {
      schoolId: context.schoolId,
      actorUserId: context.userId,
      actorType: context.actorType,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      requestId: context.requestId,
      createdAt: createdAt.toISOString(),
    });

    await tx.auditLog.create({
      data: {
        id: uuidv7(),
        schoolId: context.schoolId,
        actorUserId: context.userId,
        actorType: context.actorType,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: (input.before ?? null) as never,
        after: (input.after ?? null) as never,
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        requestId: context.requestId,
        impersonationId: context.impersonationId ?? null,
        prevHash,
        hash,
        createdAt,
      },
    });
    return hash;
  }

  async recordPlatform(input: PlatformAuditInput): Promise<void> {
    // platform_audit_logs is protected by FORCE RLS, so the control-plane GUC
    // must be set inside the same transaction as the insert.
    await withPlatform((tx) =>
      tx.platformAuditLog.create({
        data: {
          id: uuidv7(),
          platformUserId: input.platformUserId,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          schoolId: input.schoolId ?? null,
          before: (input.before ?? null) as never,
          after: (input.after ?? null) as never,
          requestId: input.requestId ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        },
      }),
    );
  }

  /** Verifies the chain for the most recent `limit` entries (oldest → newest). */
  async verifyChain(schoolId: string, limit = MAX_HASHES): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
    // The audit table is under FORCE RLS, so this must run inside a tenant
    // transaction; a plain `prisma` query would silently see zero rows.
    const rows = await withTenant({ schoolId }, (tx) =>
      tx.auditLog.findMany({
        where: { schoolId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          schoolId: true,
          actorUserId: true,
          actorType: true,
          action: true,
          entity: true,
          entityId: true,
          before: true,
          after: true,
          requestId: true,
          createdAt: true,
          prevHash: true,
          hash: true,
        },
      }),
    );
    const entries = rows.reverse();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const expectedPrev = index === 0 ? entry.prevHash : entries[index - 1]!.hash;
      if (entry.prevHash !== expectedPrev) {
        return { valid: false, checked: index + 1, brokenAt: entry.id };
      }
      const expected = hashEntry(entry.prevHash, {
        schoolId: entry.schoolId,
        actorUserId: entry.actorUserId,
        actorType: entry.actorType,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        requestId: entry.requestId,
        createdAt: entry.createdAt.toISOString(),
      });
      if (expected !== entry.hash) {
        return { valid: false, checked: index + 1, brokenAt: entry.id };
      }
    }
    return { valid: true, checked: entries.length };
  }
}
