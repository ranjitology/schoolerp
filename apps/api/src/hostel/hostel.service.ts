import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, uuidv7 } from '@schoolerp/core';
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

export const createHostelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['BOYS', 'GIRLS', 'MIXED']).default('BOYS'),
  capacity: z.number().int().min(0).max(10_000).default(0),
  wardenId: z.string().uuid().optional(),
});

export const updateHostelSchema = createHostelSchema.partial();

export const createRoomSchema = z.object({
  hostelId: z.string().uuid(),
  roomNo: z.string().trim().min(1).max(20),
  capacity: z.number().int().min(1).max(100).default(1),
  rentMinor: z.number().int().min(0).max(100_000_000).default(0),
});

export const allocateSchema = z.object({
  hostelId: z.string().uuid(),
  roomId: z.string().uuid(),
  studentId: z.string().uuid(),
  startDate: isoDate,
  rentMinor: z.number().int().min(0).optional(),
});

export const hostelQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export const allocationQuerySchema = z.object({
  hostelId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'VACATED']).optional(),
});

@Injectable()
export class HostelService {
  constructor(private readonly audit: AuditService) {}

  async listHostels(auth: AuthPrincipal, query: z.infer<typeof hostelQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const hostels = await tx.hostel.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        },
        orderBy: { name: 'asc' },
      });
      const rooms = await tx.hostelRoom.findMany({ where: { schoolId: auth.schoolId } });
      return hostels.map((hostel) => {
        const hostelRooms = rooms.filter((room) => room.hostelId === hostel.id);
        return {
          ...hostel,
          rooms: hostelRooms,
          roomCount: hostelRooms.length,
          beds: hostelRooms.reduce((sum, room) => sum + room.capacity, 0),
          occupied: hostelRooms.reduce((sum, room) => sum + room.occupied, 0),
        };
      });
    });
  }

  async createHostel(
    auth: AuthPrincipal,
    input: z.infer<typeof createHostelSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const hostel = await tx.hostel.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          name: input.name,
          type: input.type,
          capacity: input.capacity,
          wardenId: input.wardenId ?? null,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'hostel.created',
        entity: 'Hostel',
        entityId: hostel.id,
        after: { name: hostel.name, type: hostel.type },
      });
      return hostel;
    });
  }

  async updateHostel(
    auth: AuthPrincipal,
    id: string,
    input: z.infer<typeof updateHostelSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const current = await tx.hostel.findFirst({ where: { id, schoolId: auth.schoolId } });
      if (!current) throw new NotFoundError('Hostel');
      const hostel = await tx.hostel.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
          ...(input.wardenId !== undefined ? { wardenId: input.wardenId ?? null } : {}),
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'hostel.updated',
        entity: 'Hostel',
        entityId: id,
        after: { name: hostel.name, capacity: hostel.capacity },
      });
      return hostel;
    });
  }

  async createRoom(
    auth: AuthPrincipal,
    input: z.infer<typeof createRoomSchema>,
    meta: AuditMeta,
  ) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const hostel = await tx.hostel.findFirst({
        where: { id: input.hostelId, schoolId: auth.schoolId },
      });
      if (!hostel) throw new NotFoundError('Hostel');
      const room = await tx.hostelRoom.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          hostelId: input.hostelId,
          roomNo: input.roomNo,
          capacity: input.capacity,
          rentMinor: input.rentMinor,
        },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'hostel.room_created',
        entity: 'HostelRoom',
        entityId: room.id,
        after: { hostelId: room.hostelId, roomNo: room.roomNo },
      });
      return room;
    });
  }

  async allocations(auth: AuthPrincipal, query: z.infer<typeof allocationQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const allocations = await tx.hostelAllocation.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(query.hostelId ? { hostelId: query.hostelId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: { startDate: 'desc' },
      });
      const [students, hostels, rooms] = await Promise.all([
        tx.student.findMany({
          where: { schoolId: auth.schoolId, id: { in: allocations.map((row) => row.studentId) } },
          select: { id: true, firstName: true, lastName: true, admissionNo: true },
        }),
        tx.hostel.findMany({ where: { schoolId: auth.schoolId } }),
        tx.hostelRoom.findMany({ where: { schoolId: auth.schoolId } }),
      ]);
      const studentMap = new Map(students.map((student) => [student.id, student]));
      const hostelMap = new Map(hostels.map((hostel) => [hostel.id, hostel]));
      const roomMap = new Map(rooms.map((room) => [room.id, room]));
      return allocations.map((allocation) => ({
        ...allocation,
        studentName: studentMap.get(allocation.studentId)
          ? `${studentMap.get(allocation.studentId)!.firstName} ${studentMap.get(allocation.studentId)!.lastName}`.trim()
          : 'Unknown student',
        admissionNo: studentMap.get(allocation.studentId)?.admissionNo ?? null,
        hostelName: hostelMap.get(allocation.hostelId)?.name ?? null,
        roomNo: roomMap.get(allocation.roomId)?.roomNo ?? null,
        rentMinor: roomMap.get(allocation.roomId)?.rentMinor ?? 0,
      }));
    });
  }

  async allocate(auth: AuthPrincipal, input: z.infer<typeof allocateSchema>, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [hostel, room, student] = await Promise.all([
        tx.hostel.findFirst({ where: { id: input.hostelId, schoolId: auth.schoolId } }),
        tx.hostelRoom.findFirst({
          where: { id: input.roomId, schoolId: auth.schoolId, hostelId: input.hostelId },
        }),
        tx.student.findFirst({
          where: { id: input.studentId, schoolId: auth.schoolId, deletedAt: null },
        }),
      ]);
      if (!hostel) throw new NotFoundError('Hostel');
      if (!room) throw new NotFoundError('Hostel room');
      if (!student) throw new NotFoundError('Student');
      if (room.occupied >= room.capacity) throw new ConflictError('This room is full');
      const existing = await tx.hostelAllocation.findFirst({
        where: { schoolId: auth.schoolId, studentId: input.studentId, status: 'ACTIVE' },
      });
      if (existing) throw new ConflictError('This student already has an active hostel allocation');
      const allocation = await tx.hostelAllocation.create({
        data: {
          id: uuidv7(),
          schoolId: auth.schoolId,
          hostelId: input.hostelId,
          roomId: input.roomId,
          studentId: input.studentId,
          startDate: new Date(`${input.startDate}T00:00:00.000Z`),
          status: 'ACTIVE',
        },
      });
      await tx.hostelRoom.update({
        where: { id: input.roomId },
        data: { occupied: { increment: 1 } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'hostel.allocated',
        entity: 'HostelAllocation',
        entityId: allocation.id,
        after: { hostelId: input.hostelId, roomId: input.roomId, studentId: input.studentId },
      });
      return allocation;
    });
  }

  async vacate(auth: AuthPrincipal, id: string, meta: AuditMeta) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const allocation = await tx.hostelAllocation.findFirst({
        where: { id, schoolId: auth.schoolId },
      });
      if (!allocation) throw new NotFoundError('Hostel allocation');
      if (allocation.status !== 'ACTIVE') throw new ConflictError('This allocation is already closed');
      const updated = await tx.hostelAllocation.update({
        where: { id },
        data: { status: 'VACATED', endDate: new Date() },
      });
      await tx.hostelRoom.update({
        where: { id: allocation.roomId },
        data: { occupied: { decrement: 1 } },
      });
      await this.audit.record(tx, auditCtx(auth, meta), {
        action: 'hostel.vacated',
        entity: 'HostelAllocation',
        entityId: id,
        before: { status: allocation.status },
        after: { status: 'VACATED' },
      });
      return updated;
    });
  }

  async summary(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const [hostels, rooms, allocations] = await Promise.all([
        tx.hostel.count({ where: { schoolId: auth.schoolId } }),
        tx.hostelRoom.findMany({ where: { schoolId: auth.schoolId } }),
        tx.hostelAllocation.count({ where: { schoolId: auth.schoolId, status: 'ACTIVE' } }),
      ]);
      return {
        hostels,
        rooms: rooms.length,
        beds: rooms.reduce((sum, room) => sum + room.capacity, 0),
        occupied: rooms.reduce((sum, room) => sum + room.occupied, 0),
        allocations,
      };
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
