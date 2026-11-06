import { createHmac } from 'node:crypto';

/**
 * Checkout adapters turn a stored payment intent into a hosted payment page.
 *
 * They are deliberately dependency-free: each adapter talks to the vendor's
 * HTTP API with `fetch` and is inactive until its credentials are configured.
 * That keeps local development on the mock provider while letting a deployment
 * switch on the real gateway through environment variables alone.
 */
export interface CheckoutIntent {
  id: string;
  schoolId: string;
  studentId: string;
  invoiceId: string | null;
  amountMinor: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  metadata: unknown;
}

export interface CheckoutSession {
  provider: string;
  checkoutUrl: string;
  /** Vendor reference that must replace the locally generated one. */
  providerRef?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

export interface CheckoutOptions {
  appOrigin: string;
  returnUrl?: string;
}

export async function createCheckoutSession(
  intent: CheckoutIntent,
  options: CheckoutOptions,
): Promise<CheckoutSession | null> {
  const returnUrl = safeUrl(options.returnUrl) ?? defaultReturnUrl(intent, options.appOrigin);

  switch (intent.provider) {
    case 'stripe':
      return stripeCheckout(intent, returnUrl);
    case 'khalti':
      return khaltiCheckout(intent, returnUrl, options.appOrigin);
    case 'esewa':
      return esewaCheckout(intent, returnUrl);
    case 'bank':
    case 'mock':
      return hostedRedirect(intent);
    default:
      return hostedRedirect(intent);
  }
}

/**
 * Stripe Checkout Sessions. Requires STRIPE_SECRET_KEY; without it the adapter
 * falls back to the deployment-wide hosted checkout URL, if one is configured.
 */
async function stripeCheckout(
  intent: CheckoutIntent,
  returnUrl: string,
): Promise<CheckoutSession | null> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return hostedRedirect(intent);

  const body = new URLSearchParams({
    mode: 'payment',
    success_url: returnUrl,
    cancel_url: returnUrl,
    client_reference_id: intent.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': intent.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(intent.amountMinor),
    'line_items[0][price_data][product_data][name]': productName(intent),
    'metadata[intentId]': intent.id,
    'metadata[schoolId]': intent.schoolId,
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await safeJson(response)) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.url) {
    throw new Error(
      `Stripe checkout failed (${response.status}): ${payload.error?.message ?? 'no checkout URL'}`,
    );
  }
  return {
    provider: 'stripe',
    checkoutUrl: payload.url,
    providerRef: payload.id,
  };
}

/**
 * Khalti ePayment initiate. Amounts are already in paisa, which is Khalti's
 * expected unit for NPR.
 */
async function khaltiCheckout(
  intent: CheckoutIntent,
  returnUrl: string,
  appOrigin: string,
): Promise<CheckoutSession | null> {
  const secret = process.env.KHALTI_SECRET_KEY?.trim();
  if (!secret) return hostedRedirect(intent);

  const base = process.env.KHALTI_CHECKOUT_URL?.trim() || 'https://a.khalti.com/api/v2/epayment/initiate/';
  const response = await fetch(base, {
    method: 'POST',
    headers: {
      authorization: `key ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      return_url: returnUrl,
      website_url: appOrigin,
      amount: intent.amountMinor,
      purchase_order_id: intent.id,
      purchase_order_name: productName(intent),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await safeJson(response)) as {
    pidx?: string;
    payment_url?: string;
    detail?: string;
  };
  if (!response.ok || !payload.payment_url) {
    throw new Error(`Khalti checkout failed (${response.status}): ${payload.detail ?? 'no payment URL'}`);
  }
  return {
    provider: 'khalti',
    checkoutUrl: payload.payment_url,
    providerRef: payload.pidx,
  };
}

/**
 * eSewa ePay v2 form redirect. The signature covers the total, transaction
 * UUID and product code; all amounts are expressed in rupees with two decimals.
 */
async function esewaCheckout(
  intent: CheckoutIntent,
  returnUrl: string,
): Promise<CheckoutSession | null> {
  const secret = process.env.ESEWA_SECRET_KEY?.trim();
  const productCode = process.env.ESEWA_PRODUCT_CODE?.trim();
  const providerRef = intent.providerRef;
  if (!secret || !productCode || !providerRef) return hostedRedirect(intent);

  const amount = (intent.amountMinor / 100).toFixed(2);
  const signedFields = 'total_amount,transaction_uuid,product_code';
  const signature = createHmac('sha256', secret)
    .update(
      `total_amount=${amount},transaction_uuid=${providerRef},product_code=${productCode}`,
    )
    .digest('base64');

  const base =
    process.env.ESEWA_CHECKOUT_URL?.trim() ||
    'https://rc-epay.esewa.com.np/api/epay/main/v2/form';
  const query = new URLSearchParams({
    amount,
    tax_amount: '0',
    total_amount: amount,
    transaction_uuid: providerRef,
    product_code: productCode,
    product_service_charge: '0',
    product_delivery_charge: '0',
    success_url: returnUrl,
    failure_url: returnUrl,
    signed_field_names: signedFields,
    signature,
  });
  return {
    provider: 'esewa',
    checkoutUrl: `${base}?${query.toString()}`,
    providerRef,
  };
}

/**
 * Deployment-wide redirect used by providers without credentials, and by the
 * mock/bank modes. `PAYMENT_GATEWAY_CHECKOUT_BASE_URL` points at a hosted page
 * that accepts the intent reference as its final path segment.
 */
function hostedRedirect(intent: CheckoutIntent): CheckoutSession | null {
  if (intent.provider === 'mock' && process.env.NODE_ENV !== 'production') {
    return null;
  }
  const base = process.env.PAYMENT_GATEWAY_CHECKOUT_BASE_URL?.trim();
  if (!base) return null;
  const ref = intent.providerRef ?? intent.id;
  return {
    provider: intent.provider,
    checkoutUrl: `${base.replace(/\/$/, '')}/${encodeURIComponent(ref)}`,
  };
}

function productName(intent: CheckoutIntent): string {
  return intent.invoiceId ? `School fee ${intent.invoiceId}` : 'School fee';
}

function defaultReturnUrl(intent: CheckoutIntent, appOrigin: string): string {
  const base = appOrigin.replace(/\/$/, '');
  return `${base}/?paymentIntent=${encodeURIComponent(intent.id)}`;
}

function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
