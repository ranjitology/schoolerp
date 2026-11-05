import { uuidv7 } from '@schoolerp/core';
import type { TxClient } from '@schoolerp/db';

export interface LedgerAccountSeed {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
}

/**
 * Stable chart of accounts used by automatic postings. Additional accounts can
 * be added by a school without changing these codes.
 */
export const DEFAULT_LEDGER_ACCOUNTS: readonly LedgerAccountSeed[] = [
  { code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: '1010', name: 'Bank', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '2200', name: 'Salaries Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '3000', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT' },
  { code: '4000', name: 'Tuition Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
  { code: '4100', name: 'Other Income', type: 'REVENUE', normalBalance: 'CREDIT' },
  { code: '5000', name: 'Salaries Expense', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: '5100', name: 'Operating Expense', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: '5200', name: 'Refunds', type: 'EXPENSE', normalBalance: 'DEBIT' },
] as const;

export interface JournalLineInput {
  accountCode: string;
  debitMinor?: number;
  creditMinor?: number;
  memo?: string;
}

export interface PostJournalInput {
  schoolId: string;
  entryDate: Date;
  description: string;
  sourceType: string;
  sourceId: string;
  createdByUserId?: string | null;
  lines: JournalLineInput[];
}

/** Ensures the built-in chart exists for a tenant. Safe to call repeatedly. */
export async function ensureLedgerAccounts(tx: TxClient, schoolId: string): Promise<Map<string, string>> {
  const existing = await tx.ledgerAccount.findMany({
    where: { schoolId },
    select: { id: true, code: true },
  });
  const byCode = new Map(existing.map((account) => [account.code, account.id]));

  for (const account of DEFAULT_LEDGER_ACCOUNTS) {
    if (byCode.has(account.code)) continue;
    const created = await tx.ledgerAccount.create({
      data: {
        id: uuidv7(),
        schoolId,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        isSystem: true,
      },
      select: { id: true },
    });
    byCode.set(account.code, created.id);
  }
  return byCode;
}

/**
 * Writes one balanced, idempotent journal entry. The unique source key means a
 * retried payment or a regenerated invoice cannot double-post.
 */
export async function postJournal(
  tx: TxClient,
  input: PostJournalInput,
): Promise<{ id: string; number: string } | null> {
  const lines = input.lines.filter(
    (line) => (line.debitMinor ?? 0) !== 0 || (line.creditMinor ?? 0) !== 0,
  );
  if (lines.length === 0) return null;

  const debit = lines.reduce((sum, line) => sum + (line.debitMinor ?? 0), 0);
  const credit = lines.reduce((sum, line) => sum + (line.creditMinor ?? 0), 0);
  if (debit !== credit) {
    throw new Error(`Unbalanced journal entry for ${input.sourceType}: debit ${debit} != credit ${credit}`);
  }
  if (debit === 0) return null;

  const existing = await tx.journalEntry.findUnique({
    where: {
      schoolId_sourceType_sourceId: {
        schoolId: input.schoolId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    select: { id: true, number: true },
  });
  if (existing) return existing;

  const accounts = await ensureLedgerAccounts(tx, input.schoolId);
  const isoDay = input.entryDate.toISOString().slice(0, 10).replace(/-/g, '');
  const number = `JE-${isoDay}-${uuidv7().slice(-8).toUpperCase()}`;

  const entry = await tx.journalEntry.create({
    data: {
      id: uuidv7(),
      schoolId: input.schoolId,
      number,
      entryDate: input.entryDate,
      description: input.description.slice(0, 500),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdByUserId: input.createdByUserId ?? null,
      lines: {
        create: lines.map((line) => {
          const accountId = accounts.get(line.accountCode);
          if (!accountId) {
            throw new Error(`Unknown ledger account code ${line.accountCode}`);
          }
          return {
            id: uuidv7(),
            schoolId: input.schoolId,
            accountId,
            debitMinor: line.debitMinor ?? 0,
            creditMinor: line.creditMinor ?? 0,
            memo: line.memo?.slice(0, 240) ?? null,
          };
        }),
      },
    },
    select: { id: true, number: true },
  });
  return entry;
}

export function cashOrBankCode(method: string): '1000' | '1010' {
  return method === 'CASH' ? '1000' : '1010';
}

export function postInvoiceIssued(
  tx: TxClient,
  input: {
    schoolId: string;
    invoiceId: string;
    invoiceNumber: string;
    entryDate: Date;
    totalMinor: number;
    createdByUserId?: string | null;
  },
) {
  return postJournal(tx, {
    schoolId: input.schoolId,
    entryDate: input.entryDate,
    description: `Invoice ${input.invoiceNumber} issued`,
    sourceType: 'INVOICE',
    sourceId: input.invoiceId,
    createdByUserId: input.createdByUserId,
    lines: [
      { accountCode: '1100', debitMinor: input.totalMinor, memo: input.invoiceNumber },
      { accountCode: '4000', creditMinor: input.totalMinor, memo: input.invoiceNumber },
    ],
  });
}

export function postPaymentReceived(
  tx: TxClient,
  input: {
    schoolId: string;
    paymentId: string;
    receiptNumber: string;
    method: string;
    entryDate: Date;
    amountMinor: number;
    createdByUserId?: string | null;
  },
) {
  return postJournal(tx, {
    schoolId: input.schoolId,
    entryDate: input.entryDate,
    description: `Payment ${input.receiptNumber} received`,
    sourceType: 'PAYMENT',
    sourceId: input.paymentId,
    createdByUserId: input.createdByUserId,
    lines: [
      {
        accountCode: cashOrBankCode(input.method),
        debitMinor: input.amountMinor,
        memo: input.method,
      },
      { accountCode: '1100', creditMinor: input.amountMinor, memo: input.receiptNumber },
    ],
  });
}

export function postRefund(
  tx: TxClient,
  input: {
    schoolId: string;
    refundId: string;
    receiptNumber: string;
    method: string;
    entryDate: Date;
    amountMinor: number;
    createdByUserId?: string | null;
  },
) {
  return postJournal(tx, {
    schoolId: input.schoolId,
    entryDate: input.entryDate,
    description: `Refund for ${input.receiptNumber}`,
    sourceType: 'REFUND',
    sourceId: input.refundId,
    createdByUserId: input.createdByUserId,
    lines: [
      { accountCode: '5200', debitMinor: input.amountMinor, memo: input.receiptNumber },
      {
        accountCode: cashOrBankCode(input.method),
        creditMinor: input.amountMinor,
        memo: input.method,
      },
    ],
  });
}

export function postExpense(
  tx: TxClient,
  input: {
    schoolId: string;
    expenseId: string;
    category: string;
    method: string;
    entryDate: Date;
    amountMinor: number;
    createdByUserId?: string | null;
  },
) {
  return postJournal(tx, {
    schoolId: input.schoolId,
    entryDate: input.entryDate,
    description: `Expense: ${input.category}`,
    sourceType: 'EXPENSE',
    sourceId: input.expenseId,
    createdByUserId: input.createdByUserId,
    lines: [
      { accountCode: '5100', debitMinor: input.amountMinor, memo: input.category },
      {
        accountCode: cashOrBankCode(input.method),
        creditMinor: input.amountMinor,
        memo: input.method,
      },
    ],
  });
}

export function postPayrollProcessed(
  tx: TxClient,
  input: {
    schoolId: string;
    payrollRunId: string;
    period: string;
    entryDate: Date;
    totalMinor: number;
    createdByUserId?: string | null;
  },
) {
  return postJournal(tx, {
    schoolId: input.schoolId,
    entryDate: input.entryDate,
    description: `Payroll processed for ${input.period}`,
    sourceType: 'PAYROLL',
    sourceId: input.payrollRunId,
    createdByUserId: input.createdByUserId,
    lines: [
      { accountCode: '5000', debitMinor: input.totalMinor, memo: input.period },
      { accountCode: '2200', creditMinor: input.totalMinor, memo: input.period },
    ],
  });
}
