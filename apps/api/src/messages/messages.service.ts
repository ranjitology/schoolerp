import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

export const createThreadSchema = z.object({
  subject: z.string().trim().min(2).max(160),
  participantIds: z.array(z.string().uuid()).min(1).max(50),
  message: z.string().trim().min(1).max(5000),
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const threadQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@Injectable()
export class MessagesService {
  constructor(private readonly audit: AuditService) {}

  async listThreads(auth: AuthPrincipal, query: z.infer<typeof threadQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.MessageThreadWhereInput = {
        schoolId: auth.schoolId,
        OR: [
          { createdByUserId: auth.userId },
          { participantIds: { array_contains: auth.userId } },
        ],
      };
      const [threads, total] = await Promise.all([
        tx.messageThread.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.messageThread.count({ where }),
      ]);
      const ids = threads.map((thread) => thread.id);
      const [messages, counts] = await Promise.all([
        tx.message.findMany({
          where: { schoolId: auth.schoolId, threadId: { in: ids } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.message.groupBy({
          by: ['threadId'],
          where: { schoolId: auth.schoolId, threadId: { in: ids } },
          _count: { _all: true },
        }),
      ]);
      const countMap = new Map(counts.map((row) => [row.threadId, row._count._all]));
      const lastMap = new Map<string, (typeof messages)[number]>();
      for (const message of messages) {
        if (!lastMap.has(message.threadId) || lastMap.get(message.threadId)!.createdAt < message.createdAt) {
          lastMap.set(message.threadId, message);
        }
      }
      const userIds = [
        ...new Set(
          threads.flatMap((thread) => [...asIds(thread.participantIds), thread.createdByUserId]),
        ),
      ];
      const userMap = await loadUserMap(tx, auth.schoolId, userIds);
      return {
        items: threads.map((thread) => ({
          id: thread.id,
          subject: thread.subject,
          participantIds: asIds(thread.participantIds),
          createdByUserId: thread.createdByUserId,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messageCount: countMap.get(thread.id) ?? 0,
          lastMessage: lastMap.get(thread.id) ?? null,
          participants: asIds(thread.participantIds).map((id) => userMap.get(id) ?? fallbackUser(id)),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async createThread(
    auth: AuthPrincipal,
    input: z.infer<typeof createThreadSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const participantIds = [...new Set([auth.userId, ...input.participantIds])];
      const users = await tx.user.count({
        where: { schoolId: auth.schoolId, id: { in: participantIds } },
      });
      if (users !== participantIds.length) throw new NotFoundError('Participant');
      const threadId = uuidv7();
      const thread = await tx.messageThread.create({
        data: {
          id: threadId,
          schoolId: auth.schoolId,
          subject: input.subject,
          createdByUserId: auth.userId,
          participantIds: participantIds as never,
        },
      });
      await tx.message.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          threadId,
          senderId: auth.userId,
          body: input.message,
          readBy: [auth.userId] as never,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'message.thread_created',
        entity: 'MessageThread',
        entityId: thread.id,
        after: { subject: thread.subject, participants: participantIds.length },
      });
      const messages = await tx.message.findMany({
        where: { schoolId: auth.schoolId, threadId },
        orderBy: { createdAt: 'asc' },
      });
      const userMap = await loadUserMap(tx, auth.schoolId, participantIds);
      return {
        ...thread,
        participantIds,
        participants: participantIds.map((id) => userMap.get(id) ?? fallbackUser(id)),
        messages: messages.map((message) => ({
          ...message,
          senderName: userMap.get(message.senderId)?.fullName ?? 'Unknown user',
        })),
      };
    });
  }

  async getThread(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const thread = await tx.messageThread.findFirst({
        where: {
          id,
          schoolId: auth.schoolId,
          OR: [
            { createdByUserId: auth.userId },
            { participantIds: { array_contains: auth.userId } },
          ],
        },
      });
      if (!thread) throw new NotFoundError('Message thread');
      const messages = await tx.message.findMany({
        where: { schoolId: auth.schoolId, threadId: thread.id },
        orderBy: { createdAt: 'asc' },
      });
      const participantIds = asIds(thread.participantIds);
      const userMap = await loadUserMap(tx, auth.schoolId, [
        ...participantIds,
        thread.createdByUserId,
        ...messages.map((message) => message.senderId),
      ]);
      return {
        ...thread,
        participantIds,
        participants: participantIds.map((participantId) => userMap.get(participantId) ?? fallbackUser(participantId)),
        messages: messages.map((message) => ({
          ...message,
          senderName: userMap.get(message.senderId)?.fullName ?? 'Unknown user',
        })),
      };
    });
  }

  /** Directory of users that can be added to a message thread. */
  async participants(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const users = await tx.user.findMany({
        where: { schoolId: auth.schoolId, deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: { select: { code: true, name: true } },
        },
        orderBy: { fullName: 'asc' },
        take: 500,
      });
      return {
        items: users.map((user) => ({
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          roleCode: user.role.code,
          roleName: user.role.name,
        })),
      };
    });
  }

  async sendMessage(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof sendMessageSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const thread = await tx.messageThread.findFirst({
        where: {
          id,
          schoolId: auth.schoolId,
          OR: [
            { createdByUserId: auth.userId },
            { participantIds: { array_contains: auth.userId } },
          ],
        },
      });
      if (!thread) throw new NotFoundError('Message thread');
      const message = await tx.message.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          threadId: thread.id,
          senderId: auth.userId,
          body: input.body,
          readBy: [auth.userId] as never,
        },
      });
      await tx.messageThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'message.sent',
        entity: 'Message',
        entityId: message.id,
        after: { threadId: thread.id },
      });
      return message;
    });
  }

  async markRead(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const message = await tx.message.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!message) throw new NotFoundError('Message');
      const readBy = Array.isArray(message.readBy) ? (message.readBy as string[]) : [];
      if (!readBy.includes(auth.userId)) {
        await tx.message.update({
          where: { id },
          data: { readBy: [...readBy, auth.userId] as never },
        });
      }
      return { read: true };
    });
  }

  async unreadCount(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const threads = await tx.messageThread.findMany({
        where: {
          schoolId: auth.schoolId,
          OR: [
            { createdByUserId: auth.userId },
            { participantIds: { array_contains: auth.userId } },
          ],
        },
        select: { id: true },
      });
      const messages = await tx.message.findMany({
        where: { schoolId: auth.schoolId, threadId: { in: threads.map((thread) => thread.id) } },
        select: { readBy: true },
      });
      const unread = messages.filter((message) => {
        const readBy = Array.isArray(message.readBy) ? (message.readBy as string[]) : [];
        return !readBy.includes(auth.userId);
      }).length;
      return { unread };
    });
  }
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function fallbackUser(id: string) {
  return { id, fullName: 'Unknown user', email: null as string | null, roleCode: null as string | null };
}

async function loadUserMap(
  tx: TxClient,
  schoolId: string,
  ids: (string | null | undefined)[],
) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) {
    return new Map<string, { id: string; fullName: string; email: string | null; roleCode: string | null }>();
  }
  const users = await tx.user.findMany({
    where: { schoolId, id: { in: unique } },
    select: { id: true, fullName: true, email: true, role: { select: { code: true } } },
  });
  return new Map(
    users.map((user) => [
      user.id,
      { id: user.id, fullName: user.fullName, email: user.email, roleCode: user.role.code },
    ]),
  );
}

export function auditCtx(auth: AuthPrincipal, meta: AuditMeta) {
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
