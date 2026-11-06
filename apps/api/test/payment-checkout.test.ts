import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckoutSession, type CheckoutIntent } from '../src/payments/checkout.provider';

const intent: CheckoutIntent = {
  id: '11111111-1111-7111-8111-111111111111',
  schoolId: '22222222-2222-7222-8222-222222222222',
  studentId: '33333333-3333-7333-8333-333333333333',
  invoiceId: '44444444-4444-7444-8444-444444444444',
  amountMinor: 1050,
  currency: 'NPR',
  provider: 'mock',
  providerRef: 'mock_ref_1',
  metadata: {},
};

const options = { appOrigin: 'http://localhost:5173' };

const KEYS = [
  'STRIPE_SECRET_KEY',
  'KHALTI_SECRET_KEY',
  'KHALTI_CHECKOUT_URL',
  'ESEWA_SECRET_KEY',
  'ESEWA_PRODUCT_CODE',
  'ESEWA_CHECKOUT_URL',
  'PAYMENT_GATEWAY_CHECKOUT_BASE_URL',
] as const;

describe('payment checkout adapters', () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('creates a Stripe Checkout session and keeps the vendor id', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const session = await createCheckoutSession({ ...intent, provider: 'stripe' }, options);

    expect(session).toEqual({
      provider: 'stripe',
      checkoutUrl: 'https://checkout.stripe.test/1',
      providerRef: 'cs_test_1',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer sk_test_123',
    });
    const body = new URLSearchParams(String((init as RequestInit).body));
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1050');
    expect(body.get('line_items[0][price_data][currency]')).toBe('npr');
    expect(body.get('metadata[intentId]')).toBe(intent.id);
  });

  it('surfaces a Stripe error without leaking the secret', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }),
    );

    await expect(
      createCheckoutSession({ ...intent, provider: 'stripe' }, options),
    ).rejects.toThrow('Stripe checkout failed (401): Invalid API key');
  });

  it('initiates Khalti with the amount in paisa', async () => {
    process.env.KHALTI_SECRET_KEY = 'khalti_secret';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ pidx: 'pidx_1', payment_url: 'https://khalti.test/pay/1' }),
        { status: 200 },
      ),
    );

    const session = await createCheckoutSession({ ...intent, provider: 'khalti' }, options);

    expect(session).toEqual({
      provider: 'khalti',
      checkoutUrl: 'https://khalti.test/pay/1',
      providerRef: 'pidx_1',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://a.khalti.com/api/v2/epayment/initiate/');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.amount).toBe(1050);
    expect(body.return_url).toBe(`http://localhost:5173/?paymentIntent=${intent.id}`);
  });

  it('builds a signed eSewa redirect in rupees', async () => {
    process.env.ESEWA_SECRET_KEY = 'esewa_secret';
    process.env.ESEWA_PRODUCT_CODE = 'EPAYTEST';

    const session = await createCheckoutSession({ ...intent, provider: 'esewa' }, options);

    expect(session?.provider).toBe('esewa');
    const url = new URL(session!.checkoutUrl);
    expect(url.origin + url.pathname).toBe(
      'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    );
    expect(url.searchParams.get('total_amount')).toBe('10.50');
    expect(url.searchParams.get('product_code')).toBe('EPAYTEST');
    const expected = createHmac('sha256', 'esewa_secret')
      .update(`total_amount=10.50,transaction_uuid=${intent.providerRef},product_code=EPAYTEST`)
      .digest('base64');
    expect(url.searchParams.get('signature')).toBe(expected);
  });

  it('uses the deployment hosted checkout fallback when vendor keys are absent', async () => {
    process.env.PAYMENT_GATEWAY_CHECKOUT_BASE_URL = 'https://pay.example.test/checkout/';

    const session = await createCheckoutSession({ ...intent, provider: 'esewa' }, options);

    expect(session).toEqual({
      provider: 'esewa',
      checkoutUrl: 'https://pay.example.test/checkout/mock_ref_1',
    });
  });

  it('returns no redirect for the mock provider in development', async () => {
    await expect(createCheckoutSession(intent, options)).resolves.toBeNull();
  });
});
