import { describe, expect, it } from 'vitest';
import { AppError } from '@schoolerp/core';
import { TokenService } from '../src/auth/token.service';

const tokens = new TokenService();

describe('TokenService', () => {
  it('signs and verifies tenant access claims', () => {
    const token = tokens.signTenantAccess({
      sub: '11111111-1111-7111-8111-111111111111',
      sid: '22222222-2222-7222-8222-222222222222',
      role: 'ADMIN',
      email: 'admin@example.test',
      name: 'Admin',
    });

    const claims = tokens.verifyTenantAccess(token);
    expect(claims.scope).toBe('tenant');
    expect(claims.sid).toBe('22222222-2222-7222-8222-222222222222');
    expect(claims.role).toBe('ADMIN');
  });

  it('rejects a tenant token presented as a platform token', () => {
    const token = tokens.signTenantAccess({
      sub: '11111111-1111-7111-8111-111111111111',
      sid: '22222222-2222-7222-8222-222222222222',
      role: 'ADMIN',
      email: 'admin@example.test',
      name: 'Admin',
    });

    expect(() => tokens.verifyPlatformAccess(token)).toThrow(AppError);
  });

  it('rejects a tampered token', () => {
    const token = tokens.signPlatformAccess({
      sub: '33333333-3333-7333-8333-333333333333',
      email: 'platform@example.test',
      role: 'SUPER_ADMIN',
    });
    const [header, payload, signature] = token.split('.');
    const forged = `${header}.${payload}.${signature!.slice(0, -2)}xx`;

    expect(() => tokens.verifyPlatformAccess(forged)).toThrow('Invalid access token');
  });

  it('reports expired tokens distinctly', () => {
    const token = tokens.signTenantAccess(
      {
        sub: '11111111-1111-7111-8111-111111111111',
        sid: '22222222-2222-7222-8222-222222222222',
        role: 'ADMIN',
        email: 'admin@example.test',
        name: 'Admin',
      },
      -10,
    );

    expect(() => tokens.verifyTenantAccess(token)).toThrow(AppError);
    try {
      tokens.verifyTenantAccess(token);
    } catch (error) {
      expect((error as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('creates unique refresh tokens and hashes them with the pepper', () => {
    const first = tokens.createRefreshToken();
    const second = tokens.createRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).toHaveLength(64);
    expect(first.hash).not.toBe(first.token);
    expect(tokens.hashRefreshToken(first.token)).toBe(first.hash);
  });
});
