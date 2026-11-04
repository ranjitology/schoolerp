import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NotFoundError,
  ROLES,
  planNotificationDeliveries,
  resolveNotificationPreferences,
  uuidv7,
  type NotificationChannel,
  type NotificationPreferences,
} from '@schoolerp/core';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';
import { notificationProvider } from './delivery.provider';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const noticeAudienceSchema = z.object({
  roles: z.array(z.enum(ROLES)).max(ROLES.length).optional(),
  classIds: z.array(z.string().uuid()).max(100).optional(),
  sectionIds: z.array(z.string().uuid()).max(300).optional(),
});
export type NoticeAudience = z.infer<typeof noticeAudienceSchema>;

export const createNoticeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(20_000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED']).default('DRAFT'),
  audience: noticeAudienceSchema.default({}),
  publishAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  attachments: z
    .array(
      z.object({
        storageKey: z.string().trim().min(1).max(500),
        fileName: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().min(3).max(120),
        sizeBytes: z.number().int().min(1).max(50_000_000),
      }),
    )
    .max(10)
    .default([]),
});
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;

export const updateNoticeSchema = createNoticeSchema.partial();

export const noticeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const sendNoticeSchema = z.object({
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1).max(NOTIFICATION_CHANNELS.length).default([
    'IN_APP',
  ]),
  category: z.enum(NOTIFICATION_CATEGORIES).default('NOTICE'),
  resend: z.boolean().default(false),
});
export type SendNoticeInput = z.infer<typeof sendNoticeSchema>;

export const deliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
});

export const notificationPreferencesSchema = z.object({
  channels: z.record(z.enum(NOTIFICATION_CHANNELS), z.boolean()).default({}),
  categories: z.record(z.enum(NOTIFICATION_CATEGORIES), z.boolean()).default({}),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

const PREFERENCES_RESOURCE = 'notification-preferences';
const PREFERENCES_NAME = 'default';

@Injectable()
export class NoticesService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal, query: z.infer<typeof noticeListQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.NoticeWhereInput = {
        schoolId: auth.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { body: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.notice.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            attachments: true,
            createdBy: { select: { fullName: true } },
            _count: { select: { deliveries: true } },
          },
        }),
        tx.notice.count({ where }),
      ]);
      return {
        items: items.map(noticeDto),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async create(auth: AuthPrincipal, input: CreateNoticeInput, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const now = new Date();
      const notice = await tx.notice.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          title: input.title,
          body: input.body,
          priority: input.priority,
          status: input.status,
          audience: input.audience as never,
          publishAt: input.publishAt ? new Date(input.publishAt) : input.status === 'PUBLISHED' ? now : null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          publishedAt: input.status === 'PUBLISHED' ? now : null,
          createdByUserId: auth.userId,
          attachments: {
            create: input.attachments.map((attachment) => ({
              id: uuidv7(),
              schoolId: auth.schoolId,
              storageKey: attachment.storageKey,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            })),
          },
        },
        include: { attachments: true, createdBy: { select: { fullName: true } } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notice.created',
        entity: 'Notice',
        entityId: notice.id,
        after: { title: notice.title, status: notice.status, priority: notice.priority },
      });
      return noticeDto(notice);
    });
  }

  async update(auth: AuthPrincipal, id: string, input: z.infer<typeof updateNoticeSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.notice.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Notice');
      const notice = await tx.notice.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.audience !== undefined ? { audience: input.audience as never } : {}),
          ...(input.publishAt !== undefined ? { publishAt: new Date(input.publishAt) } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: new Date(input.expiresAt) } : {}),
        },
        include: { attachments: true, createdBy: { select: { fullName: true } } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notice.updated',
        entity: 'Notice',
        entityId: id,
        before: { title: current.title, status: current.status },
        after: { title: notice.title, status: notice.status },
      });
      return noticeDto(notice);
    });
  }

  async publish(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const notice = await tx.notice.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!notice) throw new NotFoundError('Notice');
      if (notice.status === 'PUBLISHED') return noticeDto(notice);
      const now = new Date();
      const updated = await tx.notice.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: now, publishAt: notice.publishAt ?? now },
        include: { attachments: true, createdBy: { select: { fullName: true } } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notice.published',
        entity: 'Notice',
        entityId: id,
        after: { title: notice.title },
      });
      return noticeDto(updated);
    });
  }

  async archive(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const notice = await tx.notice.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!notice) throw new NotFoundError('Notice');
      const updated = await tx.notice.update({
        where: { id },
        data: { status: 'ARCHIVED' },
        include: { attachments: true, createdBy: { select: { fullName: true } } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notice.archived',
        entity: 'Notice',
        entityId: id,
        after: { title: notice.title },
      });
      return noticeDto(updated);
    });
  }

  /**
   * Resolves the notice audience, records one delivery row per channel and
   * dispatches through the configured transport. In-app deliveries also create
   * a row in the recipient's notification feed.
   */
  async send(
    auth: AuthPrincipal,
    id: string,
    input: SendNoticeInput,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const notice = await tx.notice.findFirst({
        where: { id, schoolId: auth.schoolId },
        include: { attachments: true, createdBy: { select: { fullName: true } } },
      });
      if (!notice) throw new NotFoundError('Notice');

      const existing = await tx.notificationDelivery.count({
        where: { schoolId: auth.schoolId, noticeId: id },
      });
      if (existing > 0 && !input.resend) {
        const summary = await deliverySummary(tx, auth.schoolId, id);
        return {
          noticeId: id,
          alreadySent: true,
          recipients: summary.total,
          ...summary,
          channels: input.channels,
          notice: noticeDto(notice),
        };
      }

      const audience = (notice.audience ?? {}) as NoticeAudience;
      const scopedByClass = Boolean(audience.classIds?.length || audience.sectionIds?.length);
      const users = await tx.user.findMany({
        where: {
          schoolId: auth.schoolId,
          status: 'ACTIVE',
          deletedAt: null,
          ...(audience.roles?.length ? { role: { code: { in: audience.roles } } } : {}),
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          role: { select: { code: true } },
        },
      });

      let scopedUserIds: Set<string> | null = null;
      if (scopedByClass) {
        const classFilter = audience.classIds?.length
          ? { classId: { in: audience.classIds } }
          : {};
        const sectionFilter = audience.sectionIds?.length
          ? { sectionId: { in: audience.sectionIds } }
          : {};
        const [students, guardians] = await Promise.all([
          tx.student.findMany({
            where: {
              schoolId: auth.schoolId,
              deletedAt: null,
              userId: { not: null },
              ...classFilter,
              ...sectionFilter,
            },
            select: { userId: true },
          }),
          tx.guardian.findMany({
            where: {
              schoolId: auth.schoolId,
              userId: { not: null },
              student: {
                schoolId: auth.schoolId,
                deletedAt: null,
                ...classFilter,
                ...sectionFilter,
              },
            },
            select: { userId: true },
          }),
        ]);
        scopedUserIds = new Set(
          [...students, ...guardians]
            .map((row) => row.userId)
            .filter((value): value is string => Boolean(value)),
        );
      }

      const recipients = users.filter((user) => {
        if (!scopedUserIds) return true;
        const learner = user.role.code === 'PARENT' || user.role.code === 'STUDENT';
        if (learner) return scopedUserIds.has(user.id);
        // A class/section audience without explicit roles means learners only.
        return Boolean(audience.roles?.length);
      });

      if (recipients.length === 0) {
        throw new NotFoundError('Notice recipients');
      }

      const preferences = await preferencesForUsers(
        tx,
        auth.schoolId,
        recipients.map((user) => user.id),
      );
      const provider = notificationProvider();
      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const recipient of recipients) {
        const plan = planNotificationDeliveries({
          channels: input.channels,
          category: input.category,
          recipient: {
            userId: recipient.id,
            name: recipient.fullName,
            email: recipient.email,
            phone: recipient.phone,
          },
          preferences: preferences.get(recipient.id),
        });

        for (const entry of plan) {
          const deliveryId = uuidv7();
          let status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
          let error: string | null = entry.deliverable ? null : skipReason(entry.reason);
          let providerMessageId: string | null = null;
          let sentAt: Date | null = null;

          if (entry.deliverable) {
            if (entry.channel === 'IN_APP') {
              await tx.notification.create({
                data: {
                  id: uuidv7(),
                  schoolId: auth.schoolId,
                  userId: recipient.id,
                  type: 'NOTICE',
                  title: notice.title,
                  body: notice.body.slice(0, 2000),
                  data: { noticeId: notice.id, priority: notice.priority } as never,
                },
              });
              status = 'SENT';
              providerMessageId = `in-app-${deliveryId}`;
              sentAt = new Date();
            } else {
              const result = await provider.send({
                deliveryId,
                channel: entry.channel,
                recipient: entry.recipient,
                title: notice.title,
                body: notice.body.slice(0, 2000),
              });
              status = result.status;
              providerMessageId = result.providerMessageId ?? null;
              error = result.error ?? null;
              sentAt = result.status === 'SENT' ? new Date() : null;
            }
          }

          await tx.notificationDelivery.create({
            data: {
              id: deliveryId,
              schoolId: auth.schoolId,
              noticeId: notice.id,
              channel: entry.channel,
              recipient: entry.recipient,
              status,
              providerMessageId,
              error,
              sentAt,
            },
          });
          if (status === 'SENT') sent += 1;
          else if (status === 'FAILED') failed += 1;
          else skipped += 1;
        }
      }

      if (notice.status !== 'PUBLISHED') {
        await tx.notice.update({
          where: { id },
          data: {
            status: 'PUBLISHED',
            publishedAt: notice.publishedAt ?? new Date(),
            publishAt: notice.publishAt ?? new Date(),
          },
        });
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notice.sent',
        entity: 'Notice',
        entityId: id,
        after: {
          title: notice.title,
          recipients: recipients.length,
          channels: input.channels,
          sent,
          failed,
          skipped,
        },
      });

      const updated = await tx.notice.findUnique({
        where: { id },
        include: { attachments: true, createdBy: { select: { fullName: true } } },
      });

      return {
        noticeId: id,
        alreadySent: false,
        recipients: recipients.length,
        sent,
        failed,
        skipped,
        channels: input.channels,
        notice: updated ? noticeDto(updated) : null,
      };
    });
  }

  async deliveries(auth: AuthPrincipal, id: string, query: z.infer<typeof deliveryQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const notice = await tx.notice.findFirst({
        where: { id, schoolId: auth.schoolId },
        select: { id: true },
      });
      if (!notice) throw new NotFoundError('Notice');
      const where: Prisma.NotificationDeliveryWhereInput = {
        schoolId: auth.schoolId,
        noticeId: id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.channel ? { channel: query.channel } : {}),
      };
      const [items, total, summary] = await Promise.all([
        tx.notificationDelivery.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.notificationDelivery.count({ where }),
        deliverySummary(tx, auth.schoolId, id),
      ]);
      return {
        items: items.map(deliveryDto),
        summary,
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async retryDelivery(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const delivery = await tx.notificationDelivery.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!delivery) throw new NotFoundError('Delivery');
      if (delivery.status === 'SENT') return deliveryDto(delivery);

      const notice = delivery.noticeId
        ? await tx.notice.findFirst({
            where: { id: delivery.noticeId, schoolId: auth.schoolId },
            select: { title: true, body: true },
          })
        : null;
      const title = notice?.title ?? 'School notification';
      const body = (notice?.body ?? '').slice(0, 2000);

      let status: 'SENT' | 'FAILED' | 'SKIPPED' = 'FAILED';
      let error: string | null = null;
      let providerMessageId: string | null = null;

      if (delivery.channel === 'IN_APP') {
        if (!delivery.recipient) {
          status = 'SKIPPED';
          error = 'No user is attached to this delivery';
        } else {
          await tx.notification.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              userId: delivery.recipient,
              type: 'NOTICE',
              title,
              body,
              data: { noticeId: delivery.noticeId } as never,
            },
          });
          status = 'SENT';
          providerMessageId = `in-app-${delivery.id}`;
        }
      } else {
        const result = await notificationProvider().send({
          deliveryId: delivery.id,
          channel: delivery.channel as NotificationChannel,
          recipient: delivery.recipient,
          title,
          body,
        });
        status = result.status;
        error = result.error ?? null;
        providerMessageId = result.providerMessageId ?? null;
      }

      const updated = await tx.notificationDelivery.update({
        where: { id },
        data: {
          status,
          error,
          providerMessageId,
          sentAt: status === 'SENT' ? new Date() : null,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notice.delivery_retried',
        entity: 'NotificationDelivery',
        entityId: id,
        before: { status: delivery.status },
        after: { status, channel: delivery.channel },
      });
      return deliveryDto(updated);
    });
  }

  async notificationPreferences(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, (tx) =>
      preferencesForUsers(tx, auth.schoolId, [auth.userId]).then(
        (map) => map.get(auth.userId) ?? resolveNotificationPreferences(null),
      ),
    );
  }

  async updateNotificationPreferences(
    auth: AuthPrincipal,
    input: NotificationPreferencesInput,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.savedView.findUnique({
        where: {
          userId_resource_name: {
            userId: auth.userId,
            resource: PREFERENCES_RESOURCE,
            name: PREFERENCES_NAME,
          },
        },
      });
      const current = resolveNotificationPreferences(existing?.config ?? null);
      const next: NotificationPreferences = resolveNotificationPreferences({
        channels: { ...current.channels, ...input.channels },
        categories: { ...current.categories, ...input.categories },
      });
      await tx.savedView.upsert({
        where: {
          userId_resource_name: {
            userId: auth.userId,
            resource: PREFERENCES_RESOURCE,
            name: PREFERENCES_NAME,
          },
        },
        update: { config: next as never, isDefault: true },
        create: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          userId: auth.userId,
          resource: PREFERENCES_RESOURCE,
          name: PREFERENCES_NAME,
          config: next as never,
          isDefault: true,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'notification.preferences_updated',
        entity: 'SavedView',
        entityId: existing?.id,
        after: next as never,
      });
      return next;
    });
  }

  /** Published notices visible to the signed-in parent or student. */
  async portal(auth: AuthPrincipal, query: z.infer<typeof noticeListQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [notices, memberships] = await Promise.all([
        tx.notice.findMany({
          where: {
            schoolId: auth.schoolId,
            status: 'PUBLISHED',
            OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
          },
          orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
          take: 100,
          include: { attachments: true, createdBy: { select: { fullName: true } } },
        }),
        studentMemberships(tx, auth),
      ]);
      const now = new Date();
      const visible = notices.filter((notice) => {
        if (notice.expiresAt && notice.expiresAt < now) return false;
        return audienceMatches(notice.audience, auth.roleCode, memberships);
      });
      const start = (query.page - 1) * query.pageSize;
      return {
        items: visible.slice(start, start + query.pageSize).map(noticeDto),
        page: query.page,
        pageSize: query.pageSize,
        total: visible.length,
      };
    });
  }

  async notifications(auth: AuthPrincipal, query: z.infer<typeof notificationQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.NotificationWhereInput = {
        schoolId: auth.schoolId,
        userId: auth.userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
      };
      const [items, total, unread] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { schoolId: auth.schoolId, userId: auth.userId, readAt: null } }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total, unread };
    });
  }

  async markNotificationRead(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const notification = await tx.notification.findFirst({
        where: { id, schoolId: auth.schoolId, userId: auth.userId },
      });
      if (!notification) throw new NotFoundError('Notification');
      if (!notification.readAt) {
        await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
      }
      return { read: true };
    });
  }
}

async function studentMemberships(tx: TxClient, auth: AuthPrincipal) {
  if (auth.roleCode === 'STUDENT') {
    return tx.student.findMany({
      where: { schoolId: auth.schoolId, userId: auth.userId },
      select: { classId: true, sectionId: true },
    });
  }
  if (auth.roleCode === 'PARENT') {
    const guardians = await tx.guardian.findMany({
      where: { schoolId: auth.schoolId, userId: auth.userId },
      select: { student: { select: { classId: true, sectionId: true } } },
    });
    return guardians.map((guardian) => guardian.student);
  }
  return [];
}

function audienceMatches(
  audience: unknown,
  roleCode: string,
  memberships: { classId: string; sectionId: string }[],
): boolean {
  const value = (audience ?? {}) as {
    roles?: string[];
    classIds?: string[];
    sectionIds?: string[];
  };
  if (value.roles?.length && !value.roles.includes(roleCode)) return false;
  if (value.classIds?.length) {
    if (!memberships.some((row) => value.classIds!.includes(row.classId))) return false;
  }
  if (value.sectionIds?.length) {
    if (!memberships.some((row) => value.sectionIds!.includes(row.sectionId))) return false;
  }
  return true;
}

async function preferencesForUsers(
  tx: TxClient,
  schoolId: string,
  userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.savedView.findMany({
    where: {
      schoolId,
      userId: { in: userIds },
      resource: PREFERENCES_RESOURCE,
      name: PREFERENCES_NAME,
    },
    select: { userId: true, config: true },
  });
  return new Map(
    rows.map((row) => [row.userId, resolveNotificationPreferences(row.config)]),
  );
}

async function deliverySummary(tx: TxClient, schoolId: string, noticeId: string) {
  const rows = await tx.notificationDelivery.groupBy({
    by: ['status'],
    where: { schoolId, noticeId },
    _count: { _all: true },
  });
  const summary = { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 };
  for (const row of rows) {
    summary.total += row._count._all;
    switch (row.status) {
      case 'SENT':
        summary.sent += row._count._all;
        break;
      case 'FAILED':
        summary.failed += row._count._all;
        break;
      case 'SKIPPED':
        summary.skipped += row._count._all;
        break;
      default:
        summary.pending += row._count._all;
    }
  }
  return summary;
}

function deliveryDto(delivery: {
  id: string;
  noticeId: string | null;
  channel: string;
  recipient: string;
  status: string;
  providerMessageId: string | null;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: delivery.id,
    noticeId: delivery.noticeId,
    channel: delivery.channel,
    recipient: delivery.recipient,
    status: delivery.status,
    providerMessageId: delivery.providerMessageId,
    error: delivery.error,
    sentAt: delivery.sentAt,
    createdAt: delivery.createdAt,
  };
}

function skipReason(reason: 'NO_ADDRESS' | 'CHANNEL_DISABLED' | 'CATEGORY_DISABLED' | undefined): string {
  switch (reason) {
    case 'NO_ADDRESS':
      return 'No address is available for this channel';
    case 'CHANNEL_DISABLED':
      return 'The recipient opted out of this channel';
    case 'CATEGORY_DISABLED':
      return 'The recipient opted out of this notification category';
    default:
      return 'Delivery was skipped';
  }
}

type NoticeRecord = {
  id: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  audience: unknown;
  publishAt: Date | null;
  expiresAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { fullName: string } | null;
  attachments?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }[];
  _count?: { deliveries: number };
};

function noticeDto(notice: NoticeRecord) {
  return {
    id: notice.id,
    title: notice.title,
    body: notice.body,
    priority: notice.priority,
    status: notice.status,
    audience: notice.audience,
    publishAt: notice.publishAt,
    expiresAt: notice.expiresAt,
    publishedAt: notice.publishedAt,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
    createdBy: notice.createdBy?.fullName ?? null,
    attachments: notice.attachments ?? [],
    deliveryCount: notice._count?.deliveries,
  };
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
