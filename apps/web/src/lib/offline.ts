/**
 * Desktop offline cache bridge and pure cache projections.
 *
 * PostgreSQL remains the source of truth. On the desktop, `/sync/pull` mirrors
 * the tenant into an encrypted SQLite database (see
 * `apps/desktop/src-tauri/src/lib.rs`). The helpers here:
 *
 * 1. wrap a network read with a cache fallback when the shell is offline,
 * 2. project cached rows into the same DTOs the web pages already render,
 * 3. queue offline attendance writes in the existing outbox and replay them
 *    through `POST /sync/batches` once the connection returns.
 *
 * The projections are deliberately pure so they can be tested without a
 * browser or a Tauri runtime.
 */
import { api, ApiError, queryString } from './api';
import { invokeDesktop, isDesktop } from './desktop';
import type {
  AttendanceSession,
  Defaulter,
  FeeSummary,
  InvoiceRow,
  Paged,
  SchoolClass,
  StudentRow,
} from './types';

export interface CacheStatus {
  schemaVersion: number;
  serverTime: string | null;
  lastSyncedAt: string | null;
  since: string | null;
  classes: number;
  sections: number;
  students: number;
  feeHeads: number;
  feeStructures: number;
  invoices: number;
  attendanceDrafts: number;
}

export interface CachePullPayload {
  schemaVersion: number;
  serverTime: string;
  since: string;
  nextSince: string;
  counts: {
    classes: number;
    sections: number;
    students: number;
    feeHeads: number;
    feeStructures: number;
    invoices: number;
  };
  classes: unknown[];
  sections: unknown[];
  students: unknown[];
  feeHeads: unknown[];
  feeStructures: unknown[];
  invoices: unknown[];
}

export interface CachedSection {
  id: string;
  classId: string;
  name: string;
  capacity?: number;
  room?: string | null;
}

export interface CachedClass {
  id: string;
  name: string;
  sequence: number;
  sections?: CachedSection[];
}

export interface CachedStudent {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  classId: string;
  sectionId: string;
  rollNo: string | null;
  status: string;
  version?: number;
  updatedAt?: string;
  deletedAt?: string | null;
  className?: string;
  sectionName?: string;
}

export interface CachedInvoice {
  id: string;
  studentId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  fineMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  updatedAt: string;
  student?: {
    id: string;
    admissionNo?: string;
    name: string;
    className?: string;
    sectionName?: string;
  };
}

export interface CachedFeeHead {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isRecurring: boolean;
  isActive: boolean;
}

export interface CachedFeeStructure {
  id: string;
  academicYearId: string;
  classId: string;
  feeHeadId: string;
  amountMinor: number;
  installments: number;
  dueDay: number;
}

export interface CachedAttendanceRecord {
  studentId: string;
  status: string;
  remark?: string | null;
}

export interface CachedAttendanceDraft {
  id?: string;
  classId: string;
  sectionId: string;
  date: string;
  period: number;
  records: CachedAttendanceRecord[];
  updatedAt?: string;
}

export interface CachedStudentQuery {
  classId?: string;
  sectionId?: string;
  status?: string;
  search?: string;
  limit?: number;
}

export interface CachedInvoiceQuery {
  status?: string;
  studentId?: string;
  search?: string;
  limit?: number;
}

export interface DesktopDeviceInfo {
  device_id?: string;
  deviceId?: string;
  platform: string;
  schema_version?: number;
  schemaVersion?: number;
  encrypted: boolean;
}

export interface OutboxRecord {
  id: string;
  entity: string;
  operation: string;
  entityId: string;
  payload: Record<string, unknown>;
  clientSequence: number;
  clientTimestamp: string;
  idempotencyKey: string;
  attempts: number;
  status: string;
}

export interface ReplaySummary {
  pushed: number;
  failed: number;
  conflicts: number;
  pending: number;
}

export interface SyncSummary {
  cache: CacheStatus | null;
  replay: ReplaySummary | null;
}

const CACHE_FALLBACK_EVENT = 'schoolerp:cache-fallback';
const NETWORK_OK_EVENT = 'schoolerp:network-ok';

/** Network-shaped failures only: never hide a 4xx validation/business error. */
export function isOfflineError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 0 || error.status >= 502;
  return error instanceof TypeError;
}

export function shouldUseOfflineCache(
  error: unknown,
  desktop: boolean = isDesktop(),
): boolean {
  return desktop && isOfflineError(error);
}

function emit(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(name));
}

/**
 * Runs a network query and, only when the desktop shell is active and the
 * failure looks like connectivity, projects the cached rows instead. A
 * successful network read tells the shell that cached data is no longer in
 * use.
 */
export async function withOfflineFallback<T>(
  remote: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    const result = await remote();
    emit(NETWORK_OK_EVENT);
    return result;
  } catch (error) {
    if (!shouldUseOfflineCache(error)) throw error;
    emit(CACHE_FALLBACK_EVENT);
    return fallback();
  }
}

// ---------------------------------------------------------------- native reads

export async function getCacheStatus(): Promise<CacheStatus | null> {
  if (!isDesktop()) return null;
  return invokeDesktop<CacheStatus>('cache_status');
}

export async function getCachedClasses(): Promise<SchoolClass[]> {
  if (!isDesktop()) return [];
  const rows = await invokeDesktop<CachedClass[]>('cache_classes');
  return rows.map((klass) => ({
    id: klass.id,
    name: klass.name,
    sequence: klass.sequence,
    sections: (klass.sections ?? []).map((section) => ({
      id: section.id,
      name: section.name,
    })),
  }));
}

export async function getCachedStudents(
  query: CachedStudentQuery = {},
): Promise<CachedStudent[]> {
  if (!isDesktop()) return [];
  return invokeDesktop<CachedStudent[]>('cache_students', { query });
}

export async function getCachedInvoices(
  query: CachedInvoiceQuery = {},
): Promise<CachedInvoice[]> {
  if (!isDesktop()) return [];
  return invokeDesktop<CachedInvoice[]>('cache_invoices', { query });
}

export async function getCachedFeeHeads(): Promise<CachedFeeHead[]> {
  if (!isDesktop()) return [];
  return invokeDesktop<CachedFeeHead[]>('cache_fee_heads');
}

export async function getCachedFeeStructures(
  classId?: string,
): Promise<CachedFeeStructure[]> {
  if (!isDesktop()) return [];
  return invokeDesktop<CachedFeeStructure[]>('cache_fee_structures', {
    query: classId ? { classId } : {},
  });
}

export async function getAttendanceDraft(input: {
  classId: string;
  sectionId: string;
  date: string;
  period: number;
}): Promise<CachedAttendanceDraft | null> {
  if (!isDesktop()) return null;
  return invokeDesktop<CachedAttendanceDraft | null>('attendance_draft_get', {
    query: input,
  });
}

export async function clearAttendanceDraft(input: {
  classId: string;
  sectionId: string;
  date: string;
  period: number;
}): Promise<void> {
  if (!isDesktop()) return;
  await invokeDesktop('attendance_draft_clear', { query: input });
}

export async function clearDesktopCache(): Promise<void> {
  if (!isDesktop()) return;
  await invokeDesktop('cache_clear');
}

// ------------------------------------------------------------------- syncing

/**
 * Pulls the server cache payload and applies it to SQLite. The cursor comes
 * from the previous pull so students/invoices stay incremental.
 */
export async function syncDesktopCache(): Promise<CacheStatus | null> {
  if (!isDesktop()) return null;
  const status = await getCacheStatus();
  const payload = await api.get<CachePullPayload>(
    `/sync/pull${queryString({ since: status?.since ?? undefined })}`,
  );
  return invokeDesktop<CacheStatus>('cache_apply_pull', { payload });
}

/**
 * Replays queued attendance writes through the existing `/sync/batches`
 * endpoint. Network failures leave operations PENDING so the next online
 * window can retry; validation failures are counted and eventually marked
 * FAILED by the native retry policy.
 */
export async function replayAttendanceOutbox(): Promise<ReplaySummary> {
  const empty: ReplaySummary = { pushed: 0, failed: 0, conflicts: 0, pending: 0 };
  if (!isDesktop()) return empty;

  const operations = await invokeDesktop<OutboxRecord[]>('outbox_pending', { limit: 50 });
  if (operations.length === 0) return empty;

  const device = await invokeDesktop<DesktopDeviceInfo>('device_info');
  const deviceId = device.device_id ?? device.deviceId ?? 'desktop';
  let pushed = 0;
  let failed = 0;
  let conflicts = 0;

  for (const operation of operations) {
    if (operation.entity !== 'ATTENDANCE') continue;
    try {
      const result = await api.post<{ batch?: { conflicts?: number } }>('/sync/batches', {
        deviceId,
        operation: 'ATTENDANCE_MARK',
        idempotencyKey: operation.idempotencyKey,
        payload: operation.payload,
      });
      await invokeDesktop('outbox_mark_synced', { id: operation.id });
      pushed += 1;
      conflicts += result.batch?.conflicts ?? 0;

      const payload = operation.payload as Partial<CachedAttendanceDraft>;
      if (payload.classId && payload.sectionId && payload.date) {
        await clearAttendanceDraft({
          classId: payload.classId,
          sectionId: payload.sectionId,
          date: payload.date,
          period: payload.period ?? 0,
        });
      }
    } catch (error) {
      if (isOfflineError(error)) break;
      failed += 1;
      await invokeDesktop('outbox_mark_failed', {
        id: operation.id,
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    }
  }

  return {
    pushed,
    failed,
    conflicts,
    pending: operations.length - pushed - failed,
  };
}

export async function syncDesktop(): Promise<SyncSummary> {
  if (!isDesktop()) return { cache: null, replay: null };
  const replay = await replayAttendanceOutbox();
  const cache = await syncDesktopCache();
  return { cache, replay };
}

/**
 * Saves an offline register twice: a readable draft for the next visit and a
 * queued outbox operation for replay. The draft survives even if enqueueing is
 * interrupted.
 */
export async function saveOfflineAttendance(input: {
  classId: string;
  sectionId: string;
  date: string;
  period: number;
  records: CachedAttendanceRecord[];
}): Promise<void> {
  if (!isDesktop()) {
    throw new Error('Offline attendance is only available in the desktop app.');
  }
  const updatedAt = new Date().toISOString();
  const records = input.records.map((record) => ({
    ...record,
    clientUpdatedAt: updatedAt,
  }));

  await invokeDesktop('attendance_draft_save', {
    input: { ...input, records, updatedAt },
  });

  await invokeDesktop('outbox_enqueue', {
    input: {
      id: globalThis.crypto.randomUUID(),
      entity: 'ATTENDANCE',
      operation: 'SUBMIT',
      entityId: `${input.classId}:${input.sectionId}:${input.date}:${input.period}`,
      payload: { ...input, records },
      clientSequence: Date.now(),
      clientTimestamp: updatedAt,
      idempotencyKey: `attendance:${globalThis.crypto.randomUUID()}`,
    },
  });
}

// --------------------------------------------------------------- projections

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

export function toStudentRow(student: CachedStudent): StudentRow {
  return {
    id: student.id,
    admissionNo: student.admissionNo,
    firstName: student.firstName,
    lastName: student.lastName,
    fullName: `${student.firstName} ${student.lastName}`.trim(),
    gender: '',
    classId: student.classId,
    sectionId: student.sectionId,
    rollNo: student.rollNo,
    status: student.status,
    version: student.version,
    className: student.className,
    sectionName: student.sectionName,
    updatedAt: student.updatedAt,
  };
}

export function toInvoiceRow(invoice: CachedInvoice): InvoiceRow {
  return {
    id: invoice.id,
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    fineMinor: invoice.fineMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    outstandingMinor: invoice.outstandingMinor,
    status: invoice.status,
    student: invoice.student
      ? { ...invoice.student, admissionNo: invoice.student.admissionNo ?? '' }
      : undefined,
    createdAt: invoice.updatedAt,
  };
}

export interface CachedStudentPageQuery extends CachedStudentQuery {
  page?: number;
  pageSize?: number;
}

export function paginateCachedStudents(
  students: CachedStudent[],
  query: CachedStudentPageQuery = {},
): Paged<StudentRow> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? 25);
  const term = lower(query.search?.trim());
  const filtered = students
    .filter((student) => (query.classId ? student.classId === query.classId : true))
    .filter((student) => (query.sectionId ? student.sectionId === query.sectionId : true))
    .filter((student) => (query.status ? student.status === query.status : true))
    .filter((student) =>
      term
        ? [student.firstName, student.lastName, student.admissionNo].some((value) =>
            lower(value).includes(term),
          )
        : true,
    )
    .sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(toStudentRow),
    page,
    pageSize,
    total: filtered.length,
  };
}

export function cachedRoster(
  students: CachedStudent[],
  query: CachedStudentQuery = {},
): Paged<StudentRow> {
  return paginateCachedStudents(students, {
    ...query,
    page: 1,
    pageSize: query.limit ?? 500,
  });
}

export interface CachedInvoicePageQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
}

export function paginateCachedInvoices(
  invoices: CachedInvoice[],
  query: CachedInvoicePageQuery = {},
): Paged<InvoiceRow> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? 25);
  const term = lower(query.search?.trim());
  const filtered = invoices
    .filter((invoice) => (query.status ? invoice.status === query.status : true))
    .filter((invoice) =>
      term
        ? [
            invoice.number,
            invoice.student?.name,
            invoice.student?.admissionNo,
          ].some((value) => lower(value).includes(term))
        : true,
    )
    .sort(
      (a, b) =>
        b.issueDate.localeCompare(a.issueDate) || b.updatedAt.localeCompare(a.updatedAt),
    );

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(toInvoiceRow),
    page,
    pageSize,
    total: filtered.length,
  };
}

function outstanding(invoice: CachedInvoice): number {
  return Math.max(0, invoice.outstandingMinor);
}

function dayDiff(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/**
 * Cache-only fee summary. Payment-level detail (method and receipt date) is not
 * cached, so period collection is derived from the invoice issue date and the
 * UI labels it as a cached/approximate view.
 */
export function cachedFeeSummary(
  invoices: CachedInvoice[],
  from: string,
  to: string,
  asOf: string = to,
): FeeSummary {
  const live = invoices.filter(
    (invoice) => invoice.status !== 'VOID' && invoice.status !== 'DRAFT',
  );
  const totalBilledMinor = live.reduce((sum, invoice) => sum + invoice.totalMinor, 0);
  const totalPaidMinor = live.reduce((sum, invoice) => sum + invoice.paidMinor, 0);
  const outstandingMinor = live.reduce((sum, invoice) => sum + outstanding(invoice), 0);
  const advanceMinor = live.reduce(
    (sum, invoice) => sum + Math.max(0, invoice.paidMinor - invoice.totalMinor),
    0,
  );
  const overdueInvoices = live.filter(
    (invoice) => outstanding(invoice) > 0 && invoice.dueDate < asOf,
  );
  const periodInvoices = live.filter(
    (invoice) => invoice.issueDate >= from && invoice.issueDate <= to,
  );
  const collectedMinor = periodInvoices.reduce(
    (sum, invoice) => sum + invoice.paidMinor,
    0,
  );

  return {
    from,
    to,
    ledger: {
      totalBilledMinor,
      totalPaidMinor,
      outstandingMinor,
      advanceMinor,
      netDueMinor: Math.max(0, outstandingMinor - advanceMinor),
      collectionPercent:
        totalBilledMinor > 0 ? Math.min(100, (totalPaidMinor / totalBilledMinor) * 100) : 0,
    },
    period: {
      collectedMinor,
      paymentCount: periodInvoices.filter((invoice) => invoice.paidMinor > 0).length,
      expensesMinor: 0,
      expenseCount: 0,
      netMinor: collectedMinor,
    },
    byMethod: [],
    overdue: {
      count: overdueInvoices.length,
      amountMinor: overdueInvoices.reduce((sum, invoice) => sum + outstanding(invoice), 0),
    },
  };
}

/**
 * Groups overdue invoices by student. Cached invoices already carry the
 * denormalised student/class names added by the native query.
 */
export function cachedDefaulters(
  invoices: CachedInvoice[],
  asOf: string,
  minOverdueDays = 1,
): Defaulter[] {
  const groups = new Map<string, Defaulter>();
  for (const invoice of invoices) {
    if (invoice.status === 'VOID' || invoice.status === 'DRAFT') continue;
    const due = outstanding(invoice);
    if (due <= 0) continue;
    const days = dayDiff(invoice.dueDate, asOf);
    if (days < minOverdueDays) continue;

    const current = groups.get(invoice.studentId);
    if (!current) {
      groups.set(invoice.studentId, {
        studentId: invoice.studentId,
        admissionNo: invoice.student?.admissionNo ?? '',
        name: invoice.student?.name ?? 'Student',
        className: invoice.student?.className ?? '',
        sectionName: invoice.student?.sectionName ?? '',
        phone: null,
        guardianName: null,
        guardianPhone: null,
        outstandingMinor: due,
        invoiceCount: 1,
        oldestDueDate: invoice.dueDate,
        maxOverdueDays: days,
      });
      continue;
    }
    current.outstandingMinor += due;
    current.invoiceCount += 1;
    if (invoice.dueDate < current.oldestDueDate) current.oldestDueDate = invoice.dueDate;
    if (days > current.maxOverdueDays) current.maxOverdueDays = days;
  }

  return [...groups.values()].sort(
    (a, b) => b.outstandingMinor - a.outstandingMinor || a.name.localeCompare(b.name),
  );
}

export function paginateCachedDefaulters(
  invoices: CachedInvoice[],
  asOf: string,
  minOverdueDays: number,
  page = 1,
  pageSize = 25,
): Paged<Defaulter> {
  const rows = cachedDefaulters(invoices, asOf, minOverdueDays);
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, pageSize);
  const start = (safePage - 1) * safeSize;
  return {
    items: rows.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: rows.length,
  };
}

export interface CachedStudentHit {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  class: { name: string };
  section: { name: string };
}

export function searchCachedStudents(
  students: CachedStudent[],
  term: string,
  limit = 8,
): CachedStudentHit[] {
  const needle = lower(term.trim());
  if (!needle) return [];
  return students
    .filter((student) =>
      [student.firstName, student.lastName, student.admissionNo].some((value) =>
        lower(value).includes(needle),
      ),
    )
    .slice(0, Math.max(1, limit))
    .map((student) => ({
      id: student.id,
      admissionNo: student.admissionNo,
      firstName: student.firstName,
      lastName: student.lastName,
      class: { name: student.className ?? '' },
      section: { name: student.sectionName ?? '' },
    }));
}

export function draftToSession(draft: CachedAttendanceDraft | null): AttendanceSession {
  return {
    session: null,
    records: (draft?.records ?? []).map((record) => ({
      studentId: record.studentId,
      status: record.status,
      remark: record.remark ?? null,
    })),
  };
}
