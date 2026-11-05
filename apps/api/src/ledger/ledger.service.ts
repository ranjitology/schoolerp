import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { withTenant } from '@schoolerp/db';
import type { AuthPrincipal } from '../common/request';
import { ensureLedgerAccounts } from './ledger.posting';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const trialBalanceQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const journalQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  sourceType: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@Injectable()
export class LedgerService {
  async accounts(auth: AuthPrincipal) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await ensureLedgerAccounts(tx, auth.schoolId);
      return tx.ledgerAccount.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: { code: 'asc' },
      });
    });
  }

  async trialBalance(auth: AuthPrincipal, query: z.infer<typeof trialBalanceQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      await ensureLedgerAccounts(tx, auth.schoolId);
      const entries = await tx.journalEntry.findMany({
        where: {
          schoolId: auth.schoolId,
          ...(query.from || query.to
            ? {
                entryDate: {
                  ...(query.from ? { gte: day(query.from) } : {}),
                  ...(query.to ? { lte: day(query.to) } : {}),
                },
              }
            : {}),
        },
        select: {
          lines: {
            select: {
              debitMinor: true,
              creditMinor: true,
              account: {
                select: { id: true, code: true, name: true, type: true, normalBalance: true },
              },
            },
          },
        },
      });

      const byAccount = new Map<
        string,
        {
          id: string;
          code: string;
          name: string;
          type: string;
          normalBalance: string;
          debitMinor: number;
          creditMinor: number;
        }
      >();
      for (const entry of entries) {
        for (const line of entry.lines) {
          const row = byAccount.get(line.account.id) ?? {
            ...line.account,
            debitMinor: 0,
            creditMinor: 0,
          };
          row.debitMinor += line.debitMinor;
          row.creditMinor += line.creditMinor;
          byAccount.set(line.account.id, row);
        }
      }

      const accounts = [...byAccount.values()]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((row) => ({
          ...row,
          balanceMinor:
            row.normalBalance === 'DEBIT'
              ? row.debitMinor - row.creditMinor
              : row.creditMinor - row.debitMinor,
        }));
      const totalDebitMinor = accounts.reduce((sum, row) => sum + row.debitMinor, 0);
      const totalCreditMinor = accounts.reduce((sum, row) => sum + row.creditMinor, 0);

      return {
        from: query.from ?? null,
        to: query.to ?? null,
        accounts,
        totalDebitMinor,
        totalCreditMinor,
        balanced: totalDebitMinor === totalCreditMinor,
      };
    });
  }

  async journal(auth: AuthPrincipal, query: z.infer<typeof journalQuerySchema>) {
    return withTenant({ schoolId: auth.schoolId }, async (tx) => {
      const where = {
        schoolId: auth.schoolId,
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.from || query.to
          ? {
              entryDate: {
                ...(query.from ? { gte: day(query.from) } : {}),
                ...(query.to ? { lte: day(query.to) } : {}),
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.journalEntry.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            lines: {
              include: {
                account: { select: { id: true, code: true, name: true, type: true } },
              },
            },
          },
        }),
        tx.journalEntry.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }
}

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
