const API_BASE = '/api/v1';
const SLUG_KEY = 'erp.schoolSlug';

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function getTenantSlug(): string {
  const fromHost = window.location.hostname.split('.')[0];
  const isLocal = ['localhost', '127', '0', 'tauri'].includes(fromHost ?? '');
  return localStorage.getItem(SLUG_KEY) ?? (isLocal ? 'green-valley' : (fromHost ?? 'green-valley'));
}

export function setTenantSlug(slug: string): void {
  localStorage.setItem(SLUG_KEY, slug.trim().toLowerCase());
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorFrom(response: Response, body: unknown): ApiError {
  const envelope = body as { error?: { code?: string; message?: string; details?: unknown } };
  return new ApiError(
    response.status,
    envelope?.error?.code ?? `HTTP_${response.status}`,
    envelope?.error?.message ?? response.statusText ?? 'Request failed',
    envelope?.error?.details,
  );
}

async function execute(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('X-School-Slug', getTenantSlug());
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
}

/** Attempts a silent refresh; the refresh token lives in an HttpOnly cookie. */
export async function refreshSession<T>(): Promise<T | null> {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-School-Slug': getTenantSlug(),
    },
    body: '{}',
  });
  if (!response.ok) return null;
  const body = (await parse(response)) as { data?: T } | null;
  return body?.data ?? null;
}

async function request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  let response = await execute(path, init);
  if (response.status === 401 && retry) {
    const refreshed = await refreshSession<{ accessToken: string }>();
    if (refreshed?.accessToken) {
      setAccessToken(refreshed.accessToken);
      response = await execute(path, init);
    }
  }

  const body = await parse(response);
  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.();
    throw errorFrom(response, body);
  }
  const envelope = body as { data?: T; meta?: Record<string, unknown> } | null;
  if (envelope && typeof envelope === 'object' && 'data' in envelope) return envelope.data as T;
  return body as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
  async download(path: string, fallbackName: string): Promise<void> {
    const response = await execute(path, { method: 'GET' });
    if (!response.ok) throw errorFrom(response, await parse(response));
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = match?.[1] ?? fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
  /**
   * Fetches a document with the bearer token and opens the blob in a new tab.
   * A plain `window.open('/api/...')` would lose the Authorization header.
   */
  async openDocument(path: string, fallbackName: string): Promise<void> {
    const response = await execute(path, { method: 'GET' });
    if (!response.ok) throw errorFrom(response, await parse(response));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    if (!blob.type.includes('html')) anchor.download = fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};

export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}
