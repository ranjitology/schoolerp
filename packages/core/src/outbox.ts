/**
 * Offline outbox domain: deterministic ordering, idempotency and per-entity
 * conflict resolution. The same logic runs in the Tauri app and in tests; the
 * server never trusts client clocks, so every rule is designed to converge.
 */
import { ValidationError } from './errors';
import { uuidv7 } from './ids';
import { stableStringify } from './attendance';

export const OUTBOX_ENTITIES = [
  'ATTENDANCE',
  'FEE_PAYMENT',
  'NOTICE',
  'STUDENT',
  'HOMEWORK',
  'EXPENSE',
] as const;
export type OutboxEntity = (typeof OUTBOX_ENTITIES)[number];

export const OUTBOX_OPERATIONS = ['CREATE', 'UPDATE', 'DELETE', 'SUBMIT'] as const;
export type OutboxOperationType = (typeof OUTBOX_OPERATIONS)[number];

export type ConflictRule =
  | 'SERVER_APPEND_ONLY'
  | 'LAST_WRITE_WINS_CLIENT_TIME'
  | 'FIELD_MERGE_SERVER_WINS'
  | 'SERVER_AUTHORITATIVE';

export const CONFLICT_RULES: Record<OutboxEntity, ConflictRule> = {
  // Payments are immutable facts; duplicate detection is by client UUID.
  FEE_PAYMENT: 'SERVER_APPEND_ONLY',
  // Attendance is a full-session snapshot; the latest client edit wins, but the
  // server validates date/session/student membership on replay.
  ATTENDANCE: 'LAST_WRITE_WINS_CLIENT_TIME',
  // Student demographics merge per-field; the server record wins conflicts.
  STUDENT: 'FIELD_MERGE_SERVER_WINS',
  // Notices are drafts offline; publishing always happens online.
  NOTICE: 'SERVER_AUTHORITATIVE',
  HOMEWORK: 'FIELD_MERGE_SERVER_WINS',
  EXPENSE: 'SERVER_APPEND_ONLY',
};

/** Deterministic sync priority: money before attendance before drafts. */
export const OUTBOX_PRIORITY: Record<OutboxEntity, number> = {
  FEE_PAYMENT: 10,
  EXPENSE: 20,
  ATTENDANCE: 30,
  STUDENT: 40,
  HOMEWORK: 50,
  NOTICE: 60,
};

export interface OutboxOperation {
  id: string;
  entity: OutboxEntity;
  operation: OutboxOperationType;
  /** Entity id on the server, or client-generated UUIDv7 for new records. */
  entityId: string;
  /** Canonical JSON payload. */
  payload: Record<string, unknown>;
  /** Monotonic per-device sequence for stable ordering. */
  clientSequence: number;
  /** Client-observed ISO timestamp (informational; conflicts use server time). */
  clientTimestamp: string;
  idempotencyKey: string;
  attempts: number;
  lastError?: string;
  baseVersion?: number;
}

export interface CreateOutboxInput {
  entity: OutboxEntity;
  operation: OutboxOperationType;
  entityId?: string;
  payload: Record<string, unknown>;
  clientSequence: number;
  clientTimestamp?: string;
  baseVersion?: number;
}

export function createOutboxOperation(input: CreateOutboxInput): OutboxOperation {
  if (!OUTBOX_ENTITIES.includes(input.entity)) throw new ValidationError('Unknown entity');
  if (!OUTBOX_OPERATIONS.includes(input.operation)) {
    throw new ValidationError('Unknown operation');
  }
  if (!Number.isSafeInteger(input.clientSequence) || input.clientSequence < 1) {
    throw new ValidationError('Client sequence must be a positive integer');
  }
  const entityId = input.entityId ?? uuidv7();
  if (!entityId) throw new ValidationError('Entity id is required');

  return {
    id: uuidv7(),
    entity: input.entity,
    operation: input.operation,
    entityId,
    payload: input.payload,
    clientSequence: input.clientSequence,
    clientTimestamp: input.clientTimestamp ?? new Date().toISOString(),
    idempotencyKey: fnvEntityKey(input.entity, input.operation, entityId, input.payload),
    attempts: 0,
    baseVersion: input.baseVersion,
  };
}

export function fnvEntityKey(
  entity: OutboxEntity,
  operation: OutboxOperationType,
  entityId: string,
  payload: Record<string, unknown>,
): string {
  return stableStringify({ entity, operation, entityId, payload });
}

export function orderOutbox(operations: readonly OutboxOperation[]): OutboxOperation[] {
  return [...operations].sort(
    (a, b) =>
      OUTBOX_PRIORITY[a.entity] - OUTBOX_PRIORITY[b.entity] ||
      a.clientSequence - b.clientSequence ||
      a.id.localeCompare(b.id),
  );
}

export interface ConflictResolution<T extends Record<string, unknown>> {
  record: T;
  rule: ConflictRule;
  resolution: 'APPLIED' | 'SERVER_WINS' | 'CLIENT_WINS' | 'MERGED' | 'DUPLICATE';
  changedFields: string[];
}

/**
 * Resolves a local/server record pair. `serverUpdatedAt` must come from the
 * server clock; `localClientTimestamp` is untrusted and only used for LWW where
 * the server has already authenticated the device.
 */
export function resolveConflict<T extends Record<string, unknown>>(
  entity: OutboxEntity,
  local: { data: T; clientTimestamp: string; clientSequence: number },
  server: { data: T; updatedAt: string },
): ConflictResolution<T> {
  const rule = CONFLICT_RULES[entity];

  if (rule === 'SERVER_APPEND_ONLY') {
    return { record: server.data, rule, resolution: 'DUPLICATE', changedFields: [] };
  }

  if (rule === 'SERVER_AUTHORITATIVE') {
    return { record: server.data, rule, resolution: 'SERVER_WINS', changedFields: [] };
  }

  if (rule === 'LAST_WRITE_WINS_CLIENT_TIME') {
    const clientWins =
      local.clientTimestamp > server.updatedAt ||
      (local.clientTimestamp === server.updatedAt && local.clientSequence > 0);
    return {
      record: clientWins ? local.data : server.data,
      rule,
      resolution: clientWins ? 'CLIENT_WINS' : 'SERVER_WINS',
      changedFields: clientWins ? differingFields(server.data, local.data) : [],
    };
  }

  // FIELD_MERGE_SERVER_WINS: local values fill fields that the server has as
  // null/undefined; any server value is authoritative.
  const merged = { ...local.data } as T;
  const changedFields: string[] = [];
  for (const key of Object.keys(server.data)) {
    const serverValue = server.data[key];
    if (serverValue !== null && serverValue !== undefined) {
      if ((merged as Record<string, unknown>)[key] !== serverValue) changedFields.push(key);
      (merged as Record<string, unknown>)[key] = serverValue;
    }
  }
  return { record: merged, rule, resolution: 'MERGED', changedFields };
}

function differingFields<T extends Record<string, unknown>>(a: T, b: T): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (stableStringify(a[key]) !== stableStringify(b[key])) changed.push(key);
  }
  return changed;
}

export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  maxAttempts: 10,
};

/** Exponential backoff with full jitter. Injectable randomness for tests. */
export function retryDelayMs(
  attempts: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  if (attempts <= 0) return 0;
  if (attempts >= policy.maxAttempts) return -1;
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempts - 1));
  return Math.floor(random() * ceiling);
}

/** A reserved block of receipt numbers for offline issuance. */
export interface ReceiptBlock {
  deviceId: string;
  prefix: string;
  start: number;
  end: number;
  next: number;
}

export function reserveReceiptBlock(
  deviceId: string,
  prefix: string,
  nextServerValue: number,
  size: number,
): { block: ReceiptBlock; nextServerValue: number } {
  if (!Number.isSafeInteger(nextServerValue) || nextServerValue < 1) {
    throw new ValidationError('Invalid starting receipt number');
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > 10_000) {
    throw new ValidationError('Block size must be between 1 and 10,000');
  }
  const start = nextServerValue;
  const end = start + size - 1;
  return {
    block: { deviceId, prefix, start, end, next: start },
    nextServerValue: end + 1,
  };
}

export interface ConsumedReceipt {
  receiptNumber: string;
  block: ReceiptBlock;
}

export function consumeReceiptNumber(
  block: ReceiptBlock,
  width = 6,
  fiscalYearLabel = '',
): ConsumedReceipt | null {
  if (block.next > block.end) return null;
  const period = fiscalYearLabel ? `${fiscalYearLabel.replace('/', '-')}-` : '';
  const receipt = `${block.prefix}-${period}${String(block.next).padStart(width, '0')}`;
  return {
    receiptNumber: receipt,
    block: { ...block, next: block.next + 1 },
  };
}

export function remainingReceipts(block: ReceiptBlock): number {
  return Math.max(0, block.end - block.next + 1);
}
