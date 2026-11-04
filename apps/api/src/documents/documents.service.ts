import { Injectable } from '@nestjs/common';
import { NotFoundError, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const documentQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
});

export const createStudentDocumentSchema = z.object({
  studentId: z.string().uuid(),
  kind: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(160),
  storageKey: z.string().trim().min(1).max(500),
});

export const createStaffDocumentSchema = z.object({
  staffId: z.string().uuid(),
  kind: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(160),
  storageKey: z.string().trim().min(1).max(500),
  expiresAt: isoDate.optional(),
});

@Injectable()
export class DocumentsService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal, query: z.infer<typeof documentQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      if (query.studentId) {
        const student = await tx.student.findFirst({
          where: { id: query.studentId, schoolId: auth.schoolId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        });
        if (!student) throw new NotFoundError('Student');
        const items = await tx.studentDocument.findMany({
          where: { schoolId: auth.schoolId, studentId: query.studentId },
          orderBy: { createdAt: 'desc' },
        });
        return {
          owner: { type: 'STUDENT', id: student.id, name: `${student.firstName} ${student.lastName}`.trim() },
          items,
        };
      }
      if (query.staffId) {
        const staff = await tx.staff.findFirst({
          where: { id: query.staffId, schoolId: auth.schoolId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        });
        if (!staff) throw new NotFoundError('Staff member');
        const items = await tx.staffDocument.findMany({
          where: { schoolId: auth.schoolId, staffId: query.staffId },
          orderBy: { createdAt: 'desc' },
        });
        return {
          owner: { type: 'STAFF', id: staff.id, name: `${staff.firstName} ${staff.lastName}`.trim() },
          items,
        };
      }
      return { owner: null, items: [] };
    });
  }

  async addStudentDocument(
    auth: AuthPrincipal,
    input: z.infer<typeof createStudentDocumentSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: input.studentId, schoolId: auth.schoolId, deletedAt: null },
      });
      if (!student) throw new NotFoundError('Student');
      ensureTenantKey(auth.schoolId, input.storageKey);
      const document = await tx.studentDocument.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          studentId: input.studentId,
          kind: input.kind,
          title: input.title,
          storageKey: input.storageKey,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'document.student_added',
        entity: 'StudentDocument',
        entityId: document.id,
        after: { studentId: input.studentId, title: input.title, kind: input.kind },
      });
      return document;
    });
  }

  async addStaffDocument(
    auth: AuthPrincipal,
    input: z.infer<typeof createStaffDocumentSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { id: input.staffId, schoolId: auth.schoolId, deletedAt: null },
      });
      if (!staff) throw new NotFoundError('Staff member');
      ensureTenantKey(auth.schoolId, input.storageKey);
      const document = await tx.staffDocument.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          staffId: input.staffId,
          kind: input.kind,
          title: input.title,
          storageKey: input.storageKey,
          expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T00:00:00.000Z`) : null,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'document.staff_added',
        entity: 'StaffDocument',
        entityId: document.id,
        after: { staffId: input.staffId, title: input.title, kind: input.kind },
      });
      return document;
    });
  }

  async removeStudentDocument(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const document = await tx.studentDocument.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!document) throw new NotFoundError('Document');
      await tx.studentDocument.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'document.student_removed',
        entity: 'StudentDocument',
        entityId: id,
        before: { studentId: document.studentId, title: document.title },
      });
      return { removed: true };
    });
  }

  async removeStaffDocument(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const document = await tx.staffDocument.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!document) throw new NotFoundError('Document');
      await tx.staffDocument.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'document.staff_removed',
        entity: 'StaffDocument',
        entityId: id,
        before: { staffId: document.staffId, title: document.title },
      });
      return { removed: true };
    });
  }
}

function ensureTenantKey(schoolId: string, key: string) {
  if (!key.startsWith(`tenants/${schoolId}/`)) throw new NotFoundError('Storage key');
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
