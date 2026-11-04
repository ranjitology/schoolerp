import { Controller, Get, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uuidSchema } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/decorators';
import type { AuthPrincipal } from '../common/request';
import { zodBody } from '../common/zod.pipe';

const tenantAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(80).optional(),
  actorUserId: uuidSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  async list(
    @CurrentAuth() auth: AuthPrincipal,
    @Query(zodBody(tenantAuditQuerySchema)) query: z.infer<typeof tenantAuditQuerySchema>,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.AuditLogWhereInput = {
        schoolId: auth.schoolId,
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
        ...(query.entity ? { entity: query.entity } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.auditLog.count({ where }),
      ]);
      const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)))];
      const actors = actorIds.length
        ? await tx.user.findMany({
            where: { schoolId: auth.schoolId, id: { in: actorIds } },
            select: { id: true, fullName: true, email: true },
          })
        : [];
      const actorMap = new Map(actors.map((actor) => [actor.id, actor]));

      return {
        items: rows.map((row) => ({
          id: row.id,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          actorType: row.actorType,
          actor: row.actorUserId ? actorMap.get(row.actorUserId) ?? { id: row.actorUserId } : null,
          before: row.before,
          after: row.after,
          ip: row.ip,
          userAgent: row.userAgent,
          requestId: row.requestId,
          impersonationId: row.impersonationId,
          hash: row.hash,
          prevHash: row.prevHash,
          createdAt: row.createdAt,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  @Get('verify')
  @RequirePermissions('audit:read')
  async verify(@CurrentAuth() auth: AuthPrincipal) {
    return this.audit.verifyChain(auth.schoolId);
  }
}
