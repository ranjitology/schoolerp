/**
 * Application-level errors. Every error that crosses the HTTP boundary has a
 * stable machine-readable code, an HTTP status and optional structured details.
 * The API exception filter serialises these without leaking stack traces.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REUSED'
  | 'ACCOUNT_LOCKED'
  | 'TWO_FACTOR_REQUIRED'
  | 'INVALID_TWO_FACTOR_CODE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'TENANT_NOT_FOUND'
  | 'SCHOOL_SUSPENDED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_MISMATCH'
  | 'VERSION_CONFLICT'
  | 'OFFLINE_CONFLICT'
  | 'RATE_LIMITED'
  | 'PLAN_LIMIT_EXCEEDED'
  | 'FEATURE_DISABLED'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    status = 400,
    details?: unknown,
    expose = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = expose;
    Error.captureStackTrace?.(this, AppError);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION_FAILED', message, 422, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = 'UNAUTHORIZED') {
    super(code, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details?: unknown) {
    super('FORBIDDEN', message, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class TenantMismatchError extends AppError {
  constructor(message = 'Token does not belong to the requested school') {
    super('TENANT_MISMATCH', message, 403);
    this.name = 'TenantMismatchError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', details?: unknown) {
    super('NOT_FOUND', `${resource} not found`, 404, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many requests', 429, { retryAfterSeconds });
    this.name = 'RateLimitedError';
  }
}

export class PlanLimitError extends AppError {
  constructor(metric: string, limit: number, current: number, requested: number) {
    super(
      'PLAN_LIMIT_EXCEEDED',
      `Plan limit reached for ${metric}`,
      402,
      { metric, limit, current, requested },
    );
    this.name = 'PlanLimitError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Converts any thrown value into an AppError. Unknown errors are marked
 * non-exposing so the API returns a generic message while still logging the
 * original error server-side.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error) {
    return new AppError('BAD_REQUEST', error.message, 500, undefined, false);
  }
  return new AppError('BAD_REQUEST', 'Unexpected error', 500, undefined, false);
}
