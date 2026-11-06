import { AppError } from '@schoolerp/core';
import { z } from 'zod';
import type { SettlementLineSnapshot } from './reconciliation.matcher';

/**
 * Settlement-feed adapter.
 *
 * A deployment points `PAYMENT_SETTLEMENT_FEED_URL` at a service that exposes
 * the provider's settled transactions as JSON. The contract is intentionally
 * small and provider-neutral: an array of lines (or `{ lines: [...] }`) with a
 * provider reference, integer minor-unit amount and settlement timestamp. The
 * adapter validates every row before any reconciliation rows are written.
 */

const settledAtSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);

const feedLineSchema = z.object({
  providerRef: z.string().trim().min(1).max(160),
  amountMinor: z.number().int().min(0).max(2_147_483_647),
  feeMinor: z.number().int().min(0).max(2_147_483_647).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  settledAt: settledAtSchema,
  notes: z.string().trim().max(500).optional(),
});

const feedPayloadSchema = z.union([
  z.array(feedLineSchema),
  z.object({ lines: z.array(feedLineSchema) }),
]);

const REQUEST_TIMEOUT_MS = 10_000;

export interface SettlementFeedOptions {
  url: string;
  token?: string;
  provider: string;
  from: string;
  to: string;
}

export async function fetchSettlementFeed(
  options: SettlementFeedOptions,
): Promise<SettlementLineSnapshot[]> {
  const target = new URL(options.url);
  target.searchParams.set('provider', options.provider);
  target.searchParams.set('from', options.from);
  target.searchParams.set('to', options.to);

  let response: Response;
  try {
    response = await fetch(target, {
      headers: {
        accept: 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `Settlement feed request failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `Settlement feed failed (${response.status})`,
      502,
    );
  }

  const parsed = feedPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Settlement feed returned an unexpected payload',
      422,
      { issues: parsed.error.issues },
    );
  }

  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.lines;
  return rows.map((row) => ({
    providerRef: row.providerRef,
    amountMinor: row.amountMinor,
    feeMinor: row.feeMinor ?? 0,
    currency: row.currency ?? 'NPR',
    status: row.status ?? 'SETTLED',
    settledAt: parseSettledAt(row.settledAt),
    notes: row.notes ?? null,
  }));
}

function parseSettledAt(value: string): Date {
  const iso = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_FAILED', `Invalid settlement date: ${value}`, 422);
  }
  return date;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
