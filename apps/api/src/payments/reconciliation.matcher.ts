/**
 * Pure settlement matching rules.
 *
 * Kept free of Prisma so the matching outcomes can be unit tested without a
 * database. The service persists the returned rows verbatim.
 */

export type SettlementMatchStatusValue =
  | 'MATCHED'
  | 'AMOUNT_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'MISSING_INTENT'
  | 'MISSING_PAYMENT'
  | 'DUPLICATE';

export interface SettlementLineSnapshot {
  providerRef: string;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  status: string;
  settledAt: Date;
  notes?: string | null;
}

export interface SettlementIntentSnapshot {
  id: string;
  providerRef: string | null;
  amountMinor: number;
  status: string;
  paymentId: string | null;
  invoiceId?: string | null;
}

export interface SettlementUnsettledIntent {
  id: string;
  providerRef: string | null;
  amountMinor: number;
  invoiceId: string | null;
}

export interface MatchedSettlementLine extends SettlementLineSnapshot {
  matchStatus: SettlementMatchStatusValue;
  intentId: string | null;
  paymentId: string | null;
  notes: string | null;
}

export interface SettlementMatchResult {
  lines: MatchedSettlementLine[];
  matchedCount: number;
  mismatchCount: number;
  unsettledCount: number;
  unsettled: SettlementUnsettledIntent[];
  amountMinor: number;
  feeMinor: number;
}

export function matchSettlementLines(input: {
  lines: SettlementLineSnapshot[];
  intents: SettlementIntentSnapshot[];
  succeededIntents: SettlementIntentSnapshot[];
  currency: string;
}): SettlementMatchResult {
  const intentsByRef = new Map<string, SettlementIntentSnapshot>();
  for (const intent of input.intents) {
    if (intent.providerRef) intentsByRef.set(intent.providerRef, intent);
  }

  const seenRefs = new Set<string>();
  const lines = input.lines.map<MatchedSettlementLine>((line) => {
    const notes: string[] = [];
    const duplicate = seenRefs.has(line.providerRef);
    seenRefs.add(line.providerRef);

    const intent = intentsByRef.get(line.providerRef);
    let matchStatus: SettlementMatchStatusValue;

    if (duplicate) {
      matchStatus = 'DUPLICATE';
      notes.push('Duplicate provider reference in the settlement feed');
    } else if (!intent) {
      matchStatus = 'MISSING_INTENT';
      notes.push('No payment intent matches this provider reference');
    } else if (intent.amountMinor !== line.amountMinor) {
      matchStatus = 'AMOUNT_MISMATCH';
      notes.push(`Intent amount ${intent.amountMinor} vs settled ${line.amountMinor}`);
    } else if (intent.status !== 'SUCCEEDED') {
      matchStatus = 'STATUS_MISMATCH';
      notes.push(`Intent status is ${intent.status}`);
    } else if (!intent.paymentId) {
      matchStatus = 'MISSING_PAYMENT';
      notes.push('Intent succeeded without a linked payment');
    } else {
      matchStatus = 'MATCHED';
    }

    if (line.currency !== input.currency) {
      notes.push(`Settlement currency ${line.currency} differs from ${input.currency}`);
    }
    if (line.notes) notes.push(line.notes);

    return {
      ...line,
      matchStatus,
      intentId: intent?.id ?? null,
      paymentId: intent?.paymentId ?? null,
      notes: notes.length > 0 ? notes.join('; ').slice(0, 500) : null,
    };
  });

  const settledRefs = new Set(input.lines.map((line) => line.providerRef));
  const unsettled: SettlementUnsettledIntent[] = [];
  const seenUnsettled = new Set<string>();
  for (const intent of input.succeededIntents) {
    if (seenUnsettled.has(intent.id)) continue;
    seenUnsettled.add(intent.id);
    if (intent.providerRef && settledRefs.has(intent.providerRef)) continue;
    unsettled.push({
      id: intent.id,
      providerRef: intent.providerRef,
      amountMinor: intent.amountMinor,
      invoiceId: intent.invoiceId ?? null,
    });
  }

  const matchedCount = lines.filter((line) => line.matchStatus === 'MATCHED').length;

  return {
    lines,
    matchedCount,
    mismatchCount: lines.length - matchedCount,
    unsettledCount: unsettled.length,
    unsettled,
    amountMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    feeMinor: lines.reduce((sum, line) => sum + line.feeMinor, 0),
  };
}
