import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Table,
  Td,
  Textarea,
  Th,
  cn,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime } from '../lib/format';
import type { NoticeRow, Paged } from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

const ROLES = [
  { value: 'SCHOOL_ADMIN', label: 'Administrators' },
  { value: 'PRINCIPAL', label: 'Principal' },
  { value: 'TEACHER', label: 'Teachers' },
  { value: 'ACCOUNTANT', label: 'Accounts' },
  { value: 'RECEPTIONIST', label: 'Reception' },
  { value: 'PARENT', label: 'Parents' },
  { value: 'STUDENT', label: 'Students' },
] as const;

const noticeFormSchema = z.object({
  title: z.string().trim().min(3, 'Give the notice a title').max(160),
  body: z.string().trim().min(3, 'Write the notice body').max(20_000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  roles: z.array(z.string()),
});

type NoticeForm = z.infer<typeof noticeFormSchema>;

export function NoticesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('communication:write');
  const canReadStaff = hasPermission('communication:read');
  const canReadPortal = hasPermission('portal:read');

  if (!canReadStaff && !canReadPortal) {
    return (
      <EmptyState
        title="Notices are not available for your role"
        description="Ask a school administrator for communication or portal access."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notices"
        description="School announcements, audiences and delivery"
      />
      {canReadPortal && !canReadStaff ? <PortalNotices /> : <StaffNotices canManage={canManage} />}
      <NotificationsCard />
      <NotificationPreferencesCard />
    </div>
  );
}

function StaffNotices({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [sendNotice, setSendNotice] = useState<NoticeRow | null>(null);
  const [deliveriesNotice, setDeliveriesNotice] = useState<NoticeRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['notices', { page, status, search }],
    queryFn: () =>
      api.get<Paged<NoticeRow>>(
        `/notices${queryString({
          page,
          pageSize: 25,
          status: status || undefined,
          q: search || undefined,
        })}`,
      ),
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/notices/${id}/publish`, {}),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['notices'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) =>
      setActionError(error instanceof ApiError ? error.message : 'Could not publish the notice'),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/notices/${id}/archive`, {}),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['notices'] });
    },
    onError: (error) =>
      setActionError(error instanceof ApiError ? error.message : 'Could not archive the notice'),
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label htmlFor="notice-search">Search</Label>
            <Input
              id="notice-search"
              type="search"
              value={search}
              placeholder="Title or body"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label htmlFor="notice-status">Status</Label>
            <Select
              id="notice-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </div>
        </div>
        {canManage ? <Button onClick={() => setComposeOpen(true)}>New notice</Button> : null}
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}

      {query.isLoading ? (
        <TableSkeleton rows={4} columns={3} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No notices yet"
          description="Publish a notice to reach staff, parents and students in their portals."
          action={
            canManage ? (
              <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
                Write the first notice
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {query.data?.items.map((notice) => {
              const roles =
                (notice.audience as { roles?: string[] } | null)?.roles?.filter(Boolean) ?? [];
              return (
                <Card key={notice.id}>
                  <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{notice.title}</CardTitle>
                      <p className="mt-1 text-xs text-slate-500">
                        {notice.publishedAt
                          ? `Published ${formatDateTime(notice.publishedAt)}`
                          : `Created ${formatDateTime(notice.createdAt)}`}
                        {notice.createdBy ? ` · ${notice.createdBy}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={priorityTone(notice.priority)}>{notice.priority}</Badge>
                      <Badge tone={statusTone(notice.status)}>{notice.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-line text-sm text-slate-700">{notice.body}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {roles.length === 0 ? (
                          <Badge tone="neutral">Everyone</Badge>
                        ) : (
                          roles.map((role) => (
                            <Badge key={role} tone="info">
                              {role.replaceAll('_', ' ').toLowerCase()}
                            </Badge>
                          ))
                        )}
                        {notice.deliveryCount ? (
                          <span className="text-xs text-slate-500">
                            {notice.deliveryCount} deliveries
                          </span>
                        ) : null}
                      </div>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeliveriesNotice(notice)}
                          >
                            Deliveries
                          </Button>
                          {notice.status !== 'ARCHIVED' ? (
                            <Button
                              size="sm"
                              onClick={() => setSendNotice(notice)}
                            >
                              {notice.deliveryCount ? 'Send again' : 'Send'}
                            </Button>
                          ) : null}
                          {notice.status !== 'PUBLISHED' && notice.status !== 'ARCHIVED' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={publish.isPending}
                              onClick={() => publish.mutate(notice.id)}
                            >
                              Publish only
                            </Button>
                          ) : null}
                          {notice.status !== 'ARCHIVED' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={archive.isPending}
                              onClick={() => archive.mutate(notice.id)}
                            >
                              Archive
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Pagination
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? 25}
            total={query.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}

      <ComposeNoticeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
      <SendNoticeModal
        notice={sendNotice}
        onClose={() => setSendNotice(null)}
        onSent={() => {
          void queryClient.invalidateQueries({ queryKey: ['notices'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />
      <DeliveriesModal notice={deliveriesNotice} onClose={() => setDeliveriesNotice(null)} />
    </>
  );
}

const DELIVERY_CHANNELS = [
  { value: 'IN_APP', label: 'In-app' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'PUSH', label: 'Push' },
] as const;

function SendNoticeModal({
  notice,
  onClose,
  onSent,
}: {
  notice: NoticeRow | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const queryClient = useQueryClient();
  const [channels, setChannels] = useState<string[]>(['IN_APP']);
  const [resend, setResend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    recipients: number;
    sent: number;
    failed: number;
    skipped: number;
    alreadySent: boolean;
  } | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api.post<{
        recipients: number;
        sent: number;
        failed: number;
        skipped: number;
        alreadySent: boolean;
      }>(`/notices/${notice?.id}/send`, {
        channels,
        category: 'NOTICE',
        resend,
      }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['notices', notice?.id, 'deliveries'] });
      onSent();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Could not send the notice'),
  });

  function close() {
    setChannels(['IN_APP']);
    setResend(false);
    setResult(null);
    setError(null);
    onClose();
  }

  if (!notice) return null;

  return (
    <Modal
      open={Boolean(notice)}
      title={`Send “${notice.title}”`}
      description="Deliveries are recorded per recipient and channel, and in-app messages land in each portal."
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button
            loading={send.isPending}
            onClick={() => send.mutate()}
            disabled={channels.length === 0}
          >
            {resend ? 'Resend notice' : 'Send notice'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Channels</legend>
          <div className="flex flex-wrap gap-2">
            {DELIVERY_CHANNELS.map((channel) => {
              const checked = channels.includes(channel.value);
              return (
                <label
                  key={channel.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                    checked
                      ? 'border-brand-300 bg-brand-50 text-brand-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() =>
                      setChannels((current) =>
                        current.includes(channel.value)
                          ? current.filter((value) => value !== channel.value)
                          : [...current, channel.value],
                      )
                    }
                  />
                  {channel.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={resend}
            onChange={(event) => setResend(event.target.checked)}
          />
          Send again even if deliveries already exist
        </label>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {result.alreadySent
              ? `Already delivered to ${result.recipients} recipients. Tick “send again” to resend.`
              : `Queued ${result.sent + result.failed + result.skipped} deliveries for ${result.recipients} recipients: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

interface DeliveryRow {
  id: string;
  channel: string;
  recipient: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

function DeliveriesModal({
  notice,
  onClose,
}: {
  notice: NoticeRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notices', notice?.id, 'deliveries'],
    queryFn: () =>
      api.get<{
        items: DeliveryRow[];
        summary: { total: number; sent: number; failed: number; skipped: number; pending: number };
        total: number;
      }>(`/notices/${notice?.id}/deliveries${queryString({ page: 1, pageSize: 100 })}`),
    enabled: Boolean(notice),
  });

  const retry = useMutation({
    mutationFn: (deliveryId: string) =>
      api.post(`/notices/deliveries/${deliveryId}/retry`, {}),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['notices', notice?.id, 'deliveries'] }),
  });

  if (!notice) return null;

  const summary = query.data?.summary;

  return (
    <Modal
      open={Boolean(notice)}
      title={`Deliveries · ${notice.title}`}
      description="Every channel attempt is logged with its provider message id or error."
      onClose={onClose}
      wide
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {query.isLoading ? (
        <TableSkeleton rows={3} columns={4} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="data-grid">
            <Stat label="Total" value={summary?.total ?? 0} />
            <Stat label="Sent" value={summary?.sent ?? 0} />
            <Stat label="Failed" value={summary?.failed ?? 0} />
            <Stat label="Skipped" value={summary?.skipped ?? 0} />
          </div>
          {(query.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">This notice has not been sent yet.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Recipient</Th>
                    <Th>Channel</Th>
                    <Th>Status</Th>
                    <Th>Detail</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.items.map((delivery) => (
                    <tr key={delivery.id}>
                      <Td className="max-w-[220px] truncate font-mono text-xs">{delivery.recipient}</Td>
                      <Td>{delivery.channel}</Td>
                      <Td>
                        <Badge tone={statusTone(delivery.status)}>{delivery.status}</Badge>
                      </Td>
                      <Td className="max-w-[240px] truncate text-xs text-slate-500">
                        {delivery.error ?? (delivery.sentAt ? formatDateTime(delivery.sentAt) : '—')}
                      </Td>
                      <Td className="text-right">
                        {delivery.status === 'FAILED' || delivery.status === 'SKIPPED' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={retry.isPending}
                            onClick={() => retry.mutate(delivery.id)}
                          >
                            Retry
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PortalNotices() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['portal', 'notices', page],
    queryFn: () => api.get<Paged<NoticeRow>>(`/portal/notices${queryString({ page, pageSize: 25 })}`),
  });

  if (query.isLoading) return <TableSkeleton rows={3} columns={2} />;
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if ((query.data?.items.length ?? 0) === 0) {
    return (
      <EmptyState
        title="No notices for you right now"
        description="Notices published by your school will appear here."
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {query.data?.items.map((notice) => (
          <Card key={notice.id}>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{notice.title}</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(notice.publishedAt ?? notice.createdAt)}
                </p>
              </div>
              <Badge tone={priorityTone(notice.priority)}>{notice.priority}</Badge>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm text-slate-700">{notice.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Pagination
        page={query.data?.page ?? page}
        pageSize={query.data?.pageSize ?? 25}
        total={query.data?.total ?? 0}
        onPage={setPage}
      />
    </>
  );
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

function NotificationsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<Paged<NotificationRow> & { unread: number }>(
        `/notifications${queryString({ page: 1, pageSize: 10 })}`,
      ),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (query.isLoading) return <TableSkeleton rows={2} columns={1} />;
  if (query.isError) return <ErrorPanel error={query.error} />;

  const items = query.data?.items ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Your notifications</CardTitle>
        <Badge tone={(query.data?.unread ?? 0) > 0 ? 'warning' : 'neutral'}>
          {query.data?.unread ?? 0} unread
        </Badge>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">You are all caught up.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0',
                  !item.readAt && 'font-medium',
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{item.title}</p>
                  <p className="mt-0.5 text-sm font-normal text-slate-600">{item.body}</p>
                  <p className="mt-1 text-xs font-normal text-slate-500">
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
                {item.readAt ? (
                  <Badge tone="neutral">Read</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={markRead.isPending}
                    onClick={() => markRead.mutate(item.id)}
                  >
                    Mark read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const PREFERENCE_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH'] as const;
const PREFERENCE_CATEGORIES = [
  'NOTICE',
  'FEE',
  'ATTENDANCE',
  'RESULT',
  'ADMISSION',
  'ACCOUNT',
  'GENERAL',
] as const;

interface Preferences {
  channels: Record<string, boolean>;
  categories: Record<string, boolean>;
}

function NotificationPreferencesCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<Preferences>('/notifications/preferences'),
  });

  const save = useMutation({
    mutationFn: (next: Preferences) => api.put<Preferences>('/notifications/preferences', next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  if (query.isLoading) return <TableSkeleton rows={2} columns={3} />;
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;

  function toggle(kind: keyof Preferences, key: string) {
    if (!query.data) return;
    save.mutate({
      ...query.data,
      [kind]: { ...query.data[kind], [key]: !query.data[kind][key] },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Opt out of a channel or category. In-app messages stay available in the portal.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Channels</p>
          <div className="flex flex-wrap gap-2">
            {PREFERENCE_CHANNELS.map((channel) => (
              <label
                key={channel}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                  query.data?.channels[channel]
                    ? 'border-brand-300 bg-brand-50 text-brand-800'
                    : 'border-slate-200 text-slate-500',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={Boolean(query.data?.channels[channel])}
                  disabled={save.isPending || channel === 'IN_APP'}
                  onChange={() => toggle('channels', channel)}
                />
                {channel.replaceAll('_', ' ').toLowerCase()}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Categories</p>
          <div className="flex flex-wrap gap-2">
            {PREFERENCE_CATEGORIES.map((category) => (
              <label
                key={category}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                  query.data?.categories[category]
                    ? 'border-brand-300 bg-brand-50 text-brand-800'
                    : 'border-slate-200 text-slate-500',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={Boolean(query.data?.categories[category])}
                  disabled={save.isPending}
                  onChange={() => toggle('categories', category)}
                />
                {category.toLowerCase()}
              </label>
            ))}
          </div>
        </div>
        {save.isError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {save.error instanceof ApiError
              ? save.error.message
              : 'Could not save notification preferences'}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ComposeNoticeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NoticeForm>({
    resolver: zodResolver(noticeFormSchema),
    defaultValues: {
      title: '',
      body: '',
      priority: 'NORMAL',
      status: 'DRAFT',
      roles: [],
    },
  });

  const selectedRoles = watch('roles');

  function close() {
    reset();
    setServerError(null);
    onClose();
  }

  async function onSubmit(values: NoticeForm) {
    setServerError(null);
    try {
      await api.post('/notices', {
        title: values.title,
        body: values.body,
        priority: values.priority,
        status: values.status,
        audience: values.roles.length > 0 ? { roles: values.roles } : {},
      });
      void queryClient.invalidateQueries({ queryKey: ['notices'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      close();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not save the notice');
    }
  }

  return (
    <Modal
      open={open}
      title="Write a notice"
      description="Save as a draft for review, or publish immediately to the selected audiences."
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="compose-notice-form" loading={isSubmitting}>
            Save notice
          </Button>
        </>
      }
    >
      <form id="compose-notice-form" className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div>
          <Label htmlFor="notice-title">Title</Label>
          <Input id="notice-title" aria-invalid={Boolean(errors.title)} {...register('title')} />
          <FieldError>{errors.title?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="notice-body">Body</Label>
          <Textarea id="notice-body" rows={7} aria-invalid={Boolean(errors.body)} {...register('body')} />
          <FieldError>{errors.body?.message}</FieldError>
        </div>
        <div className="form-grid">
          <div>
            <Label htmlFor="notice-priority">Priority</Label>
            <Select id="notice-priority" {...register('priority')}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="notice-visibility">Visibility</Label>
            <Select id="notice-visibility" {...register('status')}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Publish now</option>
            </Select>
          </div>
        </div>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Audience (leave empty for everyone)
          </legend>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => {
              const checked = selectedRoles.includes(role.value);
              return (
                <label
                  key={role.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                    checked
                      ? 'border-brand-300 bg-brand-50 text-brand-800'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                >
                  <input type="checkbox" value={role.value} className="sr-only" {...register('roles')} />
                  {role.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        {serverError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {serverError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function priorityTone(priority: string): 'danger' | 'warning' | 'info' | 'neutral' {
  if (priority === 'URGENT' || priority === 'HIGH') return 'danger';
  if (priority === 'NORMAL') return 'info';
  return 'neutral';
}
