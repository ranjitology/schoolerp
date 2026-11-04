import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
} from '@schoolerp/ui';
import { api, ApiError } from '../lib/api';
import type { SchoolDetail } from '../lib/types';

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the school name').max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugPattern, 'Use lowercase letters, numbers and hyphens'),
  timezone: z.string().min(1),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a locale such as en-NP'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
  calendarSystem: z.enum(['AD', 'BS']),
  planCode: z.enum(['trial', 'starter', 'growth', 'enterprise']),
  seedSampleData: z.boolean(),
  adminFullName: z.string().trim().min(2, 'Enter the administrator name').max(120),
  adminEmail: z.string().trim().email('Enter a valid email'),
  adminPassword: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(128)
    .refine(
      (value) =>
        [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3,
      'Mix upper case, lower case, numbers or symbols',
    ),
  yearName: z.string().trim().max(20).optional(),
  yearStart: z.string().optional(),
  yearEnd: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function OnboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<SchoolDetail | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      slug: '',
      timezone: 'Asia/Kathmandu',
      locale: 'en-NP',
      currency: 'NPR',
      calendarSystem: 'AD',
      planCode: 'trial',
      seedSampleData: true,
      adminFullName: '',
      adminEmail: '',
      adminPassword: '',
      yearName: '',
      yearStart: '',
      yearEnd: '',
    },
  });

  const name = watch('name');

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<SchoolDetail>('/platform/schools', {
        school: {
          name: values.name,
          slug: values.slug,
          timezone: values.timezone,
          locale: values.locale,
          currency: values.currency,
          calendarSystem: values.calendarSystem,
          planCode: values.planCode,
          seedSampleData: values.seedSampleData,
        },
        admin: {
          fullName: values.adminFullName,
          email: values.adminEmail,
          password: values.adminPassword,
        },
        ...(values.yearName && values.yearStart && values.yearEnd
          ? {
              academicYear: {
                name: values.yearName,
                startDate: values.yearStart,
                endDate: values.yearEnd,
              },
            }
          : {}),
      }),
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const school = await mutation.mutateAsync(values);
      setCreated(school);
      void queryClient.invalidateQueries({ queryKey: ['platform', 'schools'] });
      void queryClient.invalidateQueries({ queryKey: ['platform', 'stats'] });
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not onboard the school');
    }
  }

  function suggestSlug(value: string) {
    if (!value) return;
    const current = watch('slug');
    if (current && current !== slugify(name)) return;
    setValue('slug', slugify(value), { shouldValidate: true });
  }

  if (created) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="School onboarded" description="The tenant is ready for its first sign-in." />
        <Card>
          <CardHeader>
            <CardTitle>{created.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              Subdomain <span className="font-mono text-xs">{created.slug}</span> · plan{' '}
              {created.plan?.name ?? 'Trial'}
            </p>
            <p>
              The school administrator must sign in at the tenant URL and change the temporary
              password immediately. If two-factor is required by policy, it is prompted on first
              login.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link to={`/schools/${created.id}`}>
                <Button>Open tenant record</Button>
              </Link>
              <Button variant="outline" onClick={() => setCreated(null)}>
                Onboard another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboard a school"
        description="Creates the tenant, starter academic structure, roles and the first administrator."
      />

      <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>School</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="form-grid">
              <div>
                <Label htmlFor="name">School name</Label>
                <Input
                  id="name"
                  aria-invalid={Boolean(errors.name)}
                  {...register('name', { onChange: (event) => suggestSlug(event.target.value) })}
                />
                <FieldError>{errors.name?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="slug">Subdomain</Label>
                <Input
                  id="slug"
                  placeholder="green-valley"
                  aria-invalid={Boolean(errors.slug)}
                  {...register('slug')}
                />
                <FieldError>{errors.slug?.message}</FieldError>
                <p className="mt-1 text-xs text-slate-500">Tenant URL: https://{watch('slug') || 'slug'}.schoolerp.app</p>
              </div>
            </div>

            <div className="form-grid">
              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <Input id="timezone" aria-invalid={Boolean(errors.timezone)} {...register('timezone')} />
                <FieldError>{errors.timezone?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="locale">Locale</Label>
                <Input id="locale" aria-invalid={Boolean(errors.locale)} {...register('locale')} />
                <FieldError>{errors.locale?.message}</FieldError>
              </div>
            </div>

            <div className="form-grid">
              <div>
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" aria-invalid={Boolean(errors.currency)} {...register('currency')} />
                <FieldError>{errors.currency?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="calendarSystem">Calendar</Label>
                <Select id="calendarSystem" {...register('calendarSystem')}>
                  <option value="AD">AD (Gregorian)</option>
                  <option value="BS">BS (Bikram Sambat)</option>
                </Select>
              </div>
            </div>

            <div className="form-grid">
              <div>
                <Label htmlFor="planCode">Plan</Label>
                <Select id="planCode" {...register('planCode')}>
                  <option value="trial">Trial</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="enterprise">Enterprise</option>
                </Select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register('seedSampleData')} />
                Seed sample classes, subjects and grading
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>First administrator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="form-grid">
              <div>
                <Label htmlFor="adminFullName">Full name</Label>
                <Input
                  id="adminFullName"
                  aria-invalid={Boolean(errors.adminFullName)}
                  {...register('adminFullName')}
                />
                <FieldError>{errors.adminFullName?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="adminEmail">Email</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.adminEmail)}
                  {...register('adminEmail')}
                />
                <FieldError>{errors.adminEmail?.message}</FieldError>
              </div>
            </div>
            <div>
              <Label htmlFor="adminPassword">Temporary password</Label>
              <Input
                id="adminPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.adminPassword)}
                {...register('adminPassword')}
              />
              <FieldError>{errors.adminPassword?.message}</FieldError>
              <p className="mt-1 text-xs text-slate-500">
                At least 10 characters with three of upper, lower, number or symbol. The user is forced
                to change it on first login.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Academic year (optional)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-slate-500">
              Leave blank to start the current year automatically.
            </p>
            <div className="form-grid">
              <div>
                <Label htmlFor="yearName">Name</Label>
                <Input id="yearName" placeholder="2083" {...register('yearName')} />
              </div>
              <div>
                <Label htmlFor="yearStart">Start date</Label>
                <Input id="yearStart" type="date" {...register('yearStart')} />
              </div>
              <div>
                <Label htmlFor="yearEnd">End date</Label>
                <Input id="yearEnd" type="date" {...register('yearEnd')} />
              </div>
            </div>
          </CardContent>
        </Card>

        {serverError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {serverError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            Create school
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/schools')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}
