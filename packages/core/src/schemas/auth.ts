import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email('Enter a valid email address');

/**
 * Strength is enforced whenever a password is *set*, not on login (so legacy
 * passwords still authenticate and can be upgraded after verification).
 */
export const newPasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine(
    (value) =>
      [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3,
    'Mix upper case, lower case, numbers or symbols',
  );

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const platformLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: newPasswordSchema,
});

export const enableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
});

export const confirmTwoFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
});

export const refreshTokenSchema = z.object({
  // Opaque token; sent by the API as an HttpOnly cookie, accepted in the body
  // only for the desktop client where cookies are not available.
  refreshToken: z.string().min(40).max(200).optional(),
});

export const sessionIdSchema = z.object({ id: z.string().uuid() });

export type TokenPair = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
};

export interface AuthenticatedUser {
  id: string;
  schoolId: string;
  schoolSlug: string;
  email: string;
  fullName: string;
  roleCode: string;
  permissions: string[];
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  avatarKey?: string | null;
}
