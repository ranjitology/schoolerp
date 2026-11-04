import type { Request, Response } from 'express';
import { loadEnv } from '../config/env';

export const REFRESH_COOKIE = 'erp_refresh';

export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Web clients keep the opaque token out of JavaScript entirely. */
export function setRefreshCookie(response: Response, token: string, maxAgeSeconds: number): void {
  const env = loadEnv();
  response.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge: maxAgeSeconds * 1000,
  });
}

export function clearRefreshCookie(response: Response): void {
  const env = loadEnv();
  response.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
  });
}

export function isDesktopClient(request: Request): boolean {
  return request.header('x-client')?.toLowerCase() === 'desktop';
}
