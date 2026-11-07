import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import {
  cachedDefaulters,
  cachedFeeSummary,
  draftToSession,
  isOfflineError,
  paginateCachedDefaulters,
  paginateCachedInvoices,
  paginateCachedStudents,
  searchCachedStudents,
  shouldUseOfflineCache,
  type CachedInvoice,
  type CachedStudent,
} from '../src/lib/offline';

const students: CachedStudent[] = [
  {
    id: 'student-1',
    admissionNo: 'S-001',
    firstName: 'Aarav',
    lastName: 'Sharma',
    classId: 'class-1',
    sectionId: 'section-a',
    rollNo: '1',
    status: 'ACTIVE',
    className: 'Class 1',
    sectionName: 'A',
  },
  {
    id: 'student-2',
    admissionNo: 'S-002',
    firstName: 'Bina',
    lastName: 'Thapa',
    classId: 'class-1',
    sectionId: 'section-b',
    rollNo: '2',
    status: 'ACTIVE',
    className: 'Class 1',
    sectionName: 'B',
  },
  {
    id: 'student-3',
    admissionNo: 'S-003',
    firstName: 'Chirag',
    lastName: 'Rai',
    classId: 'class-2',
    sectionId: 'section-a',
    rollNo: null,
    status: 'WITHDRAWN',
    className: 'Class 2',
    sectionName: 'A',
  },
];

function invoice(overrides: Partial<CachedInvoice>): CachedInvoice {
  return {
    id: 'invoice-1',
    studentId: 'student-1',
    number: 'INV-001',
    issueDate: '2026-10-20',
    dueDate: '2026-11-01',
    currency: 'NPR',
    subtotalMinor: 100_000,
    discountMinor: 0,
    fineMinor: 0,
    totalMinor: 100_000,
    paidMinor: 40_000,
    outstandingMinor: 60_000,
    status: 'ISSUED',
    updatedAt: '2026-11-01T08:00:00.000Z',
    student: {
      id: 'student-1',
      admissionNo: 'S-001',
      name: 'Aarav Sharma',
      className: 'Class 1',
      sectionName: 'A',
    },
    ...overrides,
  };
}

describe('offline detection', () => {
  it('treats browser network failures as offline but not business errors', () => {
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineError(new ApiError(503, 'UNAVAILABLE', 'down'))).toBe(true);
    expect(isOfflineError(new ApiError(400, 'VALIDATION', 'bad input'))).toBe(false);
    expect(isOfflineError(new Error('boom'))).toBe(false);
  });

  it('only falls back when the desktop shell is available', () => {
    const error = new TypeError('Failed to fetch');
    expect(shouldUseOfflineCache(error, true)).toBe(true);
    expect(shouldUseOfflineCache(error, false)).toBe(false);
    expect(shouldUseOfflineCache(new ApiError(403, 'FORBIDDEN', 'no'), true)).toBe(false);
  });
});

describe('cached student projections', () => {
  it('filters, sorts and pages without a server', () => {
    const result = paginateCachedStudents(students, {
      page: 1,
      pageSize: 1,
      classId: 'class-1',
      status: 'ACTIVE',
    });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'student-1',
      fullName: 'Aarav Sharma',
      gender: '',
      className: 'Class 1',
    });
    expect(result.pageSize).toBe(1);
  });

  it('searches name and admission number and builds fee search hits', () => {
    expect(paginateCachedStudents(students, { search: 's-002' }).items.map((row) => row.id)).toEqual([
      'student-2',
    ]);
    expect(searchCachedStudents(students, 'aar', 5)).toEqual([
      {
        id: 'student-1',
        admissionNo: 'S-001',
        firstName: 'Aarav',
        lastName: 'Sharma',
        class: { name: 'Class 1' },
        section: { name: 'A' },
      },
    ]);
  });
});

describe('cached fee projections', () => {
  const invoices = [
    invoice({}),
    invoice({
      id: 'invoice-2',
      number: 'INV-002',
      issueDate: '2026-11-02',
      dueDate: '2026-11-20',
      totalMinor: 50_000,
      paidMinor: 50_000,
      outstandingMinor: 0,
      status: 'PAID',
    }),
    invoice({
      id: 'invoice-3',
      number: 'INV-003',
      issueDate: '2026-11-03',
      dueDate: '2026-11-25',
      totalMinor: 20_000,
      paidMinor: 30_000,
      outstandingMinor: 0,
    }),
    invoice({
      id: 'invoice-4',
      number: 'INV-VOID',
      totalMinor: 100_000,
      paidMinor: 0,
      outstandingMinor: 100_000,
      status: 'VOID',
    }),
  ];

  it('rewrites invoice totals for the offline list', () => {
    const page = paginateCachedInvoices(invoices, { page: 1, pageSize: 2, search: 'aarav' });
    expect(page.total).toBe(4);
    expect(page.items.map((row) => row.id)).toEqual(['invoice-3', 'invoice-2']);
    expect(page.items[0]?.student?.name).toBe('Aarav Sharma');
  });

  it('computes the same ledger fields the online summary shows', () => {
    const summary = cachedFeeSummary(invoices, '2026-11-01', '2026-11-07', '2026-11-07');
    expect(summary.ledger).toMatchObject({
      totalBilledMinor: 170_000,
      totalPaidMinor: 120_000,
      outstandingMinor: 60_000,
      advanceMinor: 10_000,
      netDueMinor: 50_000,
    });
    expect(summary.ledger.collectionPercent).toBeCloseTo((120_000 / 170_000) * 100, 5);
    expect(summary.period).toMatchObject({
      collectedMinor: 80_000,
      paymentCount: 2,
      expensesMinor: 0,
      netMinor: 80_000,
    });
    expect(summary.overdue).toEqual({ count: 1, amountMinor: 60_000 });
    expect(summary.byMethod).toEqual([]);
  });

  it('groups overdue invoices per student and pages the defaulters', () => {
    const rows = cachedDefaulters(
      [
        ...invoices,
        invoice({
          id: 'invoice-5',
          number: 'INV-005',
          dueDate: '2026-10-30',
          totalMinor: 5_000,
          paidMinor: 0,
          outstandingMinor: 5_000,
        }),
      ],
      '2026-11-07',
      1,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentId: 'student-1',
      outstandingMinor: 65_000,
      invoiceCount: 2,
      oldestDueDate: '2026-10-30',
      maxOverdueDays: 8,
      name: 'Aarav Sharma',
    });

    const page = paginateCachedDefaulters(invoices, '2026-11-07', 1, 1, 25);
    expect(page.total).toBe(1);
    expect(page.items[0]?.studentId).toBe('student-1');
  });
});

describe('cached attendance drafts', () => {
  it('feeds the register from a queued draft with no server session', () => {
    const session = draftToSession({
      classId: 'class-1',
      sectionId: 'section-a',
      date: '2026-11-07',
      period: 0,
      records: [
        { studentId: 'student-1', status: 'PRESENT' },
        { studentId: 'student-2', status: 'ABSENT', remark: 'Sick' },
      ],
    });

    expect(session.session).toBeNull();
    expect(session.records).toEqual([
      { studentId: 'student-1', status: 'PRESENT', remark: null },
      { studentId: 'student-2', status: 'ABSENT', remark: 'Sick' },
    ]);
    expect(draftToSession(null).records).toEqual([]);
  });
});
