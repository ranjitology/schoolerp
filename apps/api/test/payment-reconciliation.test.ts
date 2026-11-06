import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  matchSettlementLines,
  type SettlementIntentSnapshot,
  type SettlementLineSnapshot,
} from '../src/payments/reconciliation.matcher';
import { fetchSettlementFeed } from '../src/payments/settlement.provider';

const settledAt = new Date('2026-11-05T10:00:00.000Z');

function line(overrides: Partial<SettlementLineSnapshot>): SettlementLineSnapshot {
  return {
    providerRef: 'ref',
    amountMinor: 1000,
    feeMinor: 10,
    currency: 'NPR',
    status: 'SETTLED',
    settledAt,
    ...overrides,
  };
}

function intent(overrides: Partial<SettlementIntentSnapshot>): SettlementIntentSnapshot {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    providerRef: 'ref',
    amountMinor: 1000,
    status: 'SUCCEEDED',
    paymentId: '22222222-2222-7222-8222-222222222222',
    invoiceId: null,
    ...overrides,
  };
}

describe('settlement matching', () => {
  it('classifies every match outcome', () => {
    const intents = [
      intent({ id: 'intent-ok', providerRef: 'ok', amountMinor: 1000 }),
      intent({ id: 'intent-amount', providerRef: 'amount', amountMinor: 1000 }),
      intent({ id: 'intent-status', providerRef: 'status', status: 'FAILED' }),
      intent({ id: 'intent-nopay', providerRef: 'nopay', paymentId: null }),
    ];

    const result = matchSettlementLines({
      lines: [
        line({ providerRef: 'ok' }),
        line({ providerRef: 'amount', amountMinor: 900 }),
        line({ providerRef: 'status' }),
        line({ providerRef: 'missing' }),
        line({ providerRef: 'nopay' }),
        line({ providerRef: 'ok' }),
      ],
      intents,
      succeededIntents: [...intents, intent({ id: 'intent-unsettled', providerRef: 'unsettled' })],
      currency: 'NPR',
    });

    expect(result.lines.map((row) => row.matchStatus)).toEqual([
      'MATCHED',
      'AMOUNT_MISMATCH',
      'STATUS_MISMATCH',
      'MISSING_INTENT',
      'MISSING_PAYMENT',
      'DUPLICATE',
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.mismatchCount).toBe(5);
    expect(result.amountMinor).toBe(5900);
    expect(result.feeMinor).toBe(60);
    expect(result.unsettledCount).toBe(1);
    expect(result.unsettled).toEqual([
      {
        id: 'intent-unsettled',
        providerRef: 'unsettled',
        amountMinor: 1000,
        invoiceId: null,
      },
    ]);
  });

  it('keeps the local intent and payment ids on a matched line', () => {
    const result = matchSettlementLines({
      lines: [line({ providerRef: 'ok' })],
      intents: [intent({ id: 'intent-1', providerRef: 'ok', paymentId: 'payment-1' })],
      succeededIntents: [],
      currency: 'NPR',
    });

    expect(result.lines[0]).toMatchObject({
      matchStatus: 'MATCHED',
      intentId: 'intent-1',
      paymentId: 'payment-1',
      notes: null,
    });
  });

  it('flags an amount mismatch before the intent status', () => {
    const result = matchSettlementLines({
      lines: [line({ providerRef: 'both', amountMinor: 700 })],
      intents: [intent({ providerRef: 'both', amountMinor: 1000, status: 'FAILED' })],
      succeededIntents: [],
      currency: 'NPR',
    });

    expect(result.lines[0]?.matchStatus).toBe('AMOUNT_MISMATCH');
    expect(result.lines[0]?.notes).toContain('700');
  });

  it('records a currency difference without changing the match outcome', () => {
    const result = matchSettlementLines({
      lines: [line({ providerRef: 'ok', currency: 'USD' })],
      intents: [intent({ providerRef: 'ok' })],
      succeededIntents: [],
      currency: 'NPR',
    });

    expect(result.lines[0]?.matchStatus).toBe('MATCHED');
    expect(result.lines[0]?.notes).toContain('USD');
  });
});

describe('settlement feed adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalises a lines payload and sends the provider and date range', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          lines: [
            {
              providerRef: 'ref-1',
              amountMinor: 5000,
              feeMinor: 25,
              currency: 'NPR',
              status: 'SETTLED',
              settledAt: '2026-11-01',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const rows = await fetchSettlementFeed({
      url: 'https://settlements.example.test/feed',
      token: 'feed-token',
      provider: 'khalti',
      from: '2026-11-01',
      to: '2026-11-07',
    });

    expect(rows).toEqual([
      {
        providerRef: 'ref-1',
        amountMinor: 5000,
        feeMinor: 25,
        currency: 'NPR',
        status: 'SETTLED',
        settledAt: new Date('2026-11-01T00:00:00.000Z'),
        notes: null,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    const target = new URL(String(url));
    expect(target.origin + target.pathname).toBe('https://settlements.example.test/feed');
    expect(target.searchParams.get('provider')).toBe('khalti');
    expect(target.searchParams.get('from')).toBe('2026-11-01');
    expect(target.searchParams.get('to')).toBe('2026-11-07');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer feed-token',
    });
  });

  it('rejects an unexpected payload before any rows are written', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );

    await expect(
      fetchSettlementFeed({
        url: 'https://settlements.example.test/feed',
        provider: 'mock',
        from: '2026-11-01',
        to: '2026-11-07',
      }),
    ).rejects.toThrow('Settlement feed returned an unexpected payload');
  });

  it('surfaces an upstream failure status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 503 }));

    await expect(
      fetchSettlementFeed({
        url: 'https://settlements.example.test/feed',
        provider: 'mock',
        from: '2026-11-01',
        to: '2026-11-07',
      }),
    ).rejects.toThrow('Settlement feed failed (503)');
  });
});
