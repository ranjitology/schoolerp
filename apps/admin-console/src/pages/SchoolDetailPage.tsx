import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format';
import type { SchoolDetail } from '../lib/types';
import { ErrorPanel, Field } from '../components/Feedback';
import { Modal } from '../components/Modal';

const updateSchema = z.object({
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']),
  planCode: z.enum(['trial', 'starter', 'growth', 'enterprise']),
  reason: z.string().trim().min(5, 'Record why this change was made').max(500),
});

type UpdateForm = z.infer<typeof updateSchema>;

export function SchoolDetailPage() {
  const { schoolId = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING';

  const query = useQuery({
    queryKey: ['platform', 'school', schoolId],
    queryFn: () => api.get<SchoolDetail>(`/platform/schools/${schoolId}`),
    enabled: Boolean(schoolId),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (query.isError) {
    return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  }

  const school = query.data;
  if (!school) return <EmptyState title="School not found" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={school.name}
        description={`Tenant ${school.slug} · ${school.timezone} · ${school.currency}`}
        actions={
          <>
            <Link to="/schools">
              <Button variant="ghost" size="sm">
                Back to schools
              </Button>
            </Link>
            {user?.role === 'SUPER_ADMIN' ? (
              <Button variant="outline" size="sm" onClick={() => setImpersonateOpen(true)}>
                Impersonate user
              </Button>
            ) : null}
            {canEdit ? (
              <Button size="sm" onClick={() => setEditOpen(true)}>
                Manage tenant
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>Tenant profile</CardTitle>
            <Badge tone={statusTone(school.status)}>{school.status}</Badge>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Subdomain">
                <span className="font-mono text-xs">{school.slug}</span>
              </Field>
              <Field label="Plan">{school.plan?.name ?? '—'}</Field>
              <Field label="Currency">{school.currency}</Field>
              <Field label="Locale">{school.locale}</Field>
              <Field label="Calendar">{school.calendarSystem}</Field>
              <Field label="Trial ends">{formatDate(school.trialEndsAt)}</Field>
              <Field label="Created">{formatDateTime(school.createdAt)}</Field>
              <Field label="Updated">{formatDateTime(school.updatedAt)}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Students">{formatNumber(school._count.students)}</Field>
              <Field label="Staff">{formatNumber(school._count.staff)}</Field>
            </dl>
            {school.limitsOverride && Object.keys(school.limitsOverride).length > 0 ? (
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">Limit overrides</p>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(school.limitsOverride).map(([key, value]) => (
                    <li key={key}>
                      {key}: {formatNumber(value)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-500">Plan limits apply without overrides.</p>
            )}
            {school.modulesOverride && Object.keys(school.modulesOverride).length > 0 ? (
              <div className="mt-3 rounded-lg bg-sky-50 p-3 text-xs text-sky-900">
                <p className="font-semibold">Module overrides</p>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(school.modulesOverride).map(([key, value]) => (
                    <li key={key}>
                      {key}: {value ? 'enabled' : 'disabled'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            {school.subscription ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Status">
                  <Badge tone={statusTone(school.subscription.status)}>
                    {school.subscription.status}
                  </Badge>
                </Field>
                <Field label="Renews">{formatDate(school.subscription.currentPeriodEnd)}</Field>
                <Field label="Period start">{formatDate(school.subscription.currentPeriodStart)}</Field>
                <Field label="Cancel at period end">
                  {school.subscription.cancelAtPeriodEnd ? 'Yes' : 'No'}
                </Field>
              </dl>
            ) : (
              <EmptyState title="No subscription record" description="Tenant is on the trial plan." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan limits</CardTitle>
          </CardHeader>
          <CardContent>
            {school.plan ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Plan">{school.plan.name}</Field>
                <Field label="Price">
                  {formatMoney(school.plan.priceMinor, school.plan.currency)} /{' '}
                  {school.plan.interval.toLowerCase()}
                </Field>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No plan attached.</p>
            )}
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              {JSON.stringify(school.plan?.limits ?? {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      {school.settings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>School settings snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {school.settings.map((setting) => (
                <Field key={setting.id} label={setting.key}>
                  <span className="font-mono text-xs">{JSON.stringify(setting.value)}</span>
                </Field>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <ManageTenantModal
        open={editOpen}
        school={school}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['platform', 'school', schoolId] });
          void queryClient.invalidateQueries({ queryKey: ['platform', 'schools'] });
          void queryClient.invalidateQueries({ queryKey: ['platform', 'stats'] });
          setEditOpen(false);
        }}
      />

      <ImpersonateModal
        open={impersonateOpen}
        schoolId={school.id}
        onClose={() => setImpersonateOpen(false)}
      />
    </div>
  );
}

function ManageTenantModal({
  open,
  school,
  onClose,
  onSaved,
}: {
  open: boolean;
  school: SchoolDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateForm>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      status: school.status,
      planCode: (school.plan?.code as UpdateForm['planCode'] | undefined) ?? 'trial',
      reason: '',
    },
  });

  function close() {
    reset();
    setServerError(null);
    onClose();
  }

  async function onSubmit(values: UpdateForm) {
    setServerError(null);
    try {
      await api.patch(`/platform/schools/${school.id}`, values);
      onSaved();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not update the tenant');
    }
  }

  return (
    <Modal
      open={open}
      title={`Manage ${school.name}`}
      description="Changes are written to the platform audit log with your reason."
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="manage-tenant-form" loading={isSubmitting}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="manage-tenant-form" className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="form-grid">
          <div>
            <Label htmlFor="tenant-status">Status</Label>
            <Select id="tenant-status" {...register('status')}>
              <option value="TRIAL">Trial</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="tenant-plan">Plan</Label>
            <Select id="tenant-plan" {...register('planCode')}>
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="tenant-reason">Reason for change</Label>
          <Textarea
            id="tenant-reason"
            rows={4}
            placeholder="Ticket reference, billing decision or suspension reason"
            aria-invalid={Boolean(errors.reason)}
            {...register('reason')}
          />
          <FieldError>{errors.reason?.message}</FieldError>
        </div>
        {serverError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {serverError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

const impersonateSchema = z.object({
  targetUserId: z.string().uuid('Enter the tenant user UUID'),
  reason: z.string().trim().min(10, 'Describe why access is required').max(500),
  consentRef: z.string().trim().min(3, 'Enter the school consent or ticket reference').max(120),
  totpCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

type ImpersonateForm = z.infer<typeof impersonateSchema>;

function ImpersonateModal({
  open,
  schoolId,
  onClose,
}: {
  open: boolean;
  schoolId: string;
  onClose: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accessToken: string; expiresAt: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImpersonateForm>({
    resolver: zodResolver(impersonateSchema),
    defaultValues: { targetUserId: '', reason: '', consentRef: '', totpCode: '' },
  });

  function close() {
    reset();
    setServerError(null);
    setResult(null);
    onClose();
  }

  async function onSubmit(values: ImpersonateForm) {
    setServerError(null);
    try {
      const response = await api.post<{ accessToken: string; expiresAt: string }>(
        `/platform/schools/${schoolId}/impersonate`,
        values,
      );
      setResult(response);
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not start impersonation');
    }
  }

  return (
    <Modal
      open={open}
      title="Start impersonation"
      description="Time-boxed, consent-referenced access. The session is visible to the tenant in its audit log."
      onClose={close}
      wide
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="impersonate-form" loading={isSubmitting}>
              Start session
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
            Impersonation session created. It expires {formatDateTime(result.expiresAt)}.
          </p>
          <p className="text-slate-600">
            Hand the token to the support tooling or open the tenant app and use the console network
            panel. Treat this token as a password.
          </p>
          <textarea
            readOnly
            className="h-32 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
            value={result.accessToken}
          />
        </div>
      ) : (
        <form id="impersonate-form" className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div>
            <Label htmlFor="targetUserId">Target user ID</Label>
            <Input
              id="targetUserId"
              placeholder="UUID from the school's user list"
              aria-invalid={Boolean(errors.targetUserId)}
              {...register('targetUserId')}
            />
            <FieldError>{errors.targetUserId?.message}</FieldError>
          </div>
          <div className="form-grid">
            <div>
              <Label htmlFor="consentRef">Consent / ticket reference</Label>
              <Input
                id="consentRef"
                aria-invalid={Boolean(errors.consentRef)}
                {...register('consentRef')}
              />
              <FieldError>{errors.consentRef?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="totpCode">Authenticator code</Label>
              <Input
                id="totpCode"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={Boolean(errors.totpCode)}
                {...register('totpCode')}
              />
              <FieldError>{errors.totpCode?.message}</FieldError>
            </div>
          </div>
          <div>
            <Label htmlFor="impersonate-reason">Reason</Label>
            <Textarea
              id="impersonate-reason"
              rows={3}
              aria-invalid={Boolean(errors.reason)}
              {...register('reason')}
            />
            <FieldError>{errors.reason?.message}</FieldError>
          </div>
          {serverError ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {serverError}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
