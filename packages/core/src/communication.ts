/** Notification templates and delivery helpers. */

export type DeliveryChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';

export interface TemplateVariables {
  [key: string]: string | number | undefined | null;
}

/**
 * Replaces `{{var}}` placeholders. Unknown placeholders are removed rather than
 * left in the message, so a parent never receives raw template syntax.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/** E.164-ish normalisation for Nepal numbers, returning null when unusable. */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = digitsOnly(value);
  if (digits.length === 10 && digits.startsWith('9')) return `+977${digits}`;
  if (digits.length === 11 && digits.startsWith('09')) return `+977${digits.slice(1)}`;
  if (digits.length === 13 && digits.startsWith('9779')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function maskRecipient(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    const safeLocal = local && local.length > 2 ? `${local.slice(0, 2)}***` : '***';
    return `${safeLocal}@${domain ?? ''}`;
  }
  if (value.length > 4) return `${value.slice(0, 3)}****${value.slice(-2)}`;
  return '****';
}
