/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds) and RFC 4648 base32.
 * Implemented locally to avoid a runtime dependency in the auth path.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface TotpOptions {
  digits?: number;
  periodSeconds?: number;
  timestampMs?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error('Invalid base32 string');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1',
): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('Invalid counter');
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(buffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    ((digest[offset] ?? 0) & 0x7f) * 2 ** 24 +
    ((digest[offset + 1] ?? 0) & 0xff) * 2 ** 16 +
    ((digest[offset + 2] ?? 0) & 0xff) * 2 ** 8 +
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpCode(secretBase32: string, options: TotpOptions = {}): string {
  const period = options.periodSeconds ?? 30;
  const timestamp = options.timestampMs ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / period);
  return hotp(
    base32Decode(secretBase32),
    counter,
    options.digits ?? 6,
    options.algorithm ?? 'sha1',
  );
}

export interface TotpVerification {
  valid: boolean;
  /** Matched time step, for replay prevention (store the last used step). */
  step: number | null;
}

/**
 * Verifies a code with a ±1 step window for clock drift. Callers must persist
 * the matched step and reject any step <= the last accepted one (replay).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: TotpOptions & { window?: number } = {},
): TotpVerification {
  const digits = options.digits ?? 6;
  const period = options.periodSeconds ?? 30;
  const timestamp = options.timestampMs ?? Date.now();
  const current = Math.floor(timestamp / 1000 / period);
  const window = options.window ?? 1;

  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { valid: false, step: null };
  const secret = base32Decode(secretBase32);
  const provided = Buffer.from(code, 'utf8');

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = Buffer.from(
      hotp(secret, step, digits, options.algorithm ?? 'sha1'),
      'utf8',
    );
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { valid: true, step };
    }
  }
  return { valid: false, step: null };
}

export function otpauthUrl(input: {
  issuer: string;
  account: string;
  secret: string;
  digits?: number;
  periodSeconds?: number;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? 6),
    period: String(input.periodSeconds ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
