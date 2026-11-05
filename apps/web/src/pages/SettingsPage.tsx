import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudOff, KeyRound, Laptop, RefreshCw, ShieldCheck } from 'lucide-react';
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
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { ErrorPanel } from '../components/Feedback';

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

interface SyncConflictPayload {
  serverStatus?: string;
  serverRemark?: string | null;
  clientStatus?: string;
  clientRemark?: string | null;
}

interface SyncConflictRow {
  id: string;
  deviceId: string;
  entity: string;
  resolution: 'PENDING' | 'SERVER_WINS' | 'CLIENT_WINS' | 'DISMISSED';
  payload: SyncConflictPayload | null;
  createdAt: string;
}

interface SyncBatchRow {
  id: string;
  deviceId: string;
  status: string;
  applied: number;
  skipped: number;
  conflicts: number;
  createdAt: string;
}

interface SyncConflictsResponse {
  items: SyncConflictRow[];
  total: number;
  pending: number;
  batches: SyncBatchRow[];
}

interface AccountResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    roleCode: string;
    permissions: string[];
    actorType: string;
    impersonationId?: string;
  };
  school: {
    id: string;
    slug: string;
    name: string;
    status: string;
    currency: string;
    timezone: string;
    locale: string;
  };
}

export function SettingsPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const accountQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<AccountResponse>('/auth/me'),
  });

  function changeLanguage(language: string) {
    void i18n.changeLanguage(language);
    localStorage.setItem('erp.locale', language);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your account, school profile and security controls"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label="Name">{user?.fullName ?? '—'}</Row>
              <Row label="Email">{user?.email ?? '—'}</Row>
              <Row label="Role">
                <Badge tone="info">{user?.roleCode.replaceAll('_', ' ').toLowerCase() ?? '—'}</Badge>
              </Row>
              <Row label="Two-factor">
                {user?.twoFactorEnabled ? (
                  <Badge tone="success">Enabled</Badge>
                ) : (
                  <Badge tone="warning">Not enabled</Badge>
                )}
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>School</CardTitle>
          </CardHeader>
          <CardContent>
            {accountQuery.isLoading ? (
              <Skeleton className="h-28" />
            ) : accountQuery.isError ? (
              <ErrorPanel error={accountQuery.error} onRetry={() => void accountQuery.refetch()} />
            ) : accountQuery.data ? (
              <dl className="space-y-3 text-sm">
                <Row label="Name">{accountQuery.data.school.name}</Row>
                <Row label="Subdomain">
                  <span className="font-mono text-xs">{accountQuery.data.school.slug}</span>
                </Row>
                <Row label="Status">
                  <Badge tone={statusTone(accountQuery.data.school.status)}>
                    {accountQuery.data.school.status}
                  </Badge>
                </Row>
                <Row label="Currency">{accountQuery.data.school.currency}</Row>
                <Row label="Timezone">{accountQuery.data.school.timezone}</Row>
                <Row label="Locale">{accountQuery.data.school.locale}</Row>
              </dl>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="settings-language">Language</Label>
              <Select
                id="settings-language"
                value={i18n.language}
                onChange={(event) => changeLanguage(event.target.value)}
              >
                <option value="en">English</option>
                <option value="ne">नेपाली</option>
              </Select>
              <p className="mt-1 text-xs text-slate-500">
                Your choice is stored on this device. School-wide defaults are managed by your
                administrator.
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-800">{t('appName')} cloud</p>
              <p className="mt-1">
                School configuration, fee structures and academic years are managed from the school
                administration workspace.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PasswordCard />
        <TwoFactorCard enabled={Boolean(user?.twoFactorEnabled)} />
      </div>

      <SessionsCard />

      {user?.permissions.includes('attendance:read') ? <SyncCard /> : null}
    </div>
  );
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(128)
      .refine(
        (value) =>
          [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3,
        'Mix upper case, lower case, numbers or symbols',
      ),
    confirmPassword: z.string().min(1, 'Confirm the new password'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

function PasswordCard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: PasswordForm) {
    setServerError(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset();
      setDone(true);
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not change your password');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Password
        </CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Changing your password signs out every device using the current refresh token.
        </p>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div>
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.currentPassword)}
              {...register('currentPassword')}
            />
            <FieldError>{errors.currentPassword?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.newPassword)}
              {...register('newPassword')}
            />
            <FieldError>{errors.newPassword?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.confirmPassword)}
              {...register('confirmPassword')}
            />
            <FieldError>{errors.confirmPassword?.message}</FieldError>
          </div>

          {serverError ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {serverError}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Password updated. Please sign in again.
            </p>
          ) : null}

          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function beginSetup() {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup');
      setSetup(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start two-factor setup');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/2fa/confirm', { code });
      setSetup(null);
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not confirm the code');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/2fa/disable', { password, code: disableCode });
      setPassword('');
      setDisableCode('');
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not disable two-factor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Two-factor authentication
        </CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Time-based one-time codes from any authenticator app. Recommended for every staff account.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {enabled ? (
          <div className="space-y-3">
            <Badge tone="success">Two-factor is on</Badge>
            <div>
              <Label htmlFor="disable-password">Password</Label>
              <Input
                id="disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="disable-code">Current 6-digit code</Label>
              <Input
                id="disable-code"
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              loading={busy}
              disabled={!password || disableCode.length !== 6}
              onClick={() => void disable()}
            >
              Disable two-factor
            </Button>
          </div>
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Add this secret to your authenticator app, then enter the generated code.
            </p>
            <div className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
              {setup.secret}
            </div>
            <div>
              <Label htmlFor="totp-code">6-digit code</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSetup(null)}>
                Cancel
              </Button>
              <Button loading={busy} disabled={code.length !== 6} onClick={() => void confirmSetup()}>
                Confirm and enable
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Badge tone="warning">Two-factor is off</Badge>
            <p className="text-sm text-slate-600">
              Protect attendance, fees and student records with a second factor.
            </p>
            <Button loading={busy} onClick={() => void beginSetup()}>
              Set up two-factor
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<SessionRow[]>('/auth/sessions'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Laptop className="h-4 w-4 text-slate-500" aria-hidden="true" />
          Active sessions
        </CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Refresh tokens that can still start a new session. Revoke anything you do not recognise.
        </p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-24" />
        ) : query.isError ? (
          <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data?.length ?? 0) === 0 ? (
          <EmptyState title="No active sessions" description="Sign in again to start a session." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data?.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {session.userAgent ?? 'Unknown device'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {session.ip ?? 'Unknown IP'} · started {formatDateTime(session.createdAt)} · expires{' '}
                    {formatDateTime(session.expiresAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoke.isPending}
                  onClick={() => revoke.mutate(session.id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SyncCard() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['sync', 'conflicts'],
    queryFn: () => api.get<SyncConflictsResponse>('/sync/conflicts'),
  });

  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      api.post(`/sync/conflicts/${id}/resolve`, { resolution }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['sync', 'conflicts'] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Could not resolve the conflict'),
  });

  const items = query.data?.items ?? [];
  const pending = query.data?.pending ?? 0;
  const batches = query.data?.batches ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CloudOff className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Offline attendance sync
          </CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Batches uploaded from the desktop and mobile apps, and any edits that need a reviewer.
          </p>
        </div>
        <Badge tone={pending > 0 ? 'warning' : 'success'}>
          {pending > 0 ? `${pending} conflict${pending === 1 ? '' : 's'}` : 'All synced'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {query.isLoading ? (
          <Skeleton className="h-24" />
        ) : query.isError ? (
          <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No sync conflicts"
            description="Offline attendance batches have all been accepted. Conflicts appear here when a device edit disagrees with the server."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((conflict) => {
              const canResolve = conflict.resolution === 'PENDING';
              return (
                <li
                  key={conflict.id}
                  className="rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">
                      {conflict.entity.toLowerCase()} · device {conflict.deviceId.slice(0, 12)}
                    </p>
                    <Badge tone={conflict.resolution === 'PENDING' ? 'warning' : 'neutral'}>
                      {conflict.resolution.replaceAll('_', ' ').toLowerCase()}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                    <p>
                      <span className="font-medium text-slate-700">Server:</span>{' '}
                      {conflict.payload?.serverStatus ?? '—'}
                      {conflict.payload?.serverRemark ? ` (${conflict.payload.serverRemark})` : ''}
                    </p>
                    <p>
                      <span className="font-medium text-slate-700">Device:</span>{' '}
                      {conflict.payload?.clientStatus ?? '—'}
                      {conflict.payload?.clientRemark ? ` (${conflict.payload.clientRemark})` : ''}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Received {formatDateTime(conflict.createdAt)}
                  </p>
                  {canResolve ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={resolve.isPending}
                        onClick={() => resolve.mutate({ id: conflict.id, resolution: 'SERVER_WINS' })}
                      >
                        Keep server
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={resolve.isPending}
                        onClick={() => resolve.mutate({ id: conflict.id, resolution: 'CLIENT_WINS' })}
                      >
                        Keep device
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={resolve.isPending}
                        onClick={() => resolve.mutate({ id: conflict.id, resolution: 'DISMISSED' })}
                      >
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div>
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Recent batches
          </p>
          {batches.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No offline batches have been uploaded yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {batches.slice(0, 5).map((batch) => (
                <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-800">{batch.deviceId}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(batch.createdAt)} · applied {batch.applied}, skipped{' '}
                      {batch.skipped}, conflicts {batch.conflicts}
                    </p>
                  </div>
                  <Badge tone={batch.conflicts > 0 ? 'warning' : 'success'}>{batch.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-800">{children}</dd>
    </div>
  );
}
