import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Textarea,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import type { Paged, PlatformAnnouncement, SchoolRow } from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

const schema = z.object({
  title: z.string().trim().min(3, 'Give the announcement a title').max(160),
  body: z.string().trim().min(3, 'Write the announcement').max(5000),
  audience: z.enum(['ALL', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'SELECTED']),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  schoolIds: z.array(z.string()),
  publishAt: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function AnnouncementsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);
  const canCreate = user?.role === 'SUPER_ADMIN';

  const query = useQuery({
    queryKey: ['platform', 'announcements', page],
    queryFn: () =>
      api.get<Paged<PlatformAnnouncement>>(
        `/platform/announcements${queryString({ page, pageSize: 25 })}`,
      ),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform announcements"
        description="Messages delivered to tenant administrators from the control plane."
        actions={
          canCreate ? <Button onClick={() => setComposeOpen(true)}>New announcement</Button> : undefined
        }
      />

      {query.isLoading ? (
        <TableSkeleton rows={5} columns={3} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No announcements"
          description="Publish a maintenance window or policy notice to keep schools informed."
          action={
            canCreate ? (
              <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
                Write the first announcement
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {query.data?.items.map((item) => (
              <Card key={item.id}>
                <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{item.title}</CardTitle>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(item.publishAt)}
                      {item.expiresAt ? ` · expires ${formatDateTime(item.expiresAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
                    <Badge tone="info">
                      {item.audience === 'SELECTED'
                        ? `${item.schoolIds.length} schools`
                        : item.audience}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-line text-sm text-slate-700">{item.body}</p>
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
      )}

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: ['platform', 'announcements'] });
          setComposeOpen(false);
        }}
      />
    </div>
  );
}

function ComposeModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      body: '',
      audience: 'ALL',
      severity: 'INFO',
      schoolIds: [],
      publishAt: '',
    },
  });

  const audience = watch('audience');
  const selected = watch('schoolIds');
  const schoolsQuery = useQuery({
    queryKey: ['platform', 'schools', 'picker'],
    queryFn: () => api.get<Paged<SchoolRow>>(`/platform/schools${queryString({ page: 1, pageSize: 100 })}`),
    enabled: open && audience === 'SELECTED',
  });

  function close() {
    reset();
    setServerError(null);
    onClose();
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await api.post('/platform/announcements', {
        title: values.title,
        body: values.body,
        audience: values.audience,
        severity: values.severity,
        schoolIds: values.audience === 'SELECTED' ? values.schoolIds : [],
        ...(values.publishAt ? { publishAt: new Date(values.publishAt).toISOString() } : {}),
      });
      onSaved();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not publish the announcement');
    }
  }

  return (
    <Modal
      open={open}
      title="New announcement"
      description="Shown to tenant administrators on their dashboard."
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="announcement-form" loading={isSubmitting}>
            Publish
          </Button>
        </>
      }
    >
      <form id="announcement-form" className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div>
          <Label htmlFor="announcement-title">Title</Label>
          <Input
            id="announcement-title"
            aria-invalid={Boolean(errors.title)}
            {...register('title')}
          />
          <FieldError>{errors.title?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="announcement-body">Body</Label>
          <Textarea
            id="announcement-body"
            rows={6}
            aria-invalid={Boolean(errors.body)}
            {...register('body')}
          />
          <FieldError>{errors.body?.message}</FieldError>
        </div>
        <div className="form-grid">
          <div>
            <Label htmlFor="announcement-audience">Audience</Label>
            <Select id="announcement-audience" {...register('audience')}>
              <option value="ALL">All tenants</option>
              <option value="TRIAL">Trial tenants</option>
              <option value="ACTIVE">Active tenants</option>
              <option value="SUSPENDED">Suspended tenants</option>
              <option value="SELECTED">Selected schools</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="announcement-severity">Severity</Label>
            <Select id="announcement-severity" {...register('severity')}>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="announcement-publishAt">Publish at (optional)</Label>
          <Input id="announcement-publishAt" type="datetime-local" {...register('publishAt')} />
          <p className="mt-1 text-xs text-slate-500">Leave blank to publish immediately.</p>
        </div>

        {audience === 'SELECTED' ? (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">Schools</legend>
            {schoolsQuery.isLoading ? (
              <p className="text-sm text-slate-500">Loading schools…</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {schoolsQuery.data?.items.map((school) => (
                  <label key={school.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={selected.includes(school.id)}
                      onChange={(event) =>
                        setValue(
                          'schoolIds',
                          event.target.checked
                            ? [...selected, school.id]
                            : selected.filter((id) => id !== school.id),
                        )
                      }
                    />
                    {school.name}
                    <span className="font-mono text-xs text-slate-400">{school.slug}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ) : null}

        {serverError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {serverError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function severityTone(severity: string): 'info' | 'warning' | 'danger' {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'WARNING') return 'warning';
  return 'info';
}
