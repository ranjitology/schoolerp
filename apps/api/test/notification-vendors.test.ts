import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notificationProvider,
  resetNotificationProvider,
  type DeliveryMessage,
} from '../src/notices/delivery.provider';

const emailMessage: DeliveryMessage = {
  deliveryId: 'delivery-email-1',
  channel: 'EMAIL',
  recipient: 'guardian@example.com',
  title: 'Fee reminder',
  body: 'Term 2 fees are due.',
};

const smsMessage: DeliveryMessage = {
  deliveryId: 'delivery-sms-1',
  channel: 'SMS',
  recipient: '+9779800000000',
  title: 'Attendance',
  body: 'Your child was marked present.',
};

const VENDOR_ENV = [
  'NOTIFICATION_WEBHOOK_URL',
  'EMAIL_PROVIDER',
  'SENDGRID_API_KEY',
  'NOTIFICATION_FROM_EMAIL',
  'NOTIFICATION_FROM_NAME',
  'SMS_PROVIDER',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
] as const;

describe('notification vendor transports', () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of VENDOR_ENV) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    resetNotificationProvider();
    vi.restoreAllMocks();
    for (const key of VENDOR_ENV) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('sends email through SendGrid and records the vendor message id', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.test-key';
    process.env.NOTIFICATION_FROM_EMAIL = 'noreply@school.test';
    process.env.NOTIFICATION_FROM_NAME = 'Green Valley School';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 202, headers: { 'x-message-id': 'sg-123' } }),
    );

    const provider = notificationProvider();
    expect(provider.name).toBe('sendgrid');
    await expect(provider.send(emailMessage)).resolves.toEqual({
      status: 'SENT',
      providerMessageId: 'sg-123',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer SG.test-key',
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.personalizations[0].to[0].email).toBe('guardian@example.com');
    expect(body.from).toEqual({ email: 'noreply@school.test', name: 'Green Valley School' });
  });

  it('maps a SendGrid rejection to a failed delivery', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.test-key';
    process.env.NOTIFICATION_FROM_EMAIL = 'noreply@school.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('sender identity not verified', { status: 403 }),
    );

    await expect(notificationProvider().send(emailMessage)).resolves.toEqual({
      status: 'FAILED',
      error: 'SendGrid responded 403: sender identity not verified',
    });
  });

  it('sends SMS through Twilio with form-encoded credentials', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token-456';
    process.env.TWILIO_FROM_NUMBER = '+15550001111';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM789' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const provider = notificationProvider();
    expect(provider.name).toBe('twilio');
    await expect(provider.send(smsMessage)).resolves.toEqual({
      status: 'SENT',
      providerMessageId: 'SM789',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('AC123:token-456').toString('base64')}`);
    const body = new URLSearchParams(String((init as RequestInit).body));
    expect(body.get('To')).toBe('+9779800000000');
    expect(body.get('From')).toBe('+15550001111');
    expect(body.get('Body')).toContain('Your child was marked present.');
  });

  it('prefixes WhatsApp recipients for the Twilio channel', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token-456';
    process.env.TWILIO_FROM_NUMBER = '+15550001111';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM999' }), { status: 201 }),
    );

    await notificationProvider().send({ ...smsMessage, channel: 'WHATSAPP' });

    const body = new URLSearchParams(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.get('To')).toBe('whatsapp:+9779800000000');
    expect(body.get('From')).toBe('whatsapp:+15550001111');
  });

  it('routes only configured channels and keeps the console fallback', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.test-key';
    process.env.NOTIFICATION_FROM_EMAIL = 'noreply@school.test';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const provider = notificationProvider();
    expect(provider.name).toBe('sendgrid');
    await expect(provider.send(smsMessage)).resolves.toEqual({
      status: 'SENT',
      providerMessageId: 'console-delivery-sms-1',
    });
  });

  it('refuses to start with a vendor selected but credentials missing', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    expect(() => notificationProvider()).toThrow(/SENDGRID_API_KEY/);
  });
});
