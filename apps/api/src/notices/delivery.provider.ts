import type { NotificationChannel } from '@schoolerp/core';

export interface DeliveryMessage {
  deliveryId: string;
  channel: NotificationChannel;
  recipient: string;
  title: string;
  body: string;
}

export interface DeliveryResult {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  providerMessageId?: string;
  error?: string;
}

export interface DeliveryProvider {
  readonly name: string;
  send(message: DeliveryMessage): Promise<DeliveryResult>;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Development transport. It never leaves the process, so local/CI runs do not
 * need credentials. The provider name is stored alongside the message id so an
 * operator can tell a console send from a real one.
 */
class ConsoleDeliveryProvider implements DeliveryProvider {
  readonly name = 'console';

  async send(message: DeliveryMessage): Promise<DeliveryResult> {
    // eslint-disable-next-line no-console
    console.info(
      `[notification:${message.channel}] -> ${message.recipient} | ${message.title}`,
    );
    return { status: 'SENT', providerMessageId: `console-${message.deliveryId}` };
  }
}

/**
 * Minimal webhook transport so a deployment can plug in an SMS/email gateway
 * without changing the delivery pipeline. The payload is intentionally small
 * and provider-agnostic; the gateway owns vendor-specific formatting.
 */
class WebhookDeliveryProvider implements DeliveryProvider {
  readonly name = 'webhook';

  constructor(private readonly url: string) {}

  async send(message: DeliveryMessage): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          status: 'FAILED',
          error: `Provider responded ${response.status}`.slice(0, 500),
        };
      }
      const payload = (await response.json().catch(() => ({}))) as {
        messageId?: string;
      };
      return {
        status: 'SENT',
        providerMessageId: payload.messageId ?? `webhook-${message.deliveryId}`,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        error: (error instanceof Error ? error.message : 'Provider request failed').slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * SendGrid transactional email over the v3 HTTP API. Using fetch keeps the
 * dependency surface small; the deployment only needs an API key and a verified
 * sender address.
 */
class SendGridEmailProvider implements DeliveryProvider {
  readonly name = 'sendgrid';

  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fromName?: string,
  ) {}

  async send(message: DeliveryMessage): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: message.recipient }],
              subject: message.title,
              custom_args: { deliveryId: message.deliveryId },
            },
          ],
          from: {
            email: this.fromEmail,
            ...(this.fromName ? { name: this.fromName } : {}),
          },
          content: [{ type: 'text/plain', value: message.body }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 400);
        return {
          status: 'FAILED',
          error: `SendGrid responded ${response.status}${detail ? `: ${detail}` : ''}`.slice(
            0,
            500,
          ),
        };
      }
      return {
        status: 'SENT',
        providerMessageId:
          response.headers.get('x-message-id') ?? `sendgrid-${message.deliveryId}`,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        error: (error instanceof Error ? error.message : 'SendGrid request failed').slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Twilio Programmable Messaging for SMS and WhatsApp. The same account and
 * credentials drive both; WhatsApp recipients are addressed with the
 * `whatsapp:` prefix Twilio expects.
 */
class TwilioMessagingProvider implements DeliveryProvider {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(message: DeliveryMessage): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const whatsapp = message.channel === 'WHATSAPP';
    const prefixed = (value: string) =>
      whatsapp && !value.startsWith('whatsapp:') ? `whatsapp:${value}` : value;
    const body = new URLSearchParams({
      To: prefixed(message.recipient),
      From: prefixed(this.fromNumber),
      Body: `${message.title}\n\n${message.body}`.slice(0, 1600),
    });
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        return {
          status: 'FAILED',
          error: `Twilio responded ${response.status}${payload.message ? `: ${payload.message}` : ''}`.slice(
            0,
            500,
          ),
        };
      }
      const payload = (await response.json().catch(() => ({}))) as { sid?: string };
      return {
        status: 'SENT',
        providerMessageId: payload.sid ?? `twilio-${message.deliveryId}`,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        error: (error instanceof Error ? error.message : 'Twilio request failed').slice(0, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Sends each channel through the provider configured for that channel. */
class ChannelRouterDeliveryProvider implements DeliveryProvider {
  readonly name: string;

  constructor(
    private readonly fallback: DeliveryProvider,
    private readonly routes: Partial<Record<NotificationChannel, DeliveryProvider>>,
  ) {
    this.name = [
      ...new Set(
        Object.values(routes)
          .map((route) => route?.name)
          .filter((value): value is string => Boolean(value)),
      ),
    ].join('+');
  }

  send(message: DeliveryMessage): Promise<DeliveryResult> {
    const provider = this.routes[message.channel] ?? this.fallback;
    return provider.send(message);
  }
}

let provider: DeliveryProvider | null = null;

/**
 * Resolves the configured transport once per process.
 *
 * Order of precedence:
 * 1. `NOTIFICATION_WEBHOOK_URL` — forwards every channel to one gateway.
 * 2. Per-channel vendor transports selected by `EMAIL_PROVIDER` / `SMS_PROVIDER`.
 * 3. The console transport for local development and tests.
 */
export function notificationProvider(): DeliveryProvider {
  if (provider) return provider;
  provider = resolveProvider();
  return provider;
}

function resolveProvider(): DeliveryProvider {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL?.trim();
  if (webhookUrl) return new WebhookDeliveryProvider(webhookUrl);

  const fallback = new ConsoleDeliveryProvider();
  const routes: Partial<Record<NotificationChannel, DeliveryProvider>> = {};

  const emailProvider = (process.env.EMAIL_PROVIDER ?? 'console').trim().toLowerCase();
  if (emailProvider === 'sendgrid') {
    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL?.trim();
    if (!apiKey || !fromEmail) {
      throw new Error(
        'SENDGRID_API_KEY and NOTIFICATION_FROM_EMAIL are required when EMAIL_PROVIDER=sendgrid',
      );
    }
    routes.EMAIL = new SendGridEmailProvider(
      apiKey,
      fromEmail,
      process.env.NOTIFICATION_FROM_NAME?.trim() || undefined,
    );
  }

  const smsProvider = (process.env.SMS_PROVIDER ?? 'console').trim().toLowerCase();
  if (smsProvider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error(
        'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are required when SMS_PROVIDER=twilio',
      );
    }
    const twilio = new TwilioMessagingProvider(accountSid, authToken, fromNumber);
    routes.SMS = twilio;
    routes.WHATSAPP = twilio;
  }

  const configured = Object.keys(routes).length > 0;
  return configured ? new ChannelRouterDeliveryProvider(fallback, routes) : fallback;
}

/** Test seam: reset the cached provider after changing environment variables. */
export function resetNotificationProvider(): void {
  provider = null;
}
