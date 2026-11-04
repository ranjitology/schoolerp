import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { AppError, UnauthorizedError } from '@schoolerp/core';
import { loadEnv } from '../config/env';

export interface TenantAccessClaims {
  sub: string;
  sid: string;
  role: string;
  email: string;
  name: string;
  scope: 'tenant';
  imp?: true;
  impId?: string;
  pid?: string;
}

export interface PlatformAccessClaims {
  sub: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';
  scope: 'platform';
}

export interface RefreshMaterial {
  token: string;
  hash: string;
}

@Injectable()
export class TokenService {
  private readonly env = loadEnv();

  signTenantAccess(claims: Omit<TenantAccessClaims, 'scope'>, ttlSeconds?: number): string {
    return this.sign({ ...claims, scope: 'tenant' }, this.env.JWT_ACCESS_SECRET, 'tenant', ttlSeconds ?? this.env.ACCESS_TOKEN_TTL_SECONDS);
  }

  signPlatformAccess(claims: Omit<PlatformAccessClaims, 'scope'>, ttlSeconds?: number): string {
    return this.sign(
      { ...claims, scope: 'platform' },
      this.env.JWT_ACCESS_SECRET,
      'platform',
      ttlSeconds ?? this.env.PLATFORM_TOKEN_TTL_SECONDS,
    );
  }

  verifyTenantAccess(token: string): TenantAccessClaims {
    const payload = this.verify(token, this.env.JWT_ACCESS_SECRET, 'tenant');
    if (payload.scope !== 'tenant' || !payload.sub || !payload.sid) {
      throw new UnauthorizedError('Invalid access token');
    }
    return payload as TenantAccessClaims;
  }

  verifyPlatformAccess(token: string): PlatformAccessClaims {
    const payload = this.verify(token, this.env.JWT_ACCESS_SECRET, 'platform');
    if (payload.scope !== 'platform' || !payload.sub) {
      throw new UnauthorizedError('Invalid platform token');
    }
    return payload as PlatformAccessClaims;
  }

  createRefreshToken(): RefreshMaterial {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(`${this.env.JWT_REFRESH_PEPPER}:${token}`).digest('hex');
  }

  getAccessTtl(): number {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }

  getRefreshTtlDays(): number {
    return this.env.REFRESH_TOKEN_TTL_DAYS;
  }

  private sign(
    payload: object,
    secret: string,
    audience: 'tenant' | 'platform',
    expiresInSeconds: number,
  ): string {
    const options: SignOptions = {
      algorithm: 'HS256',
      issuer: 'schoolerp',
      audience,
      expiresIn: expiresInSeconds,
      jwtid: randomBytes(12).toString('hex'),
    };
    return jwt.sign(payload, secret, options);
  }

  private verify(token: string, secret: string, audience: 'tenant' | 'platform'): JwtPayload {
    try {
      return jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'schoolerp',
        audience,
        clockTolerance: 5,
      }) as JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('TOKEN_EXPIRED', 'Access token expired', 401);
      }
      throw new UnauthorizedError('Invalid access token');
    }
  }
}
