import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Badge,
  Button,
  EmptyState,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
  cn,
  statusTone,
} from '@schoolerp/ui';
import { api, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';
import type {
  Paged,
  StudentRow,
  TransportAssignmentRow,
  TransportRouteRow,
  TransportSummary,
} from '../lib/types';
import { ErrorPanel, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

type Tab = 'routes' | 'assignments';

const routeSchema = z.object({
  name: z.string().trim().min(1, 'Route name is required').max(120),
  vehicleNo: z.string().trim().min(1, 'Vehicle number is required').max(40),
  driverName: z.string().trim().min(1, 'Driver name is required').max(120),
  driverPhone: z.string().trim().min(7, 'Driver phone is required').max(24),
  fare: z.string().trim().min(1, 'Monthly fare is required'),
  stops: z.string().trim().max(1000).optional(),
  active: z.enum(['true', 'false']),
});

type RouteForm = z.infer<typeof routeSchema>;

const assignSchema = z.object({
  routeId: z.string().min(1, 'Select a route'),
  studentId: z.string().min(1, 'Select a student'),
  stop: z.string().trim().min(1, 'Stop is required').max(120),
});

type AssignForm = z.infer<typeof assignSchema>;

export function TransportPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('routes');
  const [search, setSearch] = useState('');
  const [routeOpen, setRouteOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['transport', 'summary'],
    queryFn: () => api.get<TransportSummary>('/transport/summary'),
  });

  const routesQuery = useQuery({
    queryKey: ['transport', 'routes', search],
    queryFn: () =>
      api.get<TransportRouteRow[]>(`/transport/routes${queryString({ q: search || undefined })}`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['transport'] });
  }

  const routes = routesQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Transport"
        description="Routes, vehicles, drivers and student assignments"
        actions={
          hasPermission('transport:write') ? (
            <>
              <Button variant="outline" onClick={() => setAssignOpen(true)}>
                Assign student
              </Button>
              <Button onClick={() => setRouteOpen(true)}>Add route</Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6">
        <StatGrid>
          <StatCard label="Routes" value={summaryQuery.data?.routes ?? '—'} />
          <StatCard label="Active routes" value={summaryQuery.data?.activeRoutes ?? '—'} tone="positive" />
          <StatCard label="Students assigned" value={summaryQuery.data?.assignments ?? '—'} />
          <StatCard
            label="Monthly fares"
            value={formatMoney(summaryQuery.data?.monthlyFareMinor ?? 0)}
          />
        </StatGrid>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['routes', 'Routes'],
            ['assignments', 'Student assignments'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'routes' ? (
        <>
          <div className="mb-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search route, vehicle or driver"
              className="max-w-xs"
            />
          </div>
          {routesQuery.isLoading ? (
            <TableSkeleton columns={6} />
          ) : routesQuery.isError ? (
            <ErrorPanel error={routesQuery.error} onRetry={() => void routesQuery.refetch()} />
          ) : routes.length === 0 ? (
            <EmptyState title="No transport routes" description="Add a route to start assigning students." />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Route</Th>
                    <Th>Vehicle</Th>
                    <Th>Driver</Th>
                    <Th>Stops</Th>
                    <Th>Fare</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id}>
                      <Td className="font-medium text-slate-900">{route.name}</Td>
                      <Td>{route.vehicleNo}</Td>
                      <Td>
                        <p className="text-sm text-slate-700">{route.driverName}</p>
                        <p className="text-xs text-slate-500">{route.driverPhone}</p>
                      </Td>
                      <Td className="max-w-xs truncate text-slate-600">
                        {route.stops.length ? route.stops.join(', ') : '—'}
                      </Td>
                      <Td className="tabular-nums">{formatMoney(route.fareMinor)}</Td>
                      <Td>
                        <Badge tone={statusTone(route.active ? 'ACTIVE' : 'INACTIVE')}>
                          {route.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </>
      ) : (
        <AssignmentsTab routes={routes} canWrite={hasPermission('transport:write')} onChanged={invalidate} />
      )}

      <RouteModal
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        onSaved={() => {
          setRouteOpen(false);
          invalidate();
        }}
      />
      <AssignModal
        open={assignOpen}
        routes={routes}
        onClose={() => setAssignOpen(false)}
        onSaved={() => {
          setAssignOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function AssignmentsTab({
  routes,
  canWrite,
  onChanged,
}: {
  routes: TransportRouteRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [routeId, setRouteId] = useState('');

  const assignmentsQuery = useQuery({
    queryKey: ['transport', 'assignments', routeId],
    queryFn: () =>
      api.get<TransportAssignmentRow[]>(
        `/transport/assignments${queryString({ routeId: routeId || undefined })}`,
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ removed: boolean }>(`/transport/assignments/${id}`),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="mb-4">
        <Select
          value={routeId}
          onChange={(event) => setRouteId(event.target.value)}
          className="max-w-[240px]"
        >
          <option value="">All routes</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))}
        </Select>
      </div>
      {remove.isError ? <ErrorPanel error={remove.error} /> : null}
      {assignmentsQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : assignmentsQuery.isError ? (
        <ErrorPanel error={assignmentsQuery.error} onRetry={() => void assignmentsQuery.refetch()} />
      ) : (assignmentsQuery.data?.length ?? 0) === 0 ? (
        <EmptyState title="No assignments" description="Assign a student to a route to get started." />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Route</Th>
                <Th>Vehicle</Th>
                <Th>Stop</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {assignmentsQuery.data?.map((assignment) => (
                <tr key={assignment.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{assignment.studentName}</p>
                    <p className="text-xs text-slate-500">{assignment.admissionNo ?? '—'}</p>
                  </Td>
                  <Td>{assignment.routeName}</Td>
                  <Td>{assignment.vehicleNo ?? '—'}</Td>
                  <Td>{assignment.stop}</Td>
                  <Td>
                    {canWrite ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(assignment.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

function RouteModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RouteForm>({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: '',
      vehicleNo: '',
      driverName: '',
      driverPhone: '',
      fare: '',
      stops: '',
      active: 'true',
    },
  });

  const create = useMutation({
    mutationFn: (values: RouteForm) =>
      api.post<TransportRouteRow>('/transport/routes', {
        name: values.name,
        vehicleNo: values.vehicleNo,
        driverName: values.driverName,
        driverPhone: values.driverPhone,
        fareMinor: Math.round(Number(values.fare) * 100),
        stops: (values.stops ?? '')
          .split(',')
          .map((stop) => stop.trim())
          .filter(Boolean),
        active: values.active === 'true',
      }),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add transport route"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="route-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save route'}
          </Button>
        </>
      }
    >
      <form id="route-form" className="space-y-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="route-name">Route name</Label>
            <Input id="route-name" {...register('name')} placeholder="Lakeside – School" />
            <FieldError>{errors.name?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="route-vehicle">Vehicle number</Label>
            <Input id="route-vehicle" {...register('vehicleNo')} />
            <FieldError>{errors.vehicleNo?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="route-fare">Monthly fare</Label>
            <Input id="route-fare" type="number" min="0" step="0.01" {...register('fare')} />
            <FieldError>{errors.fare?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="route-driver">Driver name</Label>
            <Input id="route-driver" {...register('driverName')} />
            <FieldError>{errors.driverName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="route-driver-phone">Driver phone</Label>
            <Input id="route-driver-phone" {...register('driverPhone')} />
            <FieldError>{errors.driverPhone?.message}</FieldError>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="route-stops">Stops (comma separated)</Label>
            <Input id="route-stops" {...register('stops')} placeholder="Kalanki, Balaju, Gongabu" />
          </div>
          <div>
            <Label htmlFor="route-active">Status</Label>
            <Select id="route-active" {...register('active')}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </div>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save route'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function AssignModal({
  open,
  routes,
  onClose,
  onSaved,
}: {
  open: boolean;
  routes: TransportRouteRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const studentsQuery = useQuery({
    queryKey: ['students', 'transport-options'],
    queryFn: () => api.get<Paged<StudentRow>>('/students?pageSize=100'),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignForm>({
    resolver: zodResolver(assignSchema),
    defaultValues: { routeId: '', studentId: '', stop: '' },
  });

  const assign = useMutation({
    mutationFn: (values: AssignForm) => api.post<TransportAssignmentRow>('/transport/assignments', values),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign student to route"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="assign-form" disabled={isSubmitting || assign.isPending}>
            {assign.isPending ? 'Saving…' : 'Save assignment'}
          </Button>
        </>
      }
    >
      <form id="assign-form" className="space-y-4" onSubmit={handleSubmit((values) => assign.mutate(values))}>
        <div>
          <Label htmlFor="assign-route">Route</Label>
          <Select id="assign-route" {...register('routeId')}>
            <option value="">Select a route</option>
            {routes
              .filter((route) => route.active)
              .map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name} — {route.vehicleNo}
                </option>
              ))}
          </Select>
          <FieldError>{errors.routeId?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="assign-student">Student</Label>
          <Select id="assign-student" {...register('studentId')}>
            <option value="">Select a student</option>
            {(studentsQuery.data?.items ?? []).map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName ?? `${student.firstName} ${student.lastName}`} ({student.admissionNo})
              </option>
            ))}
          </Select>
          <FieldError>{errors.studentId?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="assign-stop">Pickup stop</Label>
          <Input id="assign-stop" {...register('stop')} />
          <FieldError>{errors.stop?.message}</FieldError>
        </div>
        {assign.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {assign.error instanceof Error ? assign.error.message : 'Could not save assignment'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
