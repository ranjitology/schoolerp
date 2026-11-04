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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createHomeworkSchema = z.object({
  classId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(10_000),
  dueDate: isoDate,
  attachmentKey: z.string().trim().max(500).optional(),
});

export const updateHomeworkSchema = createHomeworkSchema.partial();

export const homeworkQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  upcoming: z.enum(['true', 'false']).default('false'),
});

@Injectable()
export class HomeworkService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal, query: z.infer<typeof homeworkQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const memberships =
        auth.roleCode === 'PARENT' || auth.roleCode === 'STUDENT'
          ? await studentMemberships(tx, auth)
          : null;
      const where: Prisma.HomeworkWhereInput = {
        schoolId: auth.schoolId,
        ...(query.classId ? { classId: query.classId } : {}),
        ...(query.sectionId ? { sectionId: query.sectionId } : {}),
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        ...(query.upcoming === 'true' ? { dueDate: { gte: new Date() } } : {}),
        ...(memberships
          ? {
              OR: memberships.length
                ? memberships.map((membership) => ({
                    classId: membership.classId,
                    sectionId: membership.sectionId,
                  }))
                : [{ id: '00000000-0000-0000-0000-000000000000' }],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.homework.findMany({
          where,
          orderBy: { dueDate: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            class: { select: { name: true } },
            section: { select: { name: true } },
            subject: { select: { name: true } },
          },
        }),
        tx.homework.count({ where }),
      ]);
      return {
        items: items.map((item) => ({
          ...item,
          className: item.class.name,
          sectionName: item.section.name,
          subjectName: item.subject.name,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async create(
    auth: AuthPrincipal,
    input: z.infer<typeof createHomeworkSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const section = await tx.section.findFirst({
        where: { id: input.sectionId, schoolId: auth.schoolId, classId: input.classId },
        select: { id: true },
      });
      if (!section) throw new NotFoundError('Class section');
      const homework = await tx.homework.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          classId: input.classId,
          sectionId: input.sectionId,
          subjectId: input.subjectId,
          title: input.title,
          description: input.description,
          dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
          attachmentKey: input.attachmentKey ?? null,
          createdByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'homework.created',
        entity: 'Homework',
        entityId: homework.id,
        after: { title: homework.title, dueDate: input.dueDate },
      });
      return homework;
    });
  }

  async update(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateHomeworkSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.homework.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Homework');
      const homework = await tx.homework.update({
        where: { id },
        data: {
          ...(input.classId !== undefined ? { classId: input.classId } : {}),
          ...(input.sectionId !== undefined ? { sectionId: input.sectionId } : {}),
          ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.attachmentKey !== undefined ? { attachmentKey: input.attachmentKey ?? null } : {}),
          ...(input.dueDate !== undefined
            ? { dueDate: new Date(`${input.dueDate}T00:00:00.000Z`) }
            : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'homework.updated',
        entity: 'Homework',
        entityId: id,
        before: { title: current.title },
        after: { title: homework.title },
      });
      return homework;
    });
  }

  async remove(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.homework.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Homework');
      await tx.homework.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'homework.deleted',
        entity: 'Homework',
        entityId: id,
        before: { title: current.title },
      });
      return { removed: true };
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
