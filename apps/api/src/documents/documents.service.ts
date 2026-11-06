import { Injectable } from '@nestjs/common';
import {
  AppError,
  NotFoundError,
  formatMoney,
  todayIso,
  uuidv7,
} from '@schoolerp/core';
import { renderPdf } from '@schoolerp/core/server';
import { z } from 'zod';
import { withTenant, type TxClient } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const ENTITY_TYPES = ['STUDENT', 'STAFF', 'PAYMENT', 'ADMISSION', 'INVENTORY'] as const;
export type DocumentEntityType = (typeof ENTITY_TYPES)[number];

interface TemplateSeed {
  code: string;
  name: string;
  body: string;
}

/**
 * Built-in starter templates. Schools can override the body through the
 * template endpoint; unknown placeholders are replaced with an empty string so
 * a stale template can never block document generation.
 */
export const DEFAULT_DOCUMENT_TEMPLATES: readonly TemplateSeed[] = [
  {
    code: 'STUDENT_BONAFIDE',
    name: 'Bonafide Certificate',
    body: [
      'This is to certify that {{studentName}} (Admission No. {{admissionNo}})',
      'is a bona fide student of {{schoolName}} studying in {{className}}, {{sectionName}}.',
      '',
      'Date of admission: {{admissionDate}}',
      '',
      'Issued on {{date}}.',
    ].join('\n'),
  },
  {
    code: 'FEE_RECEIPT',
    name: 'Fee Receipt',
    body: [
      'Receipt No.: {{receiptNumber}}',
      'Received with thanks from {{studentName}} ({{admissionNo}})',
      'the sum of {{amount}} by {{method}}.',
      '',
      'Payment date: {{paidAt}}',
      'Reference: {{reference}}',
    ].join('\n'),
  },
  {
    code: 'PAYSLIP',
    name: 'Payslip',
    body: [
      'Employee: {{staffName}} ({{employeeNo}})',
      'Pay period: {{period}}',
      '',
      'Basic: {{base}}',
      'Allowances: {{allowances}}',
      'Deductions: {{deductions}}',
      'Net pay: {{net}}',
    ].join('\n'),
  },
  {
    code: 'ADMISSION_OFFER',
    name: 'Admission Offer Letter',
    body: [
      'Dear {{guardianName}},',
      '',
      'We are pleased to offer admission to {{studentName}}',
      'in {{className}} at {{schoolName}}.',
      '',
      'Please complete the enrolment formalities by {{date}}.',
    ].join('\n'),
  },
];

export const templateQuerySchema = z.object({
  code: z.string().trim().min(1).max(40).optional(),
});

export const upsertTemplateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores'),
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20_000),
  isActive: z.boolean().default(true),
});

export const generateDocumentSchema = z.object({
  templateCode: z.string().trim().min(1).max(40),
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200).optional(),
  values: z.record(z.string().max(500)).default({}),
});

export const generatedDocumentQuerySchema = z.object({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

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

  async listTemplates(auth: AuthPrincipal, code?: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await ensureDefaultTemplates(tx, auth.schoolId);
      const items = await tx.documentTemplate.findMany({
        where: { schoolId: auth.schoolId, ...(code ? { code } : {}) },
        orderBy: { code: 'asc' },
      });
      return { items };
    });
  }

  async upsertTemplate(
    auth: AuthPrincipal,
    input: z.infer<typeof upsertTemplateSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await ensureDefaultTemplates(tx, auth.schoolId);
      const existing = await tx.documentTemplate.findUnique({
        where: { schoolId_code: { schoolId: auth.schoolId, code: input.code } },
      });
      const template = existing
        ? await tx.documentTemplate.update({
            where: { id: existing.id },
            data: { name: input.name, body: input.body, isActive: input.isActive },
          })
        : await tx.documentTemplate.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              code: input.code,
              name: input.name,
              body: input.body,
              isActive: input.isActive,
            },
          });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: existing ? 'document.template_updated' : 'document.template_created',
        entity: 'DocumentTemplate',
        entityId: template.id,
        before: existing ? { name: existing.name, body: existing.body } : undefined,
        after: { code: template.code, name: template.name, isActive: template.isActive },
      });
      return template;
    });
  }

  async generate(
    auth: AuthPrincipal,
    input: z.infer<typeof generateDocumentSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await ensureDefaultTemplates(tx, auth.schoolId);
      const template = await tx.documentTemplate.findUnique({
        where: { schoolId_code: { schoolId: auth.schoolId, code: input.templateCode } },
      });
      if (!template) throw new NotFoundError('Document template');
      if (!template.isActive) {
        throw new AppError('CONFLICT', 'This document template is inactive', 409);
      }

      const context = await buildContext(tx, auth.schoolId, input.entityType, input.entityId);
      for (const [key, value] of Object.entries(input.values)) {
        context[key] = value;
      }
      context.date ??= todayIso();
      context.generatedOn = todayIso();

      const body = renderTemplate(template.body, context);
      const pdf = renderPdf({
        title: template.name,
        lines: body.split('\n'),
        footer: `${context.schoolName ?? 'School'} - generated ${context.generatedOn}`,
      });

      const fileName =
        input.fileName ?? `${template.code.toLowerCase()}-${input.entityId.slice(0, 8)}.pdf`;
      const document = await tx.generatedDocument.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          templateId: template.id,
          templateCode: template.code,
          entityType: input.entityType,
          entityId: input.entityId,
          fileName,
          mimeType: 'application/pdf',
          sizeBytes: pdf.byteLength,
          content: new Uint8Array(pdf),
          createdByUserId: auth.userId,
        },
        select: {
          id: true,
          templateCode: true,
          entityType: true,
          entityId: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      });

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'document.generated',
        entity: 'GeneratedDocument',
        entityId: document.id,
        after: {
          templateCode: document.templateCode,
          entityType: document.entityType,
          entityId: document.entityId,
          fileName: document.fileName,
          sizeBytes: document.sizeBytes,
        },
      });
      return document;
    });
  }

  async listGenerated(
    auth: AuthPrincipal,
    query: z.infer<typeof generatedDocumentQuerySchema>,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where = {
        schoolId: auth.schoolId,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
      };
      const [items, total] = await Promise.all([
        tx.generatedDocument.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            templateCode: true,
            entityType: true,
            entityId: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        }),
        tx.generatedDocument.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async downloadGenerated(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const document = await tx.generatedDocument.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!document) throw new NotFoundError('Generated document');
      return {
        fileName: document.fileName,
        mimeType: document.mimeType,
        content: Buffer.from(document.content),
      };
    });
  }
}

/** Replaces `{{token}}` placeholders; unknown tokens become an empty string. */
export function renderTemplate(
  body: string,
  values: Record<string, string | undefined>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}

async function ensureDefaultTemplates(tx: TxClient, schoolId: string) {  const existing = await tx.documentTemplate.findMany({
    where: { schoolId },
    select: { code: true },
  });
  const codes = new Set(existing.map((row) => row.code));
  for (const template of DEFAULT_DOCUMENT_TEMPLATES) {
    if (codes.has(template.code)) continue;
    await tx.documentTemplate.create({
      data: {
        id: uuidv7(),
        schoolId,
        code: template.code,
        name: template.name,
        body: template.body,
        isActive: true,
      },
    });
  }
}

async function buildContext(
  tx: TxClient,
  schoolId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<Record<string, string>> {
  const school = await tx.school.findUnique({
    where: { id: schoolId },
    select: { name: true, slug: true, currency: true },
  });
  const context: Record<string, string> = {
    schoolName: school?.name ?? 'School',
    schoolSlug: school?.slug ?? '',
    currency: school?.currency ?? 'NPR',
  };
  const money = (minor: number) => formatMoney(minor, school?.currency ?? 'NPR');

  switch (entityType) {
    case 'STUDENT': {
      const student = await tx.student.findFirst({
        where: { id: entityId, schoolId, deletedAt: null },
        include: { class: { select: { name: true } }, section: { select: { name: true } } },
      });
      if (!student) throw new NotFoundError('Student');
      Object.assign(context, {
        studentName: `${student.firstName} ${student.lastName}`.trim(),
        admissionNo: student.admissionNo,
        className: student.class.name,
        sectionName: student.section.name,
        admissionDate: student.admissionDate.toISOString().slice(0, 10),
        status: student.status,
      });
      break;
    }
    case 'STAFF': {
      const staff = await tx.staff.findFirst({
        where: { id: entityId, schoolId, deletedAt: null },
      });
      if (!staff) throw new NotFoundError('Staff member');
      Object.assign(context, {
        staffName: `${staff.firstName} ${staff.lastName}`.trim(),
        employeeNo: staff.employeeNo,
        joinedOn: staff.joinedOn?.toISOString().slice(0, 10) ?? '',
        employmentType: staff.employmentType,
      });
      break;
    }
    case 'PAYMENT': {
      const payment = await tx.payment.findFirst({
        where: { id: entityId, schoolId },
        include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
      });
      if (!payment) throw new NotFoundError('Payment');
      Object.assign(context, {
        receiptNumber: payment.receiptNumber,
        studentName: `${payment.student.firstName} ${payment.student.lastName}`.trim(),
        admissionNo: payment.student.admissionNo,
        amount: money(payment.amountMinor),
        method: payment.method,
        paidAt: payment.paidAt.toISOString().slice(0, 10),
        reference: payment.reference ?? '',
      });
      break;
    }
    case 'ADMISSION': {
      const application = await tx.admissionApplication.findFirst({
        where: { id: entityId, schoolId },
        include: { class: { select: { name: true } } },
      });
      if (!application) throw new NotFoundError('Admission application');
      Object.assign(context, {
        studentName: application.studentName,
        guardianName: application.guardianName,
        className: application.class?.name ?? 'the offered class',
        phone: application.phone,
        email: application.email ?? '',
        status: application.status,
      });
      break;
    }
  }
  return context;
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
