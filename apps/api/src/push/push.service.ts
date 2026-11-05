import { Injectable } from '@nestjs/common';
import { NotFoundError, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(500),
  p256dh: z.string().trim().min(10).max(200),
  auth: z.string().trim().min(4).max(200),
});

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class PushService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const items = await tx.pushSubscription.findMany({
        where: { schoolId: auth.schoolId, userId: auth.userId },
        select: {
          id: true,
          endpoint: true,
          userAgent: true,
          lastSeenAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return { items };
    });
  }

  async subscribe(
    auth: AuthPrincipal,
    input: z.infer<typeof pushSubscriptionSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const userAgent = meta.userAgent?.slice(0, 500) ?? null;
      const subscription = await tx.pushSubscription.upsert({
        where: { userId_endpoint: { userId: auth.userId, endpoint: input.endpoint } },
        create: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          userId: auth.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent,
        },
        update: {
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent,
          lastSeenAt: new Date(),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'push.subscribed',
        entity: 'PushSubscription',
        entityId: subscription.id,
        after: { endpoint: redactEndpoint(subscription.endpoint) },
      });
      return {
        id: subscription.id,
        endpoint: subscription.endpoint,
        createdAt: subscription.createdAt,
      };
    });
  }

  async unsubscribe(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const subscription = await tx.pushSubscription.findFirst({
        where: { id, schoolId: auth.schoolId, userId: auth.userId },
        select: { id: true, endpoint: true },
      });
      if (!subscription) throw new NotFoundError('Push subscription');
      await tx.pushSubscription.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'push.unsubscribed',
        entity: 'PushSubscription',
        entityId: id,
        before: { endpoint: redactEndpoint(subscription.endpoint) },
      });
      return { removed: true };
    });
  }

  /**
   * Sends through a deployment-owned push gateway. The gateway owns VAPID
   * signing and encryption; this service only resolves the user's endpoints.
   */
  async sendWithTx(
    tx: TxClient,
    schoolId: string,
    userId: string,
    payload: PushPayload,
  ): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string; providerMessageId?: string }> {
    const subscriptions = await tx.pushSubscription.findMany({
      where: { schoolId, userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subscriptions.length === 0) {
      return { status: 'SKIPPED', error: 'No push subscription is registered' };
    }

    const url = process.env.PUSH_WEBHOOK_URL?.trim();
    if (!url) {
      if (process.env.NODE_ENV === 'production') {
        return { status: 'FAILED', error: 'PUSH_WEBHOOK_URL is not configured' };
      }
      return { status: 'SENT', providerMessageId: `console-push-${subscriptions[0]!.id}` };
    }

    let sent = 0;
    let lastError: string | undefined;
    for (const subscription of subscriptions) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            notification: payload,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) sent += 1;
        else lastError = `Push gateway responded ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Push gateway request failed';
      }
    }

    if (sent > 0) return { status: 'SENT', providerMessageId: `push-batch-${subscriptions.length}` };
    return { status: 'FAILED', error: (lastError ?? 'Push delivery failed').slice(0, 500) };
  }

  async requireOwned(auth: AuthPrincipal, id: string) {
    const row = await withTenant({ schoolId: auth.schoolId }, (tx) =>
      tx.pushSubscription.findFirst({
        where: { id, schoolId: auth.schoolId, userId: auth.userId },
        select: { id: true },
      }),
    );
    if (!row) throw new NotFoundError('Push subscription');
    return row;
  }
}

function redactEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return endpoint.slice(0, 40);
  }
}

function auditCtx(auth: AuthPrincipal, meta: AuditMeta) {
  return {
    schoolId: auth.schoolId,
    userId: auth.userId,
    actorType: auth.actorType,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    impersonationId: auth.impersonationId,
  };
}
