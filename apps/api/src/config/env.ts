import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://erp_app:erp_app@localhost:5432/schoolerp'),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-32chars'),
  JWT_REFRESH_PEPPER: z.string().min(16).default('dev-only-refresh-pepper-change-me'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PLATFORM_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
  IMPERSONATION_TTL_SECONDS: z.coerce.number().int().min(60).max(7200).default(1800),
  BASE_DOMAIN: z.string().default(''),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOW_TENANT_HEADER: bool.default('true'),
  TRUST_PROXY: bool.default('false'),
  SENTRY_DSN: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('schoolerp'),
  S3_PUBLIC_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_ACCESS_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_ACCESS_SECRET must be set in production');
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
