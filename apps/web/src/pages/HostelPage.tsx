import { useMemo, useState } from 'react';
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
import { formatDate, formatMoney, todayIso } from '../lib/format';
import type {
  HostelAllocationRow,
  HostelRow,
  HostelSummary,
  Paged,
  StudentRow,
} from '../lib/types';
import { ErrorPanel, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

type Tab = 'hostels' | 'allocations';

const hostelSchema = z.object({
  name: z.string().trim().min(1, 'Hostel name is required').max(120),
  type: z.enum(['BOYS', 'GIRLS', 'MIXED']),
  capacity: z.string().trim().min(1, 'Capacity is required'),
});

type HostelForm = z.infer<typeof hostelSchema>;

const roomSchema = z.object({
  hostelId: z.string().min(1, 'Select a hostel'),
  roomNo: z.string().trim().min(1, 'Room number is required').max(20),
  capacity: z.string().trim().min(1, 'Capacity is required'),
  rent: z.string().trim().optional(),
});

type RoomForm = z.infer<typeof roomSchema>;

const allocateSchema = z.object({
  hostelId: z.string().min(1, 'Select a hostel'),
  roomId: z.string().min(1, 'Select a room'),
  studentId: z.string().min(1, 'Select a student'),
  startDate: z.string().min(1, 'Start date is required'),
  rent: z.string().trim().optional(),
});

type AllocateForm = z.infer<typeof allocateSchema>;

export function HostelPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('hostels');
  const [hostelOpen, setHostelOpen] = useState(false);
  const [roomTarget, setRoomTarget] = useState<HostelRow | null>(null);
  const [allocateOpen, setAllocateOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['hostel', 'summary'],
    queryFn: () => api.get<HostelSummary>('/hostel/summary'),
  });

  const hostelsQuery = useQuery({
    queryKey: ['hostel', 'hostels'],
    queryFn: () => api.get<HostelRow[]>('/hostel/hostels'),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['hostel'] });
  }

  const hostels = hostelsQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Hostel"
        description="Buildings, rooms, beds and student allocations"
        actions={
          hasPermission('hostel:write') ? (
            <>
              <Button variant="outline" onClick={() => setAllocateOpen(true)}>
                Allocate student
              </Button>
              <Button onClick={() => setHostelOpen(true)}>Add hostel</Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6">
        <StatGrid>
          <StatCard label="Hostels" value={summaryQuery.data?.hostels ?? '—'} />
          <StatCard label="Rooms" value={summaryQuery.data?.rooms ?? '—'} />
          <StatCard
            label="Beds occupied"
            value={`${summaryQuery.data?.occupied ?? 0} / ${summaryQuery.data?.beds ?? 0}`}
            tone="warning"
          />
          <StatCard label="Active allocations" value={summaryQuery.data?.allocations ?? '—'} tone="positive" />
        </StatGrid>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['hostels', 'Hostels & rooms'],
            ['allocations', 'Allocations'],
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

      {tab === 'hostels' ? (
        hostelsQuery.isLoading ? (
          <TableSkeleton columns={5} />
        ) : hostelsQuery.isError ? (
          <ErrorPanel error={hostelsQuery.error} onRetry={() => void hostelsQuery.refetch()} />
        ) : hostels.length === 0 ? (
          <EmptyState title="No hostels yet" description="Add a hostel and its rooms to begin allocating." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {hostels.map((hostel) => (
              <div key={hostel.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <p className="font-semibold text-slate-900">{hostel.name}</p>
                    <p className="text-xs text-slate-500">
                      {hostel.type} · {hostel.roomCount ?? 0} rooms · {hostel.occupied ?? 0}/
                      {hostel.beds ?? 0} beds
                    </p>
                  </div>
                  {hasPermission('hostel:write') ? (
                    <Button size="sm" variant="outline" onClick={() => setRoomTarget(hostel)}>
                      Add room
                    </Button>
                  ) : null}
                </div>
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Room</Th>
                        <Th>Capacity</Th>
                        <Th>Occupied</Th>
                        <Th>Rent</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(hostel.rooms ?? []).length === 0 ? (
                        <tr>
                          <Td colSpan={4} className="text-center text-sm text-slate-500">
                            No rooms added yet
                          </Td>
                        </tr>
                      ) : (
                        hostel.rooms?.map((room) => (
                          <tr key={room.id}>
                            <Td className="font-medium text-slate-900">{room.roomNo}</Td>
                            <Td className="tabular-nums">{room.capacity}</Td>
                            <Td className="tabular-nums">
                              <span
                                className={
                                  room.occupied >= room.capacity ? 'text-amber-600' : 'text-slate-700'
                                }
                              >
                                {room.occupied}
                              </span>
                            </Td>
                            <Td className="tabular-nums">{formatMoney(room.rentMinor)}</Td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </Table>
                </TableWrap>
              </div>
            ))}
          </div>
        )
      ) : (
        <AllocationsTab
          hostels={hostels}
          canWrite={hasPermission('hostel:write')}
          onChanged={invalidate}
        />
      )}

      <HostelModal
        open={hostelOpen}
        onClose={() => setHostelOpen(false)}
        onSaved={() => {
          setHostelOpen(false);
          invalidate();
        }}
      />
      <RoomModal
        hostel={roomTarget}
        onClose={() => setRoomTarget(null)}
        onSaved={() => {
          setRoomTarget(null);
          invalidate();
        }}
      />
      <AllocateModal
        open={allocateOpen}
        hostels={hostels}
        onClose={() => setAllocateOpen(false)}
        onSaved={() => {
          setAllocateOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function AllocationsTab({
  hostels,
  canWrite,
  onChanged,
}: {
  hostels: HostelRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [hostelId, setHostelId] = useState('');
  const [status, setStatus] = useState('ACTIVE');

  const allocationsQuery = useQuery({
    queryKey: ['hostel', 'allocations', hostelId, status],
    queryFn: () =>
      api.get<HostelAllocationRow[]>(
        `/hostel/allocations${queryString({
          hostelId: hostelId || undefined,
          status: status || undefined,
        })}`,
      ),
  });

  const vacate = useMutation({
    mutationFn: (id: string) => api.post<HostelAllocationRow>(`/hostel/allocations/${id}/vacate`),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          value={hostelId}
          onChange={(event) => setHostelId(event.target.value)}
          className="max-w-[220px]"
        >
          <option value="">All hostels</option>
          {hostels.map((hostel) => (
            <option key={hostel.id} value={hostel.id}>
              {hostel.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="max-w-[170px]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="VACATED">Vacated</option>
        </Select>
      </div>
      {vacate.isError ? <ErrorPanel error={vacate.error} /> : null}
      {allocationsQuery.isLoading ? (
        <TableSkeleton columns={6} />
      ) : allocationsQuery.isError ? (
        <ErrorPanel error={allocationsQuery.error} onRetry={() => void allocationsQuery.refetch()} />
      ) : (allocationsQuery.data?.length ?? 0) === 0 ? (
        <EmptyState title="No allocations" description="Allocate a student to a hostel room to get started." />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Hostel</Th>
                <Th>Room</Th>
                <Th>Start</Th>
                <Th>Rent</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {allocationsQuery.data?.map((allocation) => (
                <tr key={allocation.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{allocation.studentName}</p>
                    <p className="text-xs text-slate-500">{allocation.admissionNo ?? '—'}</p>
                  </Td>
                  <Td>{allocation.hostelName ?? '—'}</Td>
                  <Td>{allocation.roomNo ?? '—'}</Td>
                  <Td>{formatDate(allocation.startDate)}</Td>
                  <Td className="tabular-nums">{formatMoney(allocation.rentMinor ?? 0)}</Td>
                  <Td>
                    <Badge tone={statusTone(allocation.status)}>{allocation.status}</Badge>
                  </Td>
                  <Td>
                    {canWrite && allocation.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={vacate.isPending}
                        onClick={() => vacate.mutate(allocation.id)}
                      >
                        Vacate
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

function HostelModal({
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
  } = useForm<HostelForm>({
    resolver: zodResolver(hostelSchema),
    defaultValues: { name: '', type: 'BOYS', capacity: '0' },
  });

  const create = useMutation({
    mutationFn: (values: HostelForm) =>
      api.post<HostelRow>('/hostel/hostels', {
        name: values.name,
        type: values.type,
        capacity: Number(values.capacity),
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
      title="Add hostel"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="hostel-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save hostel'}
          </Button>
        </>
      }
    >
      <form id="hostel-form" className="space-y-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <div>
          <Label htmlFor="hostel-name">Hostel name</Label>
          <Input id="hostel-name" {...register('name')} />
          <FieldError>{errors.name?.message}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="hostel-type">Type</Label>
            <Select id="hostel-type" {...register('type')}>
              <option value="BOYS">Boys</option>
              <option value="GIRLS">Girls</option>
              <option value="MIXED">Mixed</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="hostel-capacity">Capacity</Label>
            <Input id="hostel-capacity" type="number" min="0" {...register('capacity')} />
            <FieldError>{errors.capacity?.message}</FieldError>
          </div>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save hostel'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function RoomModal({
  hostel,
  onClose,
  onSaved,
}: {
  hostel: HostelRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RoomForm>({
    resolver: zodResolver(roomSchema),
    defaultValues: { hostelId: hostel?.id ?? '', roomNo: '', capacity: '1', rent: '' },
  });

  const create = useMutation({
    mutationFn: (values: RoomForm) =>
      api.post<unknown>('/hostel/rooms', {
        hostelId: values.hostelId,
        roomNo: values.roomNo,
        capacity: Number(values.capacity),
        rentMinor: values.rent ? Math.round(Number(values.rent) * 100) : 0,
      }),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={Boolean(hostel)}
      onClose={onClose}
      title={hostel ? `Add room to ${hostel.name}` : 'Add room'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="room-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save room'}
          </Button>
        </>
      }
    >
      <form
        id="room-form"
        className="space-y-4"
        onSubmit={handleSubmit((values) =>
          create.mutate({ ...values, hostelId: values.hostelId || hostel?.id || '' }),
        )}
      >
        <input type="hidden" {...register('hostelId')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="room-no">Room number</Label>
            <Input id="room-no" {...register('roomNo')} />
            <FieldError>{errors.roomNo?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="room-capacity">Capacity</Label>
            <Input id="room-capacity" type="number" min="1" {...register('capacity')} />
            <FieldError>{errors.capacity?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="room-rent">Monthly rent</Label>
            <Input id="room-rent" type="number" min="0" step="0.01" {...register('rent')} />
          </div>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save room'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function AllocateModal({
  open,
  hostels,
  onClose,
  onSaved,
}: {
  open: boolean;
  hostels: HostelRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const studentsQuery = useQuery({
    queryKey: ['students', 'hostel-options'],
    queryFn: () => api.get<Paged<StudentRow>>('/students?pageSize=100'),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AllocateForm>({
    resolver: zodResolver(allocateSchema),
    defaultValues: { hostelId: '', roomId: '', studentId: '', startDate: todayIso(), rent: '' },
  });

  const hostelId = watch('hostelId');
  const rooms = useMemo(
    () => hostels.find((hostel) => hostel.id === hostelId)?.rooms ?? [],
    [hostels, hostelId],
  );

  const allocate = useMutation({
    mutationFn: (values: AllocateForm) =>
      api.post<HostelAllocationRow>('/hostel/allocations', {
        hostelId: values.hostelId,
        roomId: values.roomId,
        studentId: values.studentId,
        startDate: values.startDate,
        rentMinor: values.rent ? Math.round(Number(values.rent) * 100) : undefined,
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
      title="Allocate hostel room"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="allocate-form" disabled={isSubmitting || allocate.isPending}>
            {allocate.isPending ? 'Saving…' : 'Allocate'}
          </Button>
        </>
      }
    >
      <form
        id="allocate-form"
        className="space-y-4"
        onSubmit={handleSubmit((values) => allocate.mutate(values))}
      >
        <div>
          <Label htmlFor="allocate-hostel">Hostel</Label>
          <Select id="allocate-hostel" {...register('hostelId')}>
            <option value="">Select a hostel</option>
            {hostels.map((hostel) => (
              <option key={hostel.id} value={hostel.id}>
                {hostel.name}
              </option>
            ))}
          </Select>
          <FieldError>{errors.hostelId?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="allocate-room">Room</Label>
          <Select id="allocate-room" {...register('roomId')}>
            <option value="">Select a room</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id} disabled={room.occupied >= room.capacity}>
                {room.roomNo} ({room.occupied}/{room.capacity})
              </option>
            ))}
          </Select>
          <FieldError>{errors.roomId?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="allocate-student">Student</Label>
          <Select id="allocate-student" {...register('studentId')}>
            <option value="">Select a student</option>
            {(studentsQuery.data?.items ?? []).map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName ?? `${student.firstName} ${student.lastName}`} ({student.admissionNo})
              </option>
            ))}
          </Select>
          <FieldError>{errors.studentId?.message}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="allocate-start">Start date</Label>
            <Input id="allocate-start" type="date" {...register('startDate')} />
            <FieldError>{errors.startDate?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="allocate-rent">Monthly rent (optional)</Label>
            <Input id="allocate-rent" type="number" min="0" step="0.01" {...register('rent')} />
          </div>
        </div>
        {allocate.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {allocate.error instanceof Error ? allocate.error.message : 'Could not allocate room'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
