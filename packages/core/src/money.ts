/**
 * Money is always stored and transported as integer minor units (paisa,
 * cents). Never use floats for arithmetic. Currencies with 0 or 3 decimals are
 * supported for future international tenants.
 */
import { ValidationError } from './errors';

export interface CurrencyDefinition {
  code: string;
  fractionDigits: number;
  symbol: string;
}

export const CURRENCIES: Record<string, CurrencyDefinition> = {
  NPR: { code: 'NPR', fractionDigits: 2, symbol: 'Rs.' },
  INR: { code: 'INR', fractionDigits: 2, symbol: '₹' },
  USD: { code: 'USD', fractionDigits: 2, symbol: '$' },
  EUR: { code: 'EUR', fractionDigits: 2, symbol: '€' },
  GBP: { code: 'GBP', fractionDigits: 2, symbol: '£' },
  AED: { code: 'AED', fractionDigits: 2, symbol: 'د.إ' },
  JPY: { code: 'JPY', fractionDigits: 0, symbol: '¥' },
  KWD: { code: 'KWD', fractionDigits: 3, symbol: 'د.ك' },
};

export function currency(code: string): CurrencyDefinition {
  const definition = CURRENCIES[code.toUpperCase()];
  if (!definition) throw new ValidationError(`Unsupported currency: ${code}`);
  return definition;
}

export function currencyFactor(code: string): number {
  return 10 ** currency(code).fractionDigits;
}

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * Parses user/CSV input into minor units without floating-point arithmetic.
 * Accepts "1,250.50", "Rs. 1250", 1250.5, etc. Rejects excess precision
 * instead of silently rounding a fee.
 */
export function parseMoneyToMinor(input: string | number, currencyCode = 'NPR'): number {
  const definition = currency(currencyCode);
  let raw: string;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new ValidationError('Invalid amount');
    raw = input.toString();
  } else {
    raw = input
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(new RegExp(`^${definition.code}\\s*`, 'i'), '')
      .replace(new RegExp(`^\\${definition.symbol}\\s*`), '')
      .replace(/,/g, '')
      .replace(/\s+/g, '');
  }

  if (!DECIMAL_PATTERN.test(raw)) throw new ValidationError(`Invalid amount: ${String(input)}`);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
  const whole = wholeRaw ?? '0';

  if (fractionRaw.length > definition.fractionDigits) {
    throw new ValidationError(
      `Amount has more than ${definition.fractionDigits} decimal place(s) for ${definition.code}`,
    );
  }

  const paddedFraction = fractionRaw.padEnd(definition.fractionDigits, '0');
  const digits = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) throw new ValidationError('Amount is too large');
  return negative ? -minor : minor;
}

export function toMinor(major: number, currencyCode = 'NPR'): number {
  return parseMoneyToMinor(major, currencyCode);
}

export function fromMinor(minor: number, currencyCode = 'NPR'): number {
  assertIntegerMinor(minor);
  return minor / currencyFactor(currencyCode);
}

export function formatMoney(
  minor: number,
  currencyCode = 'NPR',
  locale = 'en-NP',
): string {
  assertIntegerMinor(minor);
  const definition = currency(currencyCode);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: definition.code,
    minimumFractionDigits: definition.fractionDigits,
    maximumFractionDigits: definition.fractionDigits,
  });
  return formatter.format(minor / 10 ** definition.fractionDigits);
}

/** Locale-independent plain decimal string, e.g. for PDFs and CSV exports. */
export function moneyToDecimalString(minor: number, currencyCode = 'NPR'): string {
  assertIntegerMinor(minor);
  const digits = currency(currencyCode).fractionDigits;
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const factor = 10 ** digits;
  const whole = Math.floor(abs / factor);
  const fraction = String(abs % factor).padStart(digits, '0');
  return `${sign}${whole}.${fraction}`;
}

export function assertIntegerMinor(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError('Monetary values must be safe integers in minor units');
  }
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertIntegerMinor(value);
    total += value;
    if (!Number.isSafeInteger(total)) throw new ValidationError('Amount overflow');
  }
  return total;
}

export function assertNonNegative(value: number, label = 'Amount'): void {
  assertIntegerMinor(value);
  if (value < 0) throw new ValidationError(`${label} cannot be negative`);
}

/**
 * Splits an amount by integer weights using the largest-remainder method, so
 * the parts always sum exactly to the total (no lost paisa). Ties go to the
 * earlier weight for deterministic invoices.
 */
export function allocateMinor(total: number, weights: readonly number[]): number[] {
  assertNonNegative(total);
  if (weights.length === 0) throw new ValidationError('At least one weight is required');
  if (weights.some((w) => !Number.isSafeInteger(w) || w <= 0)) {
    throw new ValidationError('Weights must be positive integers');
  }
  const weightTotal = sumMinor(weights);
  const raw = weights.map((w) => (total * w) / weightTotal);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = total - sumMinor(floors);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floors];
  for (const item of order) {
    if (remainder <= 0) break;
    result[item.index] = (result[item.index] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

/** Basis-point calculation with half-up rounding, integer-only. */
export function percentOfMinor(amount: number, basisPoints: number): number {
  assertIntegerMinor(amount);
  if (!Number.isSafeInteger(basisPoints)) throw new ValidationError('Invalid basis points');
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const numerator = abs * basisPoints;
  if (!Number.isSafeInteger(numerator)) throw new ValidationError('Amount overflow');
  return sign * Math.floor((numerator + 5000) / 10000);
}

export function clampMinor(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
