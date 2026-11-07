import { describe, expect, it } from 'vitest';
import {
  CACHE_SCHEMA_VERSION,
  assembleCachePayload,
  mapCacheInvoice,
  mapCacheStudent,
} from '../src/sync/cache.mapper';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('desktop cache payload', () => {
  it('flattens each entity exactly as the SQLite cache expects', () => {
    expect(
      mapCacheStudent({
        id: 'student-1',
        admissionNo: 'S-1',
        firstName: 'Aarav',
        lastName: 'Sharma',
        classId: 'class-1',
        sectionId: 'section-1',
        rollNo: '4',
        status: 'ACTIVE',
        version: 3,
        updatedAt: new Date('2026-11-05T10:00:00.000Z'),
        deletedAt: null,
      }),
    ).toEqual({
      id: 'student-1',
      admissionNo: 'S-1',
      firstName: 'Aarav',
      lastName: 'Sharma',
      classId: 'class-1',
      sectionId: 'section-1',
      rollNo: '4',
      status: 'ACTIVE',
      version: 3,
      updatedAt: '2026-11-05T10:00:00.000Z',
      deletedAt: null,
    });

    expect(
      mapCacheInvoice({
        id: 'invoice-1',
        studentId: 'student-1',
        number: 'INV-1',
        issueDate: day('2026-11-01'),
        dueDate: day('2026-11-10'),
        currency: 'NPR',
        subtotalMinor: 100_000,
        discountMinor: 5_000,
        fineMinor: 0,
        totalMinor: 95_000,
        paidMinor: 100_000,
        status: 'PAID',
        updatedAt: new Date('2026-11-05T10:00:00.000Z'),
      }),
    ).toMatchObject({
      issueDate: '2026-11-01',
      dueDate: '2026-11-10',
      totalMinor: 95_000,
      paidMinor: 100_000,
      // Outstanding never goes negative when a payment is refunded/advance.
      outstandingMinor: 0,
      updatedAt: '2026-11-05T10:00:00.000Z',
    });
  });

  it('assembles the full snapshot with a resumable cursor and counts', () => {
    const payload = assembleCachePayload({
      since: new Date(0),
      nextSince: new Date('2026-11-06T09:00:00.000Z'),
      serverTime: new Date('2026-11-06T09:00:01.000Z'),
      classes: [{ id: 'class-1', name: 'Class 1', sequence: 1 }],
      sections: [
        { id: 'section-1', classId: 'class-1', name: 'A', capacity: 40, room: null },
      ],
      students: [
        {
          id: 'student-1',
          admissionNo: 'S-1',
          firstName: 'Aarav',
          lastName: 'Sharma',
          classId: 'class-1',
          sectionId: 'section-1',
          rollNo: null,
          status: 'ACTIVE',
          version: 1,
          updatedAt: new Date('2026-11-05T10:00:00.000Z'),
          deletedAt: new Date('2026-11-05T11:00:00.000Z'),
        },
      ],
      feeHeads: [
        {
          id: 'head-1',
          code: 'TUITION',
          name: 'Tuition',
          description: null,
          isRecurring: true,
          isActive: true,
        },
      ],
      feeStructures: [
        {
          id: 'structure-1',
          academicYearId: 'year-1',
          classId: 'class-1',
          feeHeadId: 'head-1',
          amountMinor: 50_000,
          installments: 2,
          dueDay: 10,
        },
      ],
      invoices: [],
    });

    expect(payload.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
    expect(payload.since).toBe('1970-01-01T00:00:00.000Z');
    expect(payload.nextSince).toBe('2026-11-06T09:00:00.000Z');
    expect(payload.students[0]?.deletedAt).toBe('2026-11-05T11:00:00.000Z');
    expect(payload.counts).toEqual({
      classes: 1,
      sections: 1,
      students: 1,
      feeHeads: 1,
      feeStructures: 1,
      invoices: 0,
    });
  });
});
