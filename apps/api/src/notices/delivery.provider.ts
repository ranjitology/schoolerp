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
    const timer = setTimeout(() => controller.abort(), 10_000);
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

let provider: DeliveryProvider | null = null;

/** Resolves the configured transport once per process. */
export function notificationProvider(): DeliveryProvider {
  if (provider) return provider;
  const url = process.env.NOTIFICATION_WEBHOOK_URL?.trim();
  provider = url ? new WebhookDeliveryProvider(url) : new ConsoleDeliveryProvider();
  return provider;
}

/** Test seam: reset the cached provider after changing environment variables. */
export function resetNotificationProvider(): void {
  provider = null;
}
