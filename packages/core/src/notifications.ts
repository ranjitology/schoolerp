/**
 * Notification templates, recipient planning and delivery retries.
 *
 * Providers are deliberately not imported here: this module decides *what*
 * should be delivered to *which address*, while the API adapts that plan to a
 * concrete transport (console in development, HTTP webhook in production).
 */
import { normalizePhone } from './communication';
import { ValidationError } from './errors';

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = [
  'NOTICE',
  'FEE',
  'ATTENDANCE',
  'RESULT',
  'ADMISSION',
  'ACCOUNT',
  'GENERAL',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationTemplate {
  key: string;
  category: NotificationCategory;
  title: string;
  body: string;
  channels: readonly NotificationChannel[];
}

/**
 * Small, code-owned template registry. Keeping templates in code means a bad
 * template can never be saved by a tenant admin and then break every send.
 */
export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  'notice.published': {
    key: 'notice.published',
    category: 'NOTICE',
    title: '{{title}}',
    body: '{{body}}',
    channels: ['IN_APP'],
  },
  'fee.reminder': {
    key: 'fee.reminder',
    category: 'FEE',
    title: 'Fee reminder: {{amount}}',
    body: 'Invoice {{invoiceNumber}} for {{studentName}} is due on {{dueDate}}.',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
  },
  'fee.receipt': {
    key: 'fee.receipt',
    category: 'FEE',
    title: 'Payment received: {{amount}}',
    body: 'We received {{amount}} for {{studentName}} on {{paidAt}}.',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
  },
  'attendance.absent': {
    key: 'attendance.absent',
    category: 'ATTENDANCE',
    title: 'Absence recorded',
    body: '{{studentName}} was marked absent on {{date}}.',
    channels: ['IN_APP', 'SMS'],
  },
  'result.published': {
    key: 'result.published',
    category: 'RESULT',
    title: '{{examName}} results are ready',
    body: '{{studentName}} scored {{percentage}}% ({{grade}}).',
    channels: ['IN_APP', 'EMAIL'],
  },
  'admission.offer': {
    key: 'admission.offer',
    category: 'ADMISSION',
    title: 'Admission offer for {{studentName}}',
    body: 'An offer has been issued for {{className}}. Please contact the school office to confirm.',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
  },
  'account.welcome': {
    key: 'account.welcome',
    category: 'ACCOUNT',
    title: 'Welcome to {{schoolName}}',
    body: 'Your account is ready. Sign in with {{email}}.',
    channels: ['IN_APP', 'EMAIL'],
  },
};

export interface NotificationPreferences {
  channels: Record<NotificationChannel, boolean>;
  categories: Record<NotificationCategory, boolean>;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: {
    IN_APP: true,
    EMAIL: true,
    SMS: true,
    WHATSAPP: false,
    PUSH: true,
  },
  categories: {
    NOTICE: true,
    FEE: true,
    ATTENDANCE: true,
    RESULT: true,
    ADMISSION: true,
    ACCOUNT: true,
    GENERAL: true,
  },
};

/** Merges untrusted JSON into the default preference shape. */
export function resolveNotificationPreferences(raw: unknown): NotificationPreferences {
  const value = (raw ?? {}) as {
    channels?: Record<string, unknown>;
    categories?: Record<string, unknown>;
  };
  const channels = { ...DEFAULT_NOTIFICATION_PREFERENCES.channels };
  const categories = { ...DEFAULT_NOTIFICATION_PREFERENCES.categories };
  for (const channel of NOTIFICATION_CHANNELS) {
    if (typeof value.channels?.[channel] === 'boolean') {
      channels[channel] = value.channels[channel] as boolean;
    }
  }
  for (const category of NOTIFICATION_CATEGORIES) {
    if (typeof value.categories?.[category] === 'boolean') {
      categories[category] = value.categories[category] as boolean;
    }
  }
  return { channels, categories };
}

export interface DeliveryRecipient {
  userId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface PlannedDelivery {
  channel: NotificationChannel;
  recipient: string;
  deliverable: boolean;
  reason?: 'NO_ADDRESS' | 'CHANNEL_DISABLED' | 'CATEGORY_DISABLED';
}

function addressFor(channel: NotificationChannel, recipient: DeliveryRecipient): string | null {
  switch (channel) {
    case 'EMAIL':
      return recipient.email?.trim() || null;
    case 'SMS':
    case 'WHATSAPP':
      return normalizePhone(recipient.phone);
    case 'IN_APP':
    case 'PUSH':
      return recipient.userId ?? null;
  }
}

/** Builds the exact channel plan for one recipient, honouring opt-outs. */
export function planNotificationDeliveries(input: {
  channels: readonly NotificationChannel[];
  category: NotificationCategory;
  recipient: DeliveryRecipient;
  preferences?: NotificationPreferences;
}): PlannedDelivery[] {
  const preferences = input.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const seen = new Set<NotificationChannel>();
  const plan: PlannedDelivery[] = [];

  for (const channel of input.channels) {
    if (seen.has(channel)) continue;
    seen.add(channel);

    const address = addressFor(channel, input.recipient);
    if (!address) {
      plan.push({ channel, recipient: '', deliverable: false, reason: 'NO_ADDRESS' });
      continue;
    }
    if (!preferences.channels[channel]) {
      plan.push({ channel, recipient: address, deliverable: false, reason: 'CHANNEL_DISABLED' });
      continue;
    }
    if (!preferences.categories[input.category]) {
      plan.push({ channel, recipient: address, deliverable: false, reason: 'CATEGORY_DISABLED' });
      continue;
    }
    plan.push({ channel, recipient: address, deliverable: true });
  }

  return plan;
}

export interface RenderedNotification {
  template: NotificationTemplate;
  title: string;
  body: string;
}

/** Renders a registry template. Unknown templates are a programming error. */
export function renderNotificationTemplate(
  key: string,
  variables: Record<string, string | number | null | undefined>,
): RenderedNotification {
  const template = NOTIFICATION_TEMPLATES[key];
  if (!template) throw new ValidationError(`Unknown notification template: ${key}`);
  return {
    template,
    title: interpolate(template.title, variables),
    body: interpolate(template.body, variables),
  };
}

function interpolate(
  value: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
    const replacement = variables[name];
    return replacement === undefined || replacement === null ? '' : String(replacement);
  });
}

export const DELIVERY_RETRY_POLICY = {
  baseDelayMs: 30_000,
  maxDelayMs: 3_600_000,
  maxAttempts: 5,
} as const;

/**
 * Exponential backoff with full jitter. Returns `null` when the delivery has
 * exhausted its attempts and should be left FAILED for an operator to inspect.
 */
export function deliveryRetryDelayMs(
  attempts: number,
  random: () => number = Math.random,
): number | null {
  if (!Number.isInteger(attempts) || attempts < 0) return null;
  if (attempts >= DELIVERY_RETRY_POLICY.maxAttempts) return null;
  const ceiling = Math.min(
    DELIVERY_RETRY_POLICY.maxDelayMs,
    DELIVERY_RETRY_POLICY.baseDelayMs * 2 ** attempts,
  );
  return Math.floor(random() * ceiling);
}

/** Delivers in-app notifications for notices and templates. */
export function isInAppChannel(channel: NotificationChannel): boolean {
  return channel === 'IN_APP' || channel === 'PUSH';
}
