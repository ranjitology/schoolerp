/**
 * Maps tenant rows onto the desktop offline-cache contract.
 *
 * The desktop stores one JSON document per row, so the payload is deliberately
 * flat and stable: every field below is part of the local SQLite schema that
 * `apps/desktop/src-tauri/src/lib.rs` writes. Keep this file and the Rust
 * `cache_apply_pull` command in sync.
 */

export const CACHE_SCHEMA_VERSION = 2;

export interface CacheClassRecord {
  id: string;
  name: string;
  sequence: number;
}

export interface CacheSectionRecord {
  id: string;
  classId: string;
  name: string;
  capacity: number;
  room: string | null;
}

export interface CacheStudentRecord {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  classId: string;
  sectionId: string;
  rollNo: string | null;
  status: string;
  version: number;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CacheFeeHeadRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isRecurring: boolean;
  isActive: boolean;
}

export interface CacheFeeStructureRecord {
  id: string;
  academicYearId: string;
  classId: string;
  feeHeadId: string;
  amountMinor: number;
  installments: number;
  dueDay: number;
}

export interface CacheInvoiceRecord {
  id: string;
  studentId: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  fineMinor: number;
  totalMinor: number;
  paidMinor: number;
  status: string;
  updatedAt: Date;
}

export interface CachePayloadSource {
  since: Date;
  nextSince: Date;
  serverTime: Date;
  classes: CacheClassRecord[];
  sections: CacheSectionRecord[];
  students: CacheStudentRecord[];
  feeHeads: CacheFeeHeadRecord[];
  feeStructures: CacheFeeStructureRecord[];
  invoices: CacheInvoiceRecord[];
}

export interface CacheCounts {
  classes: number;
  sections: number;
  students: number;
  feeHeads: number;
  feeStructures: number;
  invoices: number;
}

export function mapCacheClass(klass: CacheClassRecord) {
  return { id: klass.id, name: klass.name, sequence: klass.sequence };
}

export function mapCacheSection(section: CacheSectionRecord) {
  return {
    id: section.id,
    classId: section.classId,
    name: section.name,
    capacity: section.capacity,
    room: section.room,
  };
}

export function mapCacheStudent(student: CacheStudentRecord) {
  return {
    id: student.id,
    admissionNo: student.admissionNo,
    firstName: student.firstName,
    lastName: student.lastName,
    classId: student.classId,
    sectionId: student.sectionId,
    rollNo: student.rollNo,
    status: student.status,
    version: student.version,
    updatedAt: student.updatedAt.toISOString(),
    deletedAt: student.deletedAt ? student.deletedAt.toISOString() : null,
  };
}

export function mapCacheFeeHead(head: CacheFeeHeadRecord) {
  return {
    id: head.id,
    code: head.code,
    name: head.name,
    description: head.description,
    isRecurring: head.isRecurring,
    isActive: head.isActive,
  };
}

export function mapCacheFeeStructure(structure: CacheFeeStructureRecord) {
  return {
    id: structure.id,
    academicYearId: structure.academicYearId,
    classId: structure.classId,
    feeHeadId: structure.feeHeadId,
    amountMinor: structure.amountMinor,
    installments: structure.installments,
    dueDay: structure.dueDay,
  };
}

export function mapCacheInvoice(invoice: CacheInvoiceRecord) {
  return {
    id: invoice.id,
    studentId: invoice.studentId,
    number: invoice.number,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    fineMinor: invoice.fineMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    outstandingMinor: Math.max(0, invoice.totalMinor - invoice.paidMinor),
    status: invoice.status,
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

/**
 * Reference data (classes, sections, fee heads and structures) has no
 * `updatedAt`, so it is re-sent in full on every pull. Students and invoices
 * are deltas ordered by `updatedAt`; the desktop upserts by primary key.
 */
export function assembleCachePayload(source: CachePayloadSource) {
  const classes = source.classes.map(mapCacheClass);
  const sections = source.sections.map(mapCacheSection);
  const students = source.students.map(mapCacheStudent);
  const feeHeads = source.feeHeads.map(mapCacheFeeHead);
  const feeStructures = source.feeStructures.map(mapCacheFeeStructure);
  const invoices = source.invoices.map(mapCacheInvoice);

  const counts: CacheCounts = {
    classes: classes.length,
    sections: sections.length,
    students: students.length,
    feeHeads: feeHeads.length,
    feeStructures: feeStructures.length,
    invoices: invoices.length,
  };

  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    serverTime: source.serverTime.toISOString(),
    since: source.since.toISOString(),
    nextSince: source.nextSince.toISOString(),
    counts,
    classes,
    sections,
    students,
    feeHeads,
    feeStructures,
    invoices,
  };
}

export type CachePullPayload = ReturnType<typeof assembleCachePayload>;
