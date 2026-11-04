import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

export const createRouteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  vehicleNo: z.string().trim().min(1).max(40),
  driverName: z.string().trim().min(1).max(120),
  driverPhone: z.string().trim().min(7).max(24),
  fareMinor: z.number().int().min(0).max(100_000_000).default(0),
  stops: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  active: z.boolean().default(true),
});

export const updateRouteSchema = createRouteSchema.partial();

export const assignTransportSchema = z.object({
  routeId: z.string().uuid(),
  studentId: z.string().uuid(),
  stop: z.string().trim().min(1).max(120),
});

export const routeQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
});

@Injectable()
export class TransportService {
  constructor(private readonly audit: AuditService) {}

  async listRoutes(auth: AuthPrincipal, query: z.infer<typeof routeQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where: Prisma.TransportRouteWhereInput = {
        schoolId: auth.schoolId,
        ...(query.active ? { active: query.active === 'true' } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { vehicleNo: { contains: query.q, mode: 'insensitive' } },
                { driverName: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const routes = await tx.transportRoute.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      const counts = await tx.transportAssignment.groupBy({
        by: ['routeId'],
        where: { schoolId: auth.schoolId },
        _count: { _all: true },
      });
      const countMap = new Map(counts.map((row) => [row.routeId, row._count._all]));
      return routes.map((route) => ({ ...route, assigned: countMap.get(route.id) ?? 0 }));
    });
  }

  async createRoute(auth: AuthPrincipal, input: z.infer<typeof createRouteSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const route = await tx.transportRoute.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          name: input.name,
          vehicleNo: input.vehicleNo,
          driverName: input.driverName,
          driverPhone: input.driverPhone,
          fareMinor: input.fareMinor,
          stops: input.stops,
          active: input.active,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'transport.route_created',
        entity: 'TransportRoute',
        entityId: route.id,
        after: { name: route.name },
      });
      return route;
    });
  }

  async updateRoute(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateRouteSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.transportRoute.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!current) throw new NotFoundError('Transport route');
      const route = await tx.transportRoute.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.vehicleNo !== undefined ? { vehicleNo: input.vehicleNo } : {}),
          ...(input.driverName !== undefined ? { driverName: input.driverName } : {}),
          ...(input.driverPhone !== undefined ? { driverPhone: input.driverPhone } : {}),
          ...(input.fareMinor !== undefined ? { fareMinor: input.fareMinor } : {}),
          ...(input.stops !== undefined ? { stops: input.stops } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'transport.route_updated',
        entity: 'TransportRoute',
        entityId: id,
        after: { name: route.name, active: route.active },
      });
      return route;
    });
  }

  async assignments(auth: AuthPrincipal, routeId?: string) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const assignments = await tx.transportAssignment.findMany({
        where: { schoolId: auth.schoolId, ...(routeId ? { routeId } : {}) },
        orderBy: { createdAt: 'desc' },
      });
      const studentIds = assignments.map((assignment) => assignment.studentId);
      const routeIds = [...new Set(assignments.map((assignment) => assignment.routeId))];
      const [students, routes] = await Promise.all([
        tx.student.findMany({
          where: { schoolId: auth.schoolId, id: { in: studentIds } },
          select: { id: true, firstName: true, lastName: true, admissionNo: true },
        }),
        tx.transportRoute.findMany({ where: { schoolId: auth.schoolId, id: { in: routeIds } } }),
      ]);
      const studentMap = new Map(students.map((student) => [student.id, student]));
      const routeMap = new Map(routes.map((route) => [route.id, route]));
      return assignments.map((assignment) => ({
        ...assignment,
        routeName: routeMap.get(assignment.routeId)?.name ?? 'Unknown route',
        vehicleNo: routeMap.get(assignment.routeId)?.vehicleNo ?? null,
        studentName: studentMap.get(assignment.studentId)
          ? `${studentMap.get(assignment.studentId)!.firstName} ${studentMap.get(assignment.studentId)!.lastName}`.trim()
          : 'Unknown student',
        admissionNo: studentMap.get(assignment.studentId)?.admissionNo ?? null,
      }));
    });
  }

  async assign(auth: AuthPrincipal, input: z.infer<typeof assignTransportSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [route, student] = await Promise.all([
        tx.transportRoute.findFirst({ where: { id: input.routeId, schoolId: auth.schoolId } }),
        tx.student.findFirst({
          where: { id: input.studentId, schoolId: auth.schoolId, deletedAt: null },
        }),
      ]);
      if (!route) throw new NotFoundError('Transport route');
      if (!student) throw new NotFoundError('Student');
      const existing = await tx.transportAssignment.findFirst({
        where: { schoolId: auth.schoolId, studentId: input.studentId },
      });
      if (existing) {
        const updated = await tx.transportAssignment.update({
          where: { id: existing.id },
          data: { routeId: input.routeId, stop: input.stop },
        });
        await this.audit.record(tx, auditCtx(auth, meta), {
          action: 'transport.assignment_updated',
          entity: 'TransportAssignment',
          entityId: updated.id,
          before: { routeId: existing.routeId, stop: existing.stop },
          after: { routeId: updated.routeId, stop: updated.stop },
        });
        return updated;
      }
      const assignment = await tx.transportAssignment.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          routeId: input.routeId,
          studentId: input.studentId,
          stop: input.stop,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'transport.assigned',
        entity: 'TransportAssignment',
        entityId: assignment.id,
        after: { routeId: input.routeId, studentId: input.studentId, stop: input.stop },
      });
      return assignment;
    });
  }

  async unassign(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const existing = await tx.transportAssignment.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!existing) throw new NotFoundError('Transport assignment');
      await tx.transportAssignment.delete({ where: { id } });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'transport.unassigned',
        entity: 'TransportAssignment',
        entityId: id,
        before: { routeId: existing.routeId, studentId: existing.studentId },
      });
      return { removed: true };
    });
  }

  async summary(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [routes, activeRoutes, assignments, fare] = await Promise.all([
        tx.transportRoute.count({ where: { schoolId: auth.schoolId } }),
        tx.transportRoute.count({ where: { schoolId: auth.schoolId, active: true } }),
        tx.transportAssignment.count({ where: { schoolId: auth.schoolId } }),
        tx.transportRoute.aggregate({
          where: { schoolId: auth.schoolId, active: true },
          _sum: { fareMinor: true },
        }),
      ]);
      return { routes, activeRoutes, assignments, monthlyFareMinor: fare._sum.fareMinor ?? 0 };
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
