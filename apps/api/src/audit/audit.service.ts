import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TxClient } from '@schoolerp/db';
import { prisma } from '@schoolerp/db';
import { uuidv7, type ActorType } from '@schoolerp/core';

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
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${context.schoolId}))`;

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
    await prisma.platformAuditLog.create({
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
    });
  }

  /** Verifies the chain for the most recent `limit` entries (oldest → newest). */
  async verifyChain(schoolId: string, limit = MAX_HASHES): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
    const rows = await prisma.auditLog.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
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
    });
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

export function hashEntry(prevHash: string, payload: Record<string, unknown>): string {
  return createHash('sha256').update(`${prevHash}\n${stableStringify(payload)}`).digest('hex');
}

/** Deterministic JSON so verification does not depend on key insertion order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
