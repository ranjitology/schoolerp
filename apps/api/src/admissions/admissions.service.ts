import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AppError,
  ConflictError,
  DEFAULT_PLAN_LIMITS,
  NotFoundError,
  assertWithinLimit,
  uuidv7,
  type PlanLimits,
} from '@schoolerp/core';
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

export const applicationStatusSchema = z.enum([
  'INQUIRY',
  'APPLIED',
  'DOCUMENTS_PENDING',
  'APPROVED',
  'REJECTED',
  'ADMITTED',
  'WITHDRAWN',
]);

export const createApplicationSchema = z.object({
  academicYearId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  studentName: z.string().trim().min(2).max(120),
  guardianName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24),
  email: z.string().email().max(254).optional(),
  source: z.enum(['WALK_IN', 'PHONE', 'ONLINE', 'REFERRAL', 'SOCIAL']).default('WALK_IN'),
  notes: z.string().trim().max(2000).optional(),
  status: applicationStatusSchema.default('INQUIRY'),
});

export const updateApplicationSchema = createApplicationSchema.partial().extend({
  status: applicationStatusSchema.optional(),
});

export const applicationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: applicationStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

export const convertApplicationSchema = z.object({
  classId: z.string().uuid(),
  sectionId: z.string().uuid(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  admissionNo: z.string().trim().min(1).max(32).optional(),
  dateOfBirth: isoDate.optional(),
  rollNo: z.string().trim().max(20).optional(),
});

export const bulkConvertSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  classId: z.string().uuid(),
  sectionId: z.string().uuid(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).default('OTHER'),
  rollNoStart: z.number().int().min(1).max(100000).optional(),
});
export type BulkConvertInput = z.infer<typeof bulkConvertSchema>;

@Injectable()
export class AdmissionsService {
  constructor(private readonly audit: AuditService) {}

  async list(auth: AuthPrincipal, query: z.infer<typeof applicationQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.AdmissionApplicationWhereInput = {
        schoolId: auth.schoolId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { studentName: { contains: query.q, mode: 'insensitive' } },
                { guardianName: { contains: query.q, mode: 'insensitive' } },
                { phone: { contains: query.q } },
              ],
            }
          : {}),
      };
      const [items, total, byStatus] = await Promise.all([
        tx.admissionApplication.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            class: { select: { name: true } },
            academicYear: { select: { name: true } },
          },
        }),
        tx.admissionApplication.count({ where }),
        tx.admissionApplication.groupBy({
          by: ['status'],
          where: { schoolId: auth.schoolId },
          _count: { _all: true },
        }),
      ]);
      return {
        items: items.map((item) => ({
          ...item,
          className: item.class?.name ?? null,
          academicYearName: item.academicYear?.name ?? null,
        })),
        byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  async get(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const application = await tx.admissionApplication.findFirst({
        where: { id, schoolId: auth.schoolId },
        include: { class: { select: { name: true } }, academicYear: { select: { name: true } } },
      });
      if (!application) throw new NotFoundError('Application');
      return application;
    });
  }

  async create(
    auth: AuthPrincipal,
    input: z.infer<typeof createApplicationSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const application = await tx.admissionApplication.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          academicYearId: input.academicYearId ?? null,
          classId: input.classId ?? null,
          studentName: input.studentName,
          guardianName: input.guardianName,
          phone: input.phone,
          email: input.email ?? null,
          source: input.source,
          notes: input.notes ?? null,
          status: input.status,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'admission.created',
        entity: 'AdmissionApplication',
        entityId: application.id,
        after: { studentName: application.studentName, status: application.status },
      });
      return application;
    });
  }

  async update(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateApplicationSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.admissionApplication.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!current) throw new NotFoundError('Application');
      const application = await tx.admissionApplication.update({
        where: { id },
        data: {
          ...(input.academicYearId !== undefined ? { academicYearId: input.academicYearId ?? null } : {}),
          ...(input.classId !== undefined ? { classId: input.classId ?? null } : {}),
          ...(input.studentName !== undefined ? { studentName: input.studentName } : {}),
          ...(input.guardianName !== undefined ? { guardianName: input.guardianName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email ?? null } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'admission.updated',
        entity: 'AdmissionApplication',
        entityId: id,
        before: { status: current.status },
        after: { status: application.status },
      });
      return application;
    });
  }

  /** Printable, self-contained admission offer letter. */
  async offerLetter(auth: AuthPrincipal, id: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [application, school, settings] = await Promise.all([
        tx.admissionApplication.findFirst({
          where: { id, schoolId: auth.schoolId },
          include: {
            class: { select: { name: true } },
            academicYear: { select: { name: true } },
          },
        }),
        tx.school.findUnique({
          where: { id: auth.schoolId },
          select: { name: true, slug: true },
        }),
        tx.schoolSetting.findUnique({
          where: { schoolId: auth.schoolId },
          select: {
            legalName: true,
            address: true,
            phone: true,
            email: true,
            website: true,
          },
        }),
      ]);
      if (!application) throw new NotFoundError('Application');
      return {
        applicationId: application.id,
        fileName: `offer-${application.id.slice(0, 8)}.html`,
        html: renderOfferLetter({
          schoolName: settings?.legalName ?? school?.name ?? 'School',
          address: settings?.address ?? null,
          phone: settings?.phone ?? null,
          email: settings?.email ?? null,
          website: settings?.website ?? null,
          studentName: application.studentName,
          guardianName: application.guardianName,
          className: application.class?.name ?? 'the requested class',
          academicYear: application.academicYear?.name ?? null,
          status: application.status,
          issuedOn: new Date().toISOString().slice(0, 10),
          reference: application.id.slice(0, 8).toUpperCase(),
        }),
      };
    });
  }

  /**
   * Admits several approved applications into one class/section in a single
   * transaction. Applications that were already converted are reported as
   * skipped instead of failing the whole batch.
   */
  async bulkConvert(
    auth: AuthPrincipal,
    input: BulkConvertInput,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const section = await tx.section.findFirst({
        where: { id: input.sectionId, schoolId: auth.schoolId, classId: input.classId },
        select: { id: true, name: true, class: { select: { name: true } } },
      });
      if (!section) {
        throw new AppError('VALIDATION_FAILED', 'The chosen class and section do not match', 422);
      }

      const applications = await tx.admissionApplication.findMany({
        where: { schoolId: auth.schoolId, id: { in: input.ids } },
        orderBy: { createdAt: 'asc' },
      });
      const found = new Set(applications.map((application) => application.id));
      const skipped = input.ids.filter((id) => !found.has(id));
      const eligible = applications.filter((application) => {
        if (application.convertedStudentId) {
          skipped.push(application.id);
          return false;
        }
        return true;
      });

      await assertStudentLimit(tx, auth.schoolId, eligible.length);

      const year = new Date().getUTCFullYear();
      let sequence = await tx.student.count({ where: { schoolId: auth.schoolId } });
      let rollNo = input.rollNoStart ?? 1;
      const students: { id: string; admissionNo: string; name: string }[] = [];

      for (const application of eligible) {
        let admissionNo: string;
        do {
          sequence += 1;
          admissionNo = `ADM-${year}-${String(sequence).padStart(4, '0')}`;
        } while (
          await tx.student.findFirst({
            where: { schoolId: auth.schoolId, admissionNo },
            select: { id: true },
          })
        );

        const [firstName, ...rest] = application.studentName.trim().split(/\s+/);
        const student = await tx.student.create({
          data: {
            id: uuidv7(),
            schoolId: auth.schoolId,
            admissionNo,
            firstName: firstName ?? application.studentName,
            lastName: rest.join(' '),
            gender: input.gender,
            classId: input.classId,
            sectionId: input.sectionId,
            rollNo: input.rollNoStart === undefined ? null : String(rollNo++),
            phone: application.phone,
            email: application.email,
            status: 'ACTIVE',
            admissionDate: new Date(),
            guardians: {
              create: [
                {
                  id: uuidv7(),
                  schoolId: auth.schoolId,
                  relation: 'GUARDIAN',
                  fullName: application.guardianName,
                  phone: application.phone,
                  email: application.email,
                  isPrimary: true,
                },
              ],
            },
          },
        });
        await tx.admissionApplication.update({
          where: { id: application.id },
          data: { status: 'ADMITTED', convertedStudentId: student.id },
        });
        students.push({
          id: student.id,
          admissionNo: student.admissionNo,
          name: `${student.firstName} ${student.lastName}`.trim(),
        });
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'admission.bulk_converted',
        entity: 'AdmissionApplication',
        after: {
          admitted: students.length,
          skipped: skipped.length,
          classId: input.classId,
          sectionId: input.sectionId,
        },
      });

      return {
        admitted: students.length,
        skipped: skipped.length,
        skippedIds: skipped,
        className: section.class.name,
        sectionName: section.name,
        students,
      };
    });
  }

  async convert(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof convertApplicationSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const application = await tx.admissionApplication.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!application) throw new NotFoundError('Application');
      if (application.convertedStudentId) throw new ConflictError('This application is already admitted');

      const section = await tx.section.findFirst({
        where: { id: input.sectionId, schoolId: auth.schoolId, classId: input.classId },
        select: { id: true },
      });
      if (!section) {
        throw new AppError('VALIDATION_FAILED', 'The chosen class and section do not match', 422);
      }

      let admissionNo = input.admissionNo;
      if (!admissionNo) {
        const count = await tx.student.count({ where: { schoolId: auth.schoolId } });
        admissionNo = `ADM-${new Date().getUTCFullYear()}-${String(count + 1).padStart(4, '0')}`;
      }
      const existing = await tx.student.findFirst({
        where: { schoolId: auth.schoolId, admissionNo },
        select: { id: true },
      });
      if (existing) throw new ConflictError('That admission number is already in use');

      const [firstName, ...rest] = application.studentName.trim().split(/\s+/);
      const lastName = rest.join(' ');
      const student = await tx.student.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          admissionNo,
          firstName: firstName ?? application.studentName,
          lastName,
          gender: input.gender,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
          classId: input.classId,
          sectionId: input.sectionId,
          rollNo: input.rollNo ?? null,
          phone: application.phone,
          email: application.email,
          status: 'ACTIVE',
          admissionDate: new Date(),
          guardians: {
            create: [
              {
                id: uuidv7(),
                schoolId: auth.schoolId,
                relation: 'GUARDIAN',
                fullName: application.guardianName,
                phone: application.phone,
                email: application.email,
                isPrimary: true,
              },
            ],
          },
        },
      });
      await tx.admissionApplication.update({
        where: { id },
        data: { status: 'ADMITTED', convertedStudentId: student.id },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'admission.converted',
        entity: 'AdmissionApplication',
        entityId: id,
        after: { studentId: student.id, admissionNo: student.admissionNo },
      });
      return { studentId: student.id, admissionNo: student.admissionNo };
    });
  }
}

async function assertStudentLimit(
  tx: TxClient,
  schoolId: string,
  requested: number,
): Promise<void> {
  if (requested <= 0) return;
  const school = await tx.school.findUnique({
    where: { id: schoolId },
    select: { limitsOverride: true, plan: { select: { code: true, limits: true } } },
  });
  if (!school) throw new NotFoundError('School');
  const limits =
    (school.plan?.limits as unknown as PlanLimits | undefined) ??
    DEFAULT_PLAN_LIMITS.trial!;
  const overrides = (school.limitsOverride ?? {}) as { students?: number };
  const current = await tx.student.count({ where: { schoolId, deletedAt: null } });
  assertWithinLimit(
    {
      plan: { code: school.plan?.code ?? 'trial', limits },
      overrides: { limits: overrides },
    },
    'students',
    current,
    requested,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOfferLetter(input: {
  schoolName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  studentName: string;
  guardianName: string;
  className: string;
  academicYear: string | null;
  status: string;
  issuedOn: string;
  reference: string;
}): string {
  const contact = [input.address, input.phone, input.email, input.website]
    .filter(Boolean)
    .map((value) => escapeHtml(value!))
    .join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admission offer · ${escapeHtml(input.studentName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; font-family: Georgia, "Times New Roman", serif; color: #0f172a; }
  main { width: 210mm; min-height: 297mm; margin: 24px auto; background: #fff; padding: 24mm 22mm; box-shadow: 0 10px 40px rgba(15,23,42,.12); }
  header { border-bottom: 3px solid #0f766e; padding-bottom: 14px; margin-bottom: 28px; }
  header h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .02em; }
  header p { margin: 2px 0; font-size: 12px; color: #475569; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; color: #475569; margin-bottom: 28px; }
  h2 { font-size: 20px; margin: 0 0 18px; }
  p { line-height: 1.7; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e2e8f0; }
  th { width: 34%; color: #475569; font-weight: 600; }
  .note { margin-top: 22px; background: #f0fdfa; border-left: 4px solid #0f766e; padding: 12px 16px; font-size: 13px; }
  .signature { margin-top: 56px; display: flex; justify-content: space-between; font-size: 13px; }
  .signature div { width: 45%; border-top: 1px solid #94a3b8; padding-top: 8px; color: #475569; }
  @media print { body { background: #fff; } main { margin: 0; box-shadow: none; width: auto; min-height: auto; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(input.schoolName)}</h1>
    <p>${contact}</p>
  </header>
  <div class="meta">
    <span>Reference: ${escapeHtml(input.reference)}</span>
    <span>Issued: ${escapeHtml(input.issuedOn)}</span>
  </div>
  <h2>Admission offer</h2>
  <p>Dear ${escapeHtml(input.guardianName)},</p>
  <p>
    On behalf of ${escapeHtml(input.schoolName)}, we are pleased to offer a place to
    <strong>${escapeHtml(input.studentName)}</strong> for admission to
    <strong>${escapeHtml(input.className)}</strong>${input.academicYear ? ` in the ${escapeHtml(input.academicYear)} academic year` : ''}.
  </p>
  <table>
    <tr><th>Student</th><td>${escapeHtml(input.studentName)}</td></tr>
    <tr><th>Class</th><td>${escapeHtml(input.className)}</td></tr>
    ${input.academicYear ? `<tr><th>Academic year</th><td>${escapeHtml(input.academicYear)}</td></tr>` : ''}
    <tr><th>Application status</th><td>${escapeHtml(input.status)}</td></tr>
  </table>
  <div class="note">
    This offer is conditional on presenting the student's birth certificate, previous school
    records (where applicable) and the admission fee at the school office within seven working
    days of the issue date.
  </div>
  <p>We look forward to welcoming your family to our school community.</p>
  <div class="signature">
    <div>Principal / Admission Officer</div>
    <div>Guardian signature and date</div>
  </div>
</main>
</body>
</html>`;
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
