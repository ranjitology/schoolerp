import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notificationProvider,
  resetNotificationProvider,
  type DeliveryMessage,
} from '../src/notices/delivery.provider';

const message: DeliveryMessage = {
  deliveryId: 'delivery-1',
  channel: 'EMAIL',
  recipient: 'guardian@example.com',
  title: 'Fee reminder',
  body: 'Term 2 fees are due.',
};

describe('notification delivery provider', () => {
  const originalUrl = process.env.NOTIFICATION_WEBHOOK_URL;

  afterEach(() => {
    resetNotificationProvider();
    vi.restoreAllMocks();
    if (originalUrl === undefined) delete process.env.NOTIFICATION_WEBHOOK_URL;
    else process.env.NOTIFICATION_WEBHOOK_URL = originalUrl;
  });

  it('uses the in-process console transport by default', async () => {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = notificationProvider();

    expect(provider.name).toBe('console');
    await expect(provider.send(message)).resolves.toEqual({
      status: 'SENT',
      providerMessageId: 'console-delivery-1',
    });
  });

  it('uses the webhook transport when configured and keeps the provider id', async () => {
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://notify.example.test/send';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messageId: 'vendor-42' }), { status: 200 }));
    const provider = notificationProvider();

    expect(provider.name).toBe('webhook');
    await expect(provider.send(message)).resolves.toEqual({
      status: 'SENT',
      providerMessageId: 'vendor-42',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://notify.example.test/send');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      channel: 'EMAIL',
      recipient: 'guardian@example.com',
    });
  });

  it('records a failed delivery instead of throwing when the webhook errors', async () => {
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://notify.example.test/send';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('bad gateway', { status: 502 }),
    );

    await expect(notificationProvider().send(message)).resolves.toEqual({
      status: 'FAILED',
      error: 'Provider responded 502',
    });
  });

  it('caches the resolved provider until it is reset', () => {
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    const first = notificationProvider();
    process.env.NOTIFICATION_WEBHOOK_URL = 'https://notify.example.test/send';

    expect(notificationProvider()).toBe(first);

    resetNotificationProvider();
    expect(notificationProvider().name).toBe('webhook');
  });
});
