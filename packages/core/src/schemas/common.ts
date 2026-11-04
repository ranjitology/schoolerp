import { z } from 'zod';

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Strict UUIDv7 (all domain ids are v7 — sortable, no sequence table). */
export const uuidV7Schema = z
  .string()
  .regex(UUID_V7_PATTERN, 'Expected a UUIDv7 identifier');

/** Accepts any RFC UUID for external references (e.g. imported legacy ids). */
export const uuidSchema = z.string().uuid();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().trim().max(64).optional(),
  order: sortOrderSchema,
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export function buildPageMeta(total: number, page: number, pageSize: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex colour such as #1d4ed8');

export const phoneSchema = z
  .string()
  .trim()
  .min(5)
  .max(24)
  .regex(/^[+0-9][0-9\s()-]{4,23}$/, 'Invalid phone number');

export const shortTextSchema = z.string().trim().min(1).max(160);
export const longTextSchema = z.string().trim().max(20_000);

export const percentageSchema = z.number().min(0).max(100);

export function optionalTrimmed(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));
}

export const moduleSchema = z.enum([
  'library',
  'transport',
  'hostel',
  'inventory',
  'homework',
  'online_payments',
]);
