import { describe, expect, it } from 'vitest';
import {
  consumeReceiptNumber,
  createOutboxOperation,
  orderOutbox,
  remainingReceipts,
  reserveReceiptBlock,
  resolveConflict,
  retryDelayMs,
} from '../src/outbox';

describe('offline outbox', () => {
  it('creates operations with deterministic idempotency keys', () => {
    const base = {
      entity: 'ATTENDANCE' as const,
      operation: 'SUBMIT' as const,
      entityId: '0193a000-0000-7000-8000-000000000001',
      payload: { b: 2, a: 1 },
      clientSequence: 1,
      clientTimestamp: '2026-01-01T00:00:00.000Z',
    };
    const first = createOutboxOperation(base);
    const second = createOutboxOperation({ ...base, payload: { a: 1, b: 2 } });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.id).not.toBe(second.id);
    expect(() => createOutboxOperation({ ...base, clientSequence: 0 })).toThrow();
  });

  it('orders money before attendance before drafts, then by device sequence', () => {
    const make = (entity: 'FEE_PAYMENT' | 'ATTENDANCE' | 'NOTICE', seq: number) =>
      createOutboxOperation({ entity, operation: 'CREATE', payload: {}, clientSequence: seq });
    const ordered = orderOutbox([
      make('NOTICE', 1),
      make('ATTENDANCE', 3),
      make('FEE_PAYMENT', 9),
      make('ATTENDANCE', 2),
    ]);
    expect(ordered.map((o) => `${o.entity}:${o.clientSequence}`)).toEqual([
      'FEE_PAYMENT:9',
      'ATTENDANCE:2',
      'ATTENDANCE:3',
      'NOTICE:1',
    ]);
  });

  it('treats payments as append-only duplicates', () => {
    const resolution = resolveConflict(
      'FEE_PAYMENT',
      { data: { amount: 100 }, clientTimestamp: '2026-01-01T10:00:00Z', clientSequence: 1 },
      { data: { amount: 100 }, updatedAt: '2026-01-01T09:00:00Z' },
    );
    expect(resolution.resolution).toBe('DUPLICATE');
    expect(resolution.record.amount).toBe(100);
  });

  it('uses client time for attendance LWW and server time for notices', () => {
    expect(
      resolveConflict(
        'ATTENDANCE',
        { data: { status: 'PRESENT' }, clientTimestamp: '2026-01-02T00:00:00Z', clientSequence: 2 },
        { data: { status: 'ABSENT' }, updatedAt: '2026-01-01T00:00:00Z' },
      ).resolution,
    ).toBe('CLIENT_WINS');
    expect(
      resolveConflict(
        'ATTENDANCE',
        { data: { status: 'PRESENT' }, clientTimestamp: '2025-12-31T00:00:00Z', clientSequence: 2 },
        { data: { status: 'ABSENT' }, updatedAt: '2026-01-01T00:00:00Z' },
      ).resolution,
    ).toBe('SERVER_WINS');
    expect(
      resolveConflict(
        'NOTICE',
        { data: { title: 'Draft' }, clientTimestamp: '2030-01-01T00:00:00Z', clientSequence: 3 },
        { data: { title: 'Published' }, updatedAt: '2026-01-01T00:00:00Z' },
      ).record.title,
    ).toBe('Published');
  });

  it('merges student fields with server values winning', () => {
    const resolution = resolveConflict(
      'STUDENT',
      {
        data: { firstName: 'Local', phone: '9800000000', address: 'Local St' },
        clientTimestamp: '2026-01-01T00:00:00Z',
        clientSequence: 1,
      },
      { data: { firstName: 'Server', phone: null, address: 'Server St' }, updatedAt: '2026-01-01T01:00:00Z' },
    );
    expect(resolution.record).toEqual({
      firstName: 'Server',
      phone: '9800000000',
      address: 'Server St',
    });
    expect(resolution.changedFields).toContain('firstName');
    expect(resolution.changedFields).toContain('address');
  });

  it('backs off exponentially with jitter and caps attempts', () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(1, undefined, () => 0.5)).toBe(500);
    expect(retryDelayMs(2, undefined, () => 0.5)).toBe(1000);
    expect(retryDelayMs(99)).toBe(-1);
  });

  it('reserves and consumes offline receipt blocks', () => {
    const { block, nextServerValue } = reserveReceiptBlock('dev-1', 'RCPT', 100, 3);
    expect(block).toEqual({ deviceId: 'dev-1', prefix: 'RCPT', start: 100, end: 102, next: 100 });
    expect(nextServerValue).toBe(103);
    expect(remainingReceipts(block)).toBe(3);
    const first = consumeReceiptNumber(block, 6, '2026/27');
    expect(first?.receiptNumber).toBe('RCPT-2026-27-000100');
    const second = consumeReceiptNumber(first!.block, 6, '2026/27');
    const third = consumeReceiptNumber(second!.block, 6, '2026/27');
    expect(third?.receiptNumber).toBe('RCPT-2026-27-000102');
    expect(consumeReceiptNumber(third!.block)).toBeNull();
    expect(() => reserveReceiptBlock('d', 'R', 1, 0)).toThrow();
  });
});
