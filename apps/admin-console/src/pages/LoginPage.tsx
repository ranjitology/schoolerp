import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { Button, FieldError, Input, Label } from '@schoolerp/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const schema = z.object({
  email: z.string().trim().email('Enter your platform email'),
  password: z.string().min(1, 'Enter your password'),
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .or(z.literal(''))
    .optional(),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', totpCode: '' },
  });

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await login({
        email: values.email,
        password: values.password,
        ...(values.totpCode ? { totpCode: values.totpCode } : {}),
      });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsTotp(true);
        setServerError('Enter the 6-digit code from your authenticator app.');
        return;
      }
      setServerError(error instanceof ApiError ? error.message : 'Sign in failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-sm font-bold text-white ring-1 ring-white/20">
            SA
          </span>
          <div>
            <p className="text-lg font-semibold text-white">SchoolERP platform console</p>
            <p className="text-sm text-slate-400">Restricted to platform operators</p>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tenant administration, impersonation and billing controls are audited.
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
              <FieldError>{errors.email?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
              <FieldError>{errors.password?.message}</FieldError>
            </div>
            {needsTotp ? (
              <div>
                <Label htmlFor="totpCode">Authenticator code</Label>
                <Input
                  id="totpCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-invalid={Boolean(errors.totpCode)}
                  {...register('totpCode')}
                />
                <FieldError>{errors.totpCode?.message}</FieldError>
              </div>
            ) : null}

            {serverError ? (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {serverError}
              </p>
            ) : null}

            <Button type="submit" className="w-full" loading={isSubmitting}>
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Sign in to console
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Access tokens are short-lived and every action is written to the platform audit log.
        </p>
      </div>
    </div>
  );
}
