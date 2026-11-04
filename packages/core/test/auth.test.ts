import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from '../src/server/totp';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
  type Argon2Params,
} from '../src/server/password';

const RFC_SECRET = '12345678901234567890';
const RFC_SECRET_B32 = base32Encode(Buffer.from(RFC_SECRET, 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const secret = Buffer.from(RFC_SECRET, 'ascii');
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130'],
    ];
    for (const [time, expected] of vectors) {
      expect(hotp(secret, Math.floor(time / 30), 8)).toBe(expected);
    }
  });

  it('round-trips base32', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(() => base32Decode('invalid!')).toThrow();
  });

  it('generates and verifies codes with a drift window', () => {
    const code = totpCode(RFC_SECRET_B32, { timestampMs: 59_000 });
    expect(code).toBe('287082');
    expect(totpCode(RFC_SECRET_B32, { timestampMs: 59_000, digits: 8 })).toBe('94287082');
    expect(verifyTotp(RFC_SECRET_B32, code, { timestampMs: 59_000 }).valid).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, { timestampMs: 89_000 }).valid).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, { timestampMs: 200_000 }).valid).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, 'abcdef', { timestampMs: 59_000 }).valid).toBe(false);
  });

  it('builds a valid otpauth URL', () => {
    const url = otpauthUrl({
      issuer: 'School ERP',
      account: 'admin@stmary.test',
      secret: RFC_SECRET_B32,
    });
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=' + RFC_SECRET_B32);
    expect(url).toContain('issuer=School+ERP');
  });
});

const FAST_PARAMS: Argon2Params = {
  memorySizeKiB: 8192,
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
};

describe('password hashing (Argon2id)', () => {
  it('hashes with a unique salt and verifies', async () => {
    const first = await hashPassword('Correct-Horse-Battery-9', FAST_PARAMS);
    const second = await hashPassword('Correct-Horse-Battery-9', FAST_PARAMS);
    expect(first).not.toBe(second);
    expect(first.startsWith('$argon2id$v=19$')).toBe(true);
    await expect(verifyPassword(first, 'Correct-Horse-Battery-9')).resolves.toMatchObject({
      valid: true,
      needsRehash: true,
    });
    await expect(verifyPassword(first, 'wrong-password')).resolves.toMatchObject({ valid: false });
  });

  it('rejects malformed and hostile hashes', async () => {
    await expect(verifyPassword('plaintext', 'x')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
    await expect(
      verifyPassword('$argon2id$v=19$m=99999999,t=99,p=8$c2FsdHNhbHQ$aGFzaA', 'x'),
    ).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it('enforces the password policy', () => {
    expect(validatePasswordStrength('Str0ng-Passphrase!').ok).toBe(true);
    expect(validatePasswordStrength('short').issues).toContain('Use at least 10 characters');
    expect(validatePasswordStrength('password123').issues).toContain('This password is too common');
    expect(validatePasswordStrength('JohnDoe-12345', ['johndoe']).issues).toContain(
      'Password must not contain your name or email',
    );
    expect(validatePasswordStrength('Aaaabbb-1234').issues).toContain(
      'Avoid repeating the same character four times',
    );
  });
});
