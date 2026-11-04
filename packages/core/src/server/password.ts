/**
 * Argon2id password hashing (PHC string format).
 *
 * Parameters follow OWASP's recommended minimum for interactive logins
 * (19 MiB, t=2, p=1). They are stored in the hash, so a future increase can be
 * rolled out transparently via `verifyPassword().needsRehash`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2id } from 'hash-wasm';

export interface Argon2Params {
  memorySizeKiB: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
  saltLength: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memorySizeKiB: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
};

const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
}

function unb64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

export async function hashPassword(
  password: string,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<string> {
  if (!password) throw new Error('Password is required');
  const salt = randomBytes(params.saltLength);
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySizeKiB,
    hashLength: params.hashLength,
    outputType: 'binary',
  });
  return `$argon2id$v=19$m=${params.memorySizeKiB},t=${params.iterations},p=${params.parallelism}$${b64(
    salt,
  )}$${b64(hash)}`;
}

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export async function verifyPassword(
  encodedHash: string,
  password: string,
  currentParams: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<PasswordVerification> {
  const match = PHC_PATTERN.exec(encodedHash);
  if (!match) return { valid: false, needsRehash: false };

  const memorySize = Number(match[1]);
  const iterations = Number(match[2]);
  const parallelism = Number(match[3]);
  const salt = unb64(match[4] ?? '');
  const expected = unb64(match[5] ?? '');

  // Bound attacker-controlled parameters to prevent CPU/memory DoS via a
  // tampered database row.
  if (
    !Number.isSafeInteger(memorySize) ||
    memorySize < 8192 ||
    memorySize > 262_144 ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 10 ||
    !Number.isSafeInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > 8 ||
    salt.length < 8 ||
    salt.length > 64 ||
    expected.length < 16 ||
    expected.length > 64
  ) {
    return { valid: false, needsRehash: false };
  }

  const actual = await argon2id({
    password,
    salt,
    parallelism,
    iterations,
    memorySize,
    hashLength: expected.length,
    outputType: 'binary',
  });

  const valid = actual.length === expected.length && timingSafeEqual(Buffer.from(actual), expected);
  const needsRehash =
    valid &&
    (memorySize < currentParams.memorySizeKiB ||
      iterations < currentParams.iterations ||
      expected.length < currentParams.hashLength);

  return { valid, needsRehash };
}

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  'qwertyuiop',
  'school1234',
  'admin12345',
  'letmein123',
  'welcome123',
  'changeme123',
]);

export interface PasswordStrength {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  issues: string[];
}

/**
 * Password policy: 10–128 chars, at least three of lower/upper/digit/symbol,
 * not a known common password, and not containing the account identifier.
 */
export function validatePasswordStrength(
  password: string,
  identifiers: readonly string[] = [],
): PasswordStrength {
  const issues: string[] = [];
  if (password.length < 10) issues.push('Use at least 10 characters');
  if (password.length > 128) issues.push('Use at most 128 characters');

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) issues.push('Mix upper case, lower case, numbers or symbols');

  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) issues.push('This password is too common');
  for (const identifier of identifiers) {
    const clean = identifier.trim().toLowerCase();
    if (clean.length >= 3 && normalized.includes(clean)) {
      issues.push('Password must not contain your name or email');
      break;
    }
  }
  if (/(.)\1{3,}/i.test(password)) issues.push('Avoid repeating the same character four times');

  const score = Math.max(0, Math.min(4, classes + (password.length >= 14 ? 1 : 0) - 1)) as
    | 0
    | 1
    | 2
    | 3
    | 4;
  return { ok: issues.length === 0, score, issues };
}
