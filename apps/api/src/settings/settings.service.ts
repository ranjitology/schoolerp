import { Injectable } from '@nestjs/common';
import { NotFoundError, updateSchoolProfileSchema, uuidv7 } from '@schoolerp/core';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import { AuditService } from '../audit/audit.service';
import type { AuthPrincipal } from '../common/request';

interface AuditMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export const settingsUpdateSchema = updateSchoolProfileSchema;

@Injectable()
export class SettingsService {
  constructor(private readonly audit: AuditService) {}

  async get(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const school = await tx.school.findFirst({
        where: { id: auth.schoolId, deletedAt: null },
        include: {
          plan: { select: { code: true, name: true, limits: true, interval: true, priceMinor: true } },
          subscription: true,
          settings: true,
        },
      });
      if (!school) throw new NotFoundError('School');
      const grading = await tx.gradingScale.findFirst({
        where: { schoolId: auth.schoolId, isDefault: true },
        orderBy: { createdAt: 'asc' },
        include: { bands: { orderBy: { sequence: 'asc' } } },
      });
      return {
        ...school,
        grading: grading
          ? {
              name: grading.name,
              bands: grading.bands.map((band) => ({
                grade: band.grade,
                minPercent: Number(band.minPercent),
                maxPercent: Number(band.maxPercent),
                gpa: Number(band.gpa),
                remark: band.remark ?? undefined,
              })),
            }
          : null,
      };
    });
  }

  async update(
    auth: AuthPrincipal,
    input: z.infer<typeof settingsUpdateSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const school = await tx.school.findFirst({
        where: { id: auth.schoolId, deletedAt: null },
        include: { settings: true },
      });
      if (!school) throw new NotFoundError('School');

      const settingsData = {
        ...(input.legalName !== undefined ? { legalName: input.legalName ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.website !== undefined ? { website: input.website || null } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.calendarSystem !== undefined ? { calendarSystem: input.calendarSystem } : {}),
        ...(input.academicYearStartMonth !== undefined
          ? { academicYearStartMonth: input.academicYearStartMonth }
          : {}),
        ...(input.academicYearStartDay !== undefined
          ? { academicYearStartDay: input.academicYearStartDay }
          : {}),
        ...(input.workingDays !== undefined ? { workingDays: input.workingDays } : {}),
        ...(input.periodsPerDay !== undefined ? { periodsPerDay: input.periodsPerDay } : {}),
        ...(input.periodMinutes !== undefined ? { periodMinutes: input.periodMinutes } : {}),
        ...(input.branding !== undefined ? { branding: input.branding as never } : {}),
        ...(input.attendance !== undefined ? { attendance: input.attendance as never } : {}),
        ...(input.fees !== undefined ? { fees: input.fees as never } : {}),
        ...(input.enableParentPortal !== undefined
          ? { enableParentPortal: input.enableParentPortal }
          : {}),
        ...(input.enableStudentPortal !== undefined
          ? { enableStudentPortal: input.enableStudentPortal }
          : {}),
      };

      if (!school.settings) {
        await tx.schoolSetting.create({
          data: { schoolId: auth.schoolId, ...settingsData },
        });
      } else {
        await tx.schoolSetting.update({ where: { schoolId: auth.schoolId }, data: settingsData });
      }

      const updated = await tx.school.update({
        where: { id: auth.schoolId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.calendarSystem !== undefined ? { calendarSystem: input.calendarSystem } : {}),
          ...(input.branding !== undefined ? { branding: input.branding as never } : {}),
        },
      });

      if (input.grading) {
        const existing = await tx.gradingScale.findFirst({
          where: { schoolId: auth.schoolId, isDefault: true },
          orderBy: { createdAt: 'asc' },
        });
        if (existing) {
          await tx.gradeBand.deleteMany({ where: { scaleId: existing.id } });
          await tx.gradingScale.update({
            where: { id: existing.id },
            data: {
              name: input.grading.name,
              bands: {
                create: input.grading.bands.map((band, index) => ({
                  id: uuidv7(),
                  schoolId: auth.schoolId,
                  grade: band.grade,
                  minPercent: band.minPercent,
                  maxPercent: band.maxPercent,
                  gpa: band.gpa,
                  remark: band.remark ?? null,
                  sequence: index,
                })),
              },
            },
          });
        } else {
          await tx.gradingScale.create({
            data: {
              id: uuidv7(),
              schoolId: auth.schoolId,
              name: input.grading.name,
              isDefault: true,
              bands: {
                create: input.grading.bands.map((band, index) => ({
                  id: uuidv7(),
                  schoolId: auth.schoolId,
                  grade: band.grade,
                  minPercent: band.minPercent,
                  maxPercent: band.maxPercent,
                  gpa: band.gpa,
                  remark: band.remark ?? null,
                  sequence: index,
                })),
              },
            },
          });
        }
      }

      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'settings.updated',
        entity: 'School',
        entityId: auth.schoolId,
        before: { name: school.name, calendarSystem: school.calendarSystem },
        after: { name: updated.name, calendarSystem: updated.calendarSystem },
      });

      return { updated: true };
    });
  }

  async listAcademicYears(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      return tx.academicYear.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: { startDate: 'desc' },
      });
    });
  }
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
