import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  billingPeriodEnd,
  deliveryRetryDelayMs,
  dunningActionFor,
  planNotificationDeliveries,
  platformInvoiceNumber,
  prorationLine,
  prorationMinor,
  renderNotificationTemplate,
  resolveNotificationPreferences,
} from '../src';

describe('notification planning', () => {
  it('renders a registry template and removes unknown placeholders', () => {
    const rendered = renderNotificationTemplate('fee.reminder', {
      amount: 'NPR 1,200',
      invoiceNumber: 'INV-1',
      studentName: 'Asha',
      dueDate: '2026-11-10',
    });
    expect(rendered.title).toBe('Fee reminder: NPR 1,200');
    expect(rendered.body).toContain('INV-1');
    expect(rendered.body).not.toContain('{{');
  });

  it('throws for an unknown template', () => {
    expect(() => renderNotificationTemplate('nope', {})).toThrow(/Unknown notification template/);
  });

  it('resolves stored preferences over the defaults', () => {
    const resolved = resolveNotificationPreferences({
      channels: { SMS: false, IN_APP: true },
      categories: { FEE: false },
    });
    expect(resolved.channels.SMS).toBe(false);
    expect(resolved.channels.EMAIL).toBe(DEFAULT_NOTIFICATION_PREFERENCES.channels.EMAIL);
    expect(resolved.categories.FEE).toBe(false);
  });

  it('skips channels without an address and honours opt-outs', () => {
    const preferences = resolveNotificationPreferences({
      channels: { SMS: false },
    });
    const plan = planNotificationDeliveries({
      channels: ['IN_APP', 'EMAIL', 'SMS'],
      category: 'FEE',
      recipient: {
        userId: 'user-1',
        name: 'Asha',
        email: 'asha@example.com',
        phone: '9812345678',
      },
      preferences,
    });

    expect(plan.find((row) => row.channel === 'IN_APP')?.deliverable).toBe(true);
    expect(plan.find((row) => row.channel === 'EMAIL')?.recipient).toBe('asha@example.com');
    expect(plan.find((row) => row.channel === 'SMS')).toMatchObject({
      deliverable: false,
      reason: 'CHANNEL_DISABLED',
      recipient: '+9779812345678',
    });
  });

  it('skips a disabled category across every channel', () => {
    const plan = planNotificationDeliveries({
      channels: ['IN_APP', 'EMAIL'],
      category: 'ATTENDANCE',
      recipient: { userId: 'u1', name: 'Asha', email: 'asha@example.com' },
      preferences: resolveNotificationPreferences({ categories: { ATTENDANCE: false } }),
    });
    expect(plan.every((row) => !row.deliverable)).toBe(true);
    expect(plan[0]?.reason).toBe('CATEGORY_DISABLED');
  });

  it('backs off exponentially and stops after the retry budget', () => {
    expect(deliveryRetryDelayMs(0, () => 0)).toBe(0);
    expect(deliveryRetryDelayMs(2, () => 0.999)).toBeGreaterThan(0);
    expect(deliveryRetryDelayMs(5, () => 0.5)).toBeNull();
  });
});

describe('billing helpers', () => {
  it('computes monthly and yearly period ends in UTC', () => {
    expect(billingPeriodEnd(new Date('2026-01-31T00:00:00.000Z'), 'MONTHLY').toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(billingPeriodEnd(new Date('2026-03-01T00:00:00.000Z'), 'YEARLY').toISOString()).toBe(
      '2027-03-01T00:00:00.000Z',
    );
  });

  it('prorates the remaining part of a period', () => {
    const amount = prorationMinor({
      amountMinor: 1200,
      periodStart: new Date('2026-11-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-01T00:00:00.000Z'),
      changeAt: new Date('2026-11-16T00:00:00.000Z'),
    });
    expect(amount).toBe(600);
  });

  it('builds a signed proration line', () => {
    const line = prorationLine({
      fromPlanName: 'Starter',
      toPlanName: 'Growth',
      fromPriceMinor: 1000,
      toPriceMinor: 3000,
      periodStart: new Date('2026-11-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-01T00:00:00.000Z'),
      changeAt: new Date('2026-11-16T00:00:00.000Z'),
    });
    expect(line.amountMinor).toBe(1000);
    expect(line.description).toContain('Starter');
  });

  it('escalates dunning actions by overdue days', () => {
    const due = new Date('2026-11-01T00:00:00.000Z');
    expect(dunningActionFor(due, new Date('2026-10-30T00:00:00.000Z'))).toBe('NONE');
    expect(dunningActionFor(due, new Date('2026-11-04T00:00:00.000Z'))).toBe('REMIND');
    expect(dunningActionFor(due, new Date('2026-11-09T00:00:00.000Z'))).toBe('PAST_DUE');
    expect(dunningActionFor(due, new Date('2026-11-20T00:00:00.000Z'))).toBe('SUSPEND');
  });

  it('makes stable invoice numbers', () => {
    expect(platformInvoiceNumber('green-valley', '2026-11')).toBe('PI-GREEN-VALLEY-2026-11');
    expect(platformInvoiceNumber('green-valley', '2026-11', 2)).toBe(
      'PI-GREEN-VALLEY-2026-11-2',
    );
  });
});
