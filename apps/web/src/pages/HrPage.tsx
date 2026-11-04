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
  Textarea,
  Th,
  cn,
  statusTone,
} from '@schoolerp/ui';
import { api, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, todayIso } from '../lib/format';
import type {
  HrSummary,
  Paged,
  StaffAttendanceRow,
  StaffLeaveRow,
  StaffRow,
} from '../lib/types';
import { ErrorPanel, Pagination, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

type Tab = 'staff' | 'leave' | 'attendance';

const staffFormSchema = z.object({
  employeeNo: z.string().trim().min(1, 'Employee number is required').max(32),
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().max(60).optional(),
  email: z.string().email('Enter a valid email').or(z.literal('')).optional(),
  phone: z.string().trim().max(24).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VOLUNTEER']),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']),
  joinedOn: z.string().optional(),
  qualification: z.string().trim().max(160).optional(),
  salary: z.string().trim().optional(),
});

type StaffForm = z.infer<typeof staffFormSchema>;

const leaveFormSchema = z.object({
  staffId: z.string().min(1, 'Select a staff member'),
  type: z.enum(['CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  reason: z.string().trim().min(3, 'Describe the reason').max(500),
});

type LeaveForm = z.infer<typeof leaveFormSchema>;

export function HrPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('staff');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [staffOpen, setStaffOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['hr', 'summary'],
    queryFn: () => api.get<HrSummary>('/hr/summary'),
  });

  const staffQuery = useQuery({
    queryKey: ['hr', 'staff', { page, search, status }],
    queryFn: () =>
      api.get<Paged<StaffRow>>(
        `/hr/staff${queryString({
          page,
          pageSize: 25,
          q: search || undefined,
          status: status || undefined,
        })}`,
      ),
  });

  const staffOptions = useMemo(() => staffQuery.data?.items ?? [], [staffQuery.data]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['hr'] });
  }

  return (
    <div>
      <PageHeader
        title="Human resources"
        description="Staff records, leave management and daily attendance"
        actions={
          hasPermission('staff:write') ? (
            <>
              <Button variant="outline" onClick={() => setLeaveOpen(true)}>
                Record leave
              </Button>
              <Button onClick={() => setStaffOpen(true)}>Add staff</Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6">
        {summaryQuery.isError ? (
          <ErrorPanel error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />
        ) : (
          <StatGrid>
            <StatCard label="Total staff" value={summaryQuery.data?.total ?? '—'} />
            <StatCard label="Active" value={summaryQuery.data?.active ?? '—'} tone="positive" />
            <StatCard label="On leave" value={summaryQuery.data?.onLeave ?? '—'} tone="warning" />
            <StatCard
              label="Pending leave requests"
              value={summaryQuery.data?.pendingLeaves ?? '—'}
              tone={summaryQuery.data?.pendingLeaves ? 'warning' : 'default'}
            />
          </StatGrid>
        )}
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['staff', 'Staff directory'],
            ['leave', 'Leave requests'],
            ['attendance', 'Attendance'],
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

      {tab === 'staff' ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, employee no, email"
              className="max-w-xs"
            />
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="max-w-[180px]"
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="RESIGNED">Resigned</option>
              <option value="TERMINATED">Terminated</option>
            </Select>
          </div>

          {staffQuery.isLoading ? (
            <TableSkeleton columns={6} />
          ) : staffQuery.isError ? (
            <ErrorPanel error={staffQuery.error} onRetry={() => void staffQuery.refetch()} />
          ) : (staffQuery.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No staff found" description="Add your first staff member to get started." />
          ) : (
            <>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Employment</Th>
                      <Th>Contact</Th>
                      <Th>Joined</Th>
                      <Th>Base salary</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffQuery.data?.items.map((staff) => (
                      <tr key={staff.id}>
                        <Td>
                          <p className="font-medium text-slate-900">
                            {staff.fullName ?? `${staff.firstName} ${staff.lastName}`}
                          </p>
                          <p className="text-xs text-slate-500">{staff.employeeNo}</p>
                        </Td>
                        <Td>
                          <span className="text-sm text-slate-700">
                            {staff.employmentType.replace('_', ' ')}
                          </span>
                          {staff.qualification ? (
                            <p className="text-xs text-slate-500">{staff.qualification}</p>
                          ) : null}
                        </Td>
                        <Td>
                          <p className="text-sm text-slate-700">{staff.phone ?? '—'}</p>
                          <p className="text-xs text-slate-500">{staff.email ?? '—'}</p>
                        </Td>
                        <Td>{formatDate(staff.joinedOn)}</Td>
                        <Td className="tabular-nums">{formatMoney(staff.baseSalaryMinor)}</Td>
                        <Td>
                          <Badge tone={statusTone(staff.status)}>
                            {staff.status.replace('_', ' ')}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              <Pagination
                page={staffQuery.data?.page ?? 1}
                pageSize={staffQuery.data?.pageSize ?? 25}
                total={staffQuery.data?.total ?? 0}
                onPage={setPage}
              />
            </>
          )}
        </>
      ) : null}

      {tab === 'leave' ? <LeaveTab canWrite={hasPermission('staff:write')} onChanged={invalidate} /> : null}
      {tab === 'attendance' ? (
        <AttendanceTab staff={staffOptions} canWrite={hasPermission('staff:write')} />
      ) : null}

      <StaffModal
        open={staffOpen}
        onClose={() => setStaffOpen(false)}
        onSaved={() => {
          setStaffOpen(false);
          invalidate();
        }}
      />
      <LeaveModal
        open={leaveOpen}
        staff={staffOptions}
        onClose={() => setLeaveOpen(false)}
        onSaved={() => {
          setLeaveOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function LeaveTab({ canWrite, onChanged }: { canWrite: boolean; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const leavesQuery = useQuery({
    queryKey: ['hr', 'leaves', { page, status }],
    queryFn: () =>
      api.get<Paged<StaffLeaveRow>>(
        `/hr/leaves${queryString({ page, pageSize: 25, status: status || undefined })}`,
      ),
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api.post<StaffLeaveRow>(`/hr/leaves/${id}/${action}`),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="max-w-[200px]"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>
      {decide.isError ? <ErrorPanel error={decide.error} /> : null}
      {leavesQuery.isLoading ? (
        <TableSkeleton columns={6} />
      ) : leavesQuery.isError ? (
        <ErrorPanel error={leavesQuery.error} onRetry={() => void leavesQuery.refetch()} />
      ) : (leavesQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No leave requests" description="Leave requests will appear here." />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Staff</Th>
                  <Th>Type</Th>
                  <Th>Period</Th>
                  <Th>Days</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {leavesQuery.data?.items.map((leave) => (
                  <tr key={leave.id}>
                    <Td className="font-medium text-slate-900">{leave.staffName ?? '—'}</Td>
                    <Td>{leave.type}</Td>
                    <Td>
                      {formatDate(leave.startDate)} → {formatDate(leave.endDate)}
                    </Td>
                    <Td className="tabular-nums">{leave.days ?? '—'}</Td>
                    <Td className="max-w-xs truncate text-slate-600">{leave.reason}</Td>
                    <Td>
                      <Badge tone={statusTone(leave.status)}>{leave.status}</Badge>
                    </Td>
                    <Td>
                      {canWrite && leave.status === 'PENDING' ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: leave.id, action: 'approve' })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: leave.id, action: 'reject' })}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={leavesQuery.data?.page ?? 1}
            pageSize={leavesQuery.data?.pageSize ?? 25}
            total={leavesQuery.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function AttendanceTab({ staff, canWrite }: { staff: StaffRow[]; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [draft, setDraft] = useState<Record<string, string>>({});

  const attendanceQuery = useQuery({
    queryKey: ['hr', 'attendance', date],
    queryFn: () =>
      api.get<{ date: string; staff: StaffRow[]; items: StaffAttendanceRow[] }>(
        `/hr/attendance${queryString({ date })}`,
      ),
  });

  const existing = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of attendanceQuery.data?.items ?? []) map.set(item.staffId, item.status);
    return map;
  }, [attendanceQuery.data]);

  const rows = attendanceQuery.data?.staff ?? staff;

  const save = useMutation({
    mutationFn: () =>
      api.post<{ date: string; marked: number }>('/hr/attendance', {
        date,
        records: rows.map((row) => ({
          staffId: row.id,
          status: draft[row.id] ?? existing.get(row.id) ?? 'PRESENT',
        })),
      }),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['hr'] });
    },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="hr-attendance-date">Date</Label>
          <Input
            id="hr-attendance-date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setDraft({});
            }}
            className="max-w-[180px]"
          />
        </div>
        {canWrite ? (
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || rows.length === 0}
          >
            {save.isPending ? 'Saving…' : 'Save attendance'}
          </Button>
        ) : null}
        {save.isSuccess ? (
          <span className="text-sm text-emerald-600">Saved {save.data.marked} records</span>
        ) : null}
      </div>
      {save.isError ? <ErrorPanel error={save.error} /> : null}
      {attendanceQuery.isLoading ? (
        <TableSkeleton columns={3} />
      ) : attendanceQuery.isError ? (
        <ErrorPanel error={attendanceQuery.error} onRetry={() => void attendanceQuery.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No active staff" description="Add staff before marking attendance." />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Staff</Th>
                <Th>Employee no</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="font-medium text-slate-900">
                    {row.fullName ?? `${row.firstName} ${row.lastName}`}
                  </Td>
                  <Td>{row.employeeNo}</Td>
                  <Td>
                    <Select
                      value={draft[row.id] ?? existing.get(row.id) ?? 'PRESENT'}
                      disabled={!canWrite}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      className="max-w-[160px]"
                    >
                      <option value="PRESENT">Present</option>
                      <option value="ABSENT">Absent</option>
                      <option value="LATE">Late</option>
                      <option value="HALF_DAY">Half day</option>
                      <option value="LEAVE">Leave</option>
                    </Select>
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

function StaffModal({
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
  } = useForm<StaffForm>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      employeeNo: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      gender: 'MALE',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      joinedOn: '',
      qualification: '',
      salary: '',
    },
  });

  const create = useMutation({
    mutationFn: (values: StaffForm) =>
      api.post<StaffRow>('/hr/staff', {
        employeeNo: values.employeeNo,
        firstName: values.firstName,
        lastName: values.lastName ?? '',
        email: values.email || undefined,
        phone: values.phone || undefined,
        gender: values.gender,
        employmentType: values.employmentType,
        status: values.status,
        joinedOn: values.joinedOn || undefined,
        qualification: values.qualification || undefined,
        baseSalaryMinor: values.salary ? Math.round(Number(values.salary) * 100) : 0,
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
      title="Add staff member"
      description="Create the employee record used by payroll and attendance."
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="staff-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save staff'}
          </Button>
        </>
      }
    >
      <form id="staff-form" className="space-y-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="staff-employee-no">Employee no</Label>
            <Input id="staff-employee-no" {...register('employeeNo')} />
            <FieldError>{errors.employeeNo?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="staff-joined">Joined on</Label>
            <Input id="staff-joined" type="date" {...register('joinedOn')} />
          </div>
          <div>
            <Label htmlFor="staff-first">First name</Label>
            <Input id="staff-first" {...register('firstName')} />
            <FieldError>{errors.firstName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="staff-last">Last name</Label>
            <Input id="staff-last" {...register('lastName')} />
          </div>
          <div>
            <Label htmlFor="staff-email">Email</Label>
            <Input id="staff-email" type="email" {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="staff-phone">Phone</Label>
            <Input id="staff-phone" {...register('phone')} />
          </div>
          <div>
            <Label htmlFor="staff-gender">Gender</Label>
            <Select id="staff-gender" {...register('gender')}>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="staff-type">Employment type</Label>
            <Select id="staff-type" {...register('employmentType')}>
              <option value="FULL_TIME">Full time</option>
              <option value="PART_TIME">Part time</option>
              <option value="CONTRACT">Contract</option>
              <option value="VOLUNTEER">Volunteer</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="staff-status">Status</Label>
            <Select id="staff-status" {...register('status')}>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="RESIGNED">Resigned</option>
              <option value="TERMINATED">Terminated</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="staff-salary">Monthly base salary</Label>
            <Input id="staff-salary" type="number" min="0" step="0.01" {...register('salary')} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="staff-qualification">Qualification</Label>
            <Input id="staff-qualification" {...register('qualification')} />
          </div>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save staff'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function LeaveModal({
  open,
  staff,
  onClose,
  onSaved,
}: {
  open: boolean;
  staff: StaffRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeaveForm>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: {
      staffId: '',
      type: 'CASUAL',
      startDate: todayIso(),
      endDate: todayIso(),
      reason: '',
    },
  });

  const create = useMutation({
    mutationFn: (values: LeaveForm) => api.post<StaffLeaveRow>('/hr/leaves', values),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record leave"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="leave-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save request'}
          </Button>
        </>
      }
    >
      <form id="leave-form" className="space-y-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <div>
          <Label htmlFor="leave-staff">Staff member</Label>
          <Select id="leave-staff" {...register('staffId')}>
            <option value="">Select staff</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName ?? `${member.firstName} ${member.lastName}`} ({member.employeeNo})
              </option>
            ))}
          </Select>
          <FieldError>{errors.staffId?.message}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="leave-type">Leave type</Label>
            <Select id="leave-type" {...register('type')}>
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="MATERNITY">Maternity</option>
              <option value="PATERNITY">Paternity</option>
              <option value="UNPAID">Unpaid</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="leave-start">Start date</Label>
            <Input id="leave-start" type="date" {...register('startDate')} />
            <FieldError>{errors.startDate?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="leave-end">End date</Label>
            <Input id="leave-end" type="date" {...register('endDate')} />
            <FieldError>{errors.endDate?.message}</FieldError>
          </div>
        </div>
        <div>
          <Label htmlFor="leave-reason">Reason</Label>
          <Textarea id="leave-reason" {...register('reason')} />
          <FieldError>{errors.reason?.message}</FieldError>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save leave'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
