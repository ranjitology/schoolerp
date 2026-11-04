import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, FieldError, Input, Label } from '@schoolerp/ui';
import { useAuth } from '../lib/auth';
import { ApiError, getTenantSlug, setTenantSlug } from '../lib/api';

const loginSchema = z.object({
  schoolSlug: z
    .string()
    .trim()
    .min(2, 'Enter your school subdomain')
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Use lower-case letters, numbers and hyphens'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  totpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code')
    .optional()
    .or(z.literal('')),
});

type LoginForm = z.infer<typeof loginSchema>;

const DEMO_ACCOUNTS = [
  { label: 'School admin', email: 'admin@greenvalley.edu.np', password: 'SchoolAdmin#2026' },
  { label: 'Teacher', email: 'teacher@greenvalley.edu.np', password: 'Teacher#2026' },
  { label: 'Accountant', email: 'accounts@greenvalley.edu.np', password: 'Accounts#2026' },
  { label: 'Parent', email: 'parent@greenvalley.edu.np', password: 'Parent#2026' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      schoolSlug: getTenantSlug(),
      email: '',
      password: '',
      totpCode: '',
    },
  });

  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  async function onSubmit(values: LoginForm) {
    setServerError(null);
    try {
      await login({
        schoolSlug: values.schoolSlug,
        email: values.email,
        password: values.password,
        ...(values.totpCode ? { totpCode: values.totpCode } : {}),
      });
      setTenantSlug(values.schoolSlug);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsTotp(true);
        setServerError('Enter the 6-digit code from your authenticator app.');
        return;
      }
      setServerError(
        error instanceof ApiError ? error.message : 'Unable to sign in. Please try again.',
      );
    }
  }

  function fillDemo(email: string, password: string) {
    setValue('schoolSlug', 'green-valley');
    setValue('email', email);
    setValue('password', password);
    setServerError(null);
  }

  return (
    <div className="grid min-h-screen bg-slate-50 lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-700 p-10 text-white lg:flex">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-200">
            SchoolERP Cloud
          </p>
          <h1 className="mt-6 max-w-md text-3xl font-semibold leading-tight">
            One platform for every school, with data kept strictly separate.
          </h1>
          <p className="mt-4 max-w-md text-sm text-brand-100">
            Admissions, attendance, timetable, exams, fees and parent communication — built for
            multi-tenant schools with row-level security.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 border-t border-brand-500/60 pt-6 text-sm">
          <div>
            <dt className="text-brand-200">Tenants</dt>
            <dd className="mt-1 text-lg font-semibold">150</dd>
          </div>
          <div>
            <dt className="text-brand-200">Target p95</dt>
            <dd className="mt-1 text-lg font-semibold">&lt; 300 ms</dd>
          </div>
          <div>
            <dt className="text-brand-200">Isolation</dt>
            <dd className="mt-1 text-lg font-semibold">RLS</dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              E
            </span>
            <span className="text-lg font-semibold text-slate-900">SchoolERP</span>
          </div>

          <Card className="p-6">
            <h2 className="text-xl font-semibold text-slate-900">Sign in to your school</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use the subdomain assigned to your school. Ask your administrator if you are unsure.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div>
                <Label htmlFor="schoolSlug">School subdomain</Label>
                <Input
                  id="schoolSlug"
                  autoComplete="organization"
                  placeholder="green-valley"
                  aria-invalid={Boolean(errors.schoolSlug)}
                  {...register('schoolSlug')}
                />
                <FieldError>{errors.schoolSlug?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@school.edu.np"
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
                Sign in
              </Button>
            </form>
          </Card>

          <Card className="mt-4 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Demo tenants
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Seeded by <code>pnpm db:seed</code>. The password is shown only in development
              documentation — change it before production.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => fillDemo(account.email, account.password)}
                  className="rounded-lg border border-slate-200 px-2 py-2 text-left text-xs hover:border-brand-300 hover:bg-brand-50"
                >
                  <span className="block font-medium text-slate-800">{account.label}</span>
                  <span className="block truncate text-slate-500">{account.email}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
