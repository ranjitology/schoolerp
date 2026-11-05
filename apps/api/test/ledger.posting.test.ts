import { describe, expect, it } from 'vitest';
import type { TxClient } from '@schoolerp/db';
import {
  DEFAULT_LEDGER_ACCOUNTS,
  postJournal,
  postPaymentReceived,
} from '../src/ledger/ledger.posting';

interface CapturedEntry {
  id: string;
  number: string;
  lines: { create: { debitMinor: number; creditMinor: number; accountId: string }[] };
}

function fakeTx(options: { existing?: { id: string; number: string } } = {}) {
  const captured: CapturedEntry[] = [];
  const tx = {
    ledgerAccount: {
      findMany: async () =>
        DEFAULT_LEDGER_ACCOUNTS.map((account, index) => ({
          id: `account-${index}`,
          code: account.code,
        })),
      create: async ({ data }: { data: { id: string } }) => ({ id: data.id }),
    },
    journalEntry: {
      findUnique: async () => options.existing ?? null,
      create: async ({ data }: { data: CapturedEntry }) => {
        captured.push(data);
        return { id: data.id, number: data.number };
      },
    },
  } as unknown as TxClient;
  return { tx, captured };
}

describe('ledger postings', () => {
  it('posts a balanced payment entry', async () => {
    const { tx, captured } = fakeTx();
    const result = await postPaymentReceived(tx, {
      schoolId: 'school-1',
      paymentId: 'payment-1',
      receiptNumber: 'RCPT-001',
      method: 'CASH',
      entryDate: new Date('2026-01-15T00:00:00.000Z'),
      amountMinor: 150_000,
      createdByUserId: 'user-1',
    });

    expect(result?.number).toMatch(/^JE-20260115-/);
    expect(captured).toHaveLength(1);
    const lines = captured[0]!.lines.create;
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debit).toBe(150_000);
    expect(credit).toBe(150_000);
  });

  it('is idempotent when the source entry already exists', async () => {
    const existing = { id: 'entry-1', number: 'JE-EXISTING' };
    const { tx, captured } = fakeTx({ existing });
    const result = await postPaymentReceived(tx, {
      schoolId: 'school-1',
      paymentId: 'payment-1',
      receiptNumber: 'RCPT-001',
      method: 'CASH',
      entryDate: new Date('2026-01-15T00:00:00.000Z'),
      amountMinor: 150_000,
    });

    expect(result).toEqual(existing);
    expect(captured).toHaveLength(0);
  });

  it('rejects an unbalanced entry', async () => {
    const { tx } = fakeTx();
    await expect(
      postJournal(tx, {
        schoolId: 'school-1',
        entryDate: new Date('2026-01-15T00:00:00.000Z'),
        description: 'Broken entry',
        sourceType: 'TEST',
        sourceId: 'test-1',
        lines: [
          { accountCode: '1000', debitMinor: 100 },
          { accountCode: '4000', creditMinor: 90 },
        ],
      }),
    ).rejects.toThrow(/Unbalanced journal entry/);
  });

  it('skips an entry whose lines are all zero', async () => {
    const { tx, captured } = fakeTx();
    const result = await postJournal(tx, {
      schoolId: 'school-1',
      entryDate: new Date('2026-01-15T00:00:00.000Z'),
      description: 'Zero entry',
      sourceType: 'TEST',
      sourceId: 'test-zero',
      lines: [{ accountCode: '1000', debitMinor: 0, creditMinor: 0 }],
    });
    expect(result).toBeNull();
    expect(captured).toHaveLength(0);
  });
});
