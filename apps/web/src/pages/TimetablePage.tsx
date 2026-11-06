import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  TableWrap,
  Td,
  Th,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, todayIso } from '../lib/format';
import type {
  Paged,
  SchoolClass,
  StaffRow,
  SubstitutionStatus,
  TimetableResponse,
  TimetableSubstitution,
} from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

const DAYS = [1, 2, 3, 4, 5, 6] as const;
const DAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};
const STATUS_OPTIONS: SubstitutionStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

function staffName(staff: { firstName: string; lastName: string } | null): string {
  if (!staff) return '—';
  return `${staff.firstName} ${staff.lastName}`.trim();
}

export function TimetablePage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'grid' | 'substitutions'>('grid');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | SubstitutionStatus>('');
  const [slotId, setSlotId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [substituteStaffId, setSubstituteStaffId] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canRead = hasPermission('timetable:read');
  const canWrite = hasPermission('timetable:write');
  const canReadStaff = hasPermission('staff:read');

  const classesQuery = useQuery({
    queryKey: ['academics', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/academics/classes'),
    enabled: canRead,
  });
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const sections = useMemo(
    () => classes.find((klass) => klass.id === classId)?.sections ?? [],
    [classes, classId],
  );

  const timetableQuery = useQuery({
    queryKey: ['academics', 'timetable', { classId, sectionId }],
    queryFn: () =>
      api.get<TimetableResponse>(`/academics/timetable${queryString({ classId, sectionId })}`),
    enabled: canRead && Boolean(classId && sectionId),
  });

  const substitutionsQuery = useQuery({
    queryKey: ['academics', 'substitutions'],
    queryFn: () =>
      api.get<{ items: TimetableSubstitution[] }>('/academics/timetable/substitutions'),
    enabled: canRead,
  });

  const staffQuery = useQuery({
    queryKey: ['hr', 'staff', 'active'],
    queryFn: () =>
      api.get<Paged<StaffRow>>(
        `/hr/staff${queryString({ status: 'ACTIVE', pageSize: 100 })}`,
      ),
    enabled: canWrite && canReadStaff,
  });

  const periods = timetableQuery.data?.periods ?? [];
  const slots = timetableQuery.data?.slots ?? [];
  const substitutions = useMemo(() => {
    const rows = substitutionsQuery.data?.items ?? [];
    return statusFilter ? rows.filter((row) => row.status === statusFilter) : rows;
  }, [substitutionsQuery.data, statusFilter]);
  const activeStaff = useMemo(
    () => (staffQuery.data?.items ?? []).filter((member) => member.status === 'ACTIVE'),
    [staffQuery.data],
  );

  function invalidateSubstitutions() {
    void queryClient.invalidateQueries({ queryKey: ['academics', 'substitutions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const requestSubstitution = useMutation({
    mutationFn: () =>
      api.post<TimetableSubstitution>('/academics/timetable/substitutions', {
        slotId,
        date,
        substituteStaffId,
        reason,
      }),
    onSuccess: () => {
      setMessage('Substitution requested. It is now awaiting approval.');
      setActionError(null);
      setSlotId('');
      setSubstituteStaffId('');
      setReason('');
      invalidateSubstitutions();
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof ApiError ? error.message : 'Could not request the substitution');
    },
  });

  const reviewSubstitution = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      api.post<TimetableSubstitution>(`/academics/timetable/substitutions/${id}/review`, {
        decision,
      }),
    onSuccess: (_result, variables) => {
      setMessage(
        variables.decision === 'APPROVE'
          ? 'Substitution approved.'
          : 'Substitution rejected.',
      );
      setActionError(null);
      invalidateSubstitutions();
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof ApiError ? error.message : 'Could not review the substitution');
    },
  });

  const cancelSubstitution = useMutation({
    mutationFn: (id: string) =>
      api.post<TimetableSubstitution>(`/academics/timetable/substitutions/${id}/cancel`),
    onSuccess: () => {
      setMessage('Substitution cancelled.');
      setActionError(null);
      invalidateSubstitutions();
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof ApiError ? error.message : 'Could not cancel the substitution');
    },
  });

  if (!canRead) {
    return (
      <EmptyState
        title="Timetable access required"
        description="Ask a school administrator for the timetable permission."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Weekly lessons and dated substitution approvals for each class section."
        actions={
          <div className="flex rounded-lg border border-slate-200 bg-white p-1">
            {(['grid', 'substitutions'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={
                  tab === value
                    ? 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50'
                }
              >
                {value === 'grid' ? 'Weekly grid' : 'Substitutions'}
              </button>
            ))}
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="timetable-class">Class</Label>
            <Select
              id="timetable-class"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId('');
                setSlotId('');
              }}
            >
              <option value="">Select a class</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="timetable-section">Section</Label>
            <Select
              id="timetable-section"
              value={sectionId}
              onChange={(event) => {
                setSectionId(event.target.value);
                setSlotId('');
              }}
              disabled={!classId}
            >
              <option value="">Select a section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {message ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {message}
        </p>
      ) : null}
      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {actionError}
        </p>
      ) : null}

      {tab === 'grid' ? (
        <Card>
          <CardHeader>
            <CardTitle>Weekly grid</CardTitle>
          </CardHeader>
          <CardContent>
            {!classId || !sectionId ? (
              <EmptyState
                title="Choose a class section"
                description="Select a class and section to view its weekly timetable."
              />
            ) : timetableQuery.isLoading ? (
              <TableSkeleton rows={6} columns={7} />
            ) : timetableQuery.isError ? (
              <ErrorPanel error={timetableQuery.error} onRetry={() => void timetableQuery.refetch()} />
            ) : periods.length === 0 ? (
              <EmptyState
                title="No periods configured"
                description="Timetable periods are created during school setup."
              />
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Period</Th>
                      {DAYS.map((day) => (
                        <Th key={day}>{DAY_LABELS[day]}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((period) => (
                      <tr key={period.id}>
                        <Td className="whitespace-nowrap">
                          <p className="font-medium text-slate-900">{period.name}</p>
                          <p className="text-xs text-slate-500">
                            {period.startTime}–{period.endTime}
                          </p>
                        </Td>
                        {DAYS.map((day) => {
                          const slot = slots.find(
                            (row) => row.periodId === period.id && row.dayOfWeek === day,
                          );
                          return (
                            <Td key={day} className="align-top">
                              {slot ? (
                                <div className="space-y-1">
                                  <p className="font-medium text-slate-900">
                                    {slot.subject.code}
                                  </p>
                                  <p className="text-xs text-slate-600">{slot.subject.name}</p>
                                  {slot.room ? (
                                    <p className="text-xs text-slate-500">Room {slot.room}</p>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">Free</span>
                              )}
                            </Td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>Request a substitution</CardTitle>
              </CardHeader>
              <CardContent>
                {!classId || !sectionId ? (
                  <p className="text-sm text-slate-500">
                    Select a class and section above to choose one of its lessons.
                  </p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    This class section has no timetable lessons yet.
                  </p>
                ) : (
                  <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      requestSubstitution.mutate();
                    }}
                  >
                    <div className="sm:col-span-2">
                      <Label htmlFor="substitution-slot">Lesson</Label>
                      <Select
                        id="substitution-slot"
                        value={slotId}
                        onChange={(event) => setSlotId(event.target.value)}
                        required
                      >
                        <option value="">Select a lesson</option>
                        {slots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {DAY_LABELS[slot.dayOfWeek] ?? `Day ${slot.dayOfWeek}`} ·{' '}
                            {slot.subject.code} · {slot.class.name}-{slot.section.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="substitution-date">Date</Label>
                      <Input
                        id="substitution-date"
                        type="date"
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="substitution-staff">Substitute teacher</Label>
                      <Select
                        id="substitution-staff"
                        value={substituteStaffId}
                        onChange={(event) => setSubstituteStaffId(event.target.value)}
                        required
                        disabled={!canReadStaff}
                      >
                        <option value="">Select a teacher</option>
                        {activeStaff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {staffName(member)} ({member.employeeNo})
                          </option>
                        ))}
                      </Select>
                      {!canReadStaff ? (
                        <FieldError>
                          Staff directory access is required to choose a substitute.
                        </FieldError>
                      ) : null}
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="substitution-reason">Reason</Label>
                      <Input
                        id="substitution-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="e.g. Medical leave for the assigned teacher"
                        maxLength={500}
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Button
                        type="submit"
                        disabled={
                          requestSubstitution.isPending || !slotId || !substituteStaffId
                        }
                      >
                        {requestSubstitution.isPending ? 'Submitting…' : 'Submit request'}
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Substitution requests</CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="substitution-filter" className="mb-0">
                  Status
                </Label>
                <Select
                  id="substitution-filter"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as '' | SubstitutionStatus)
                  }
                  className="h-9 w-40"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {substitutionsQuery.isLoading ? (
                <TableSkeleton rows={5} columns={6} />
              ) : substitutionsQuery.isError ? (
                <ErrorPanel
                  error={substitutionsQuery.error}
                  onRetry={() => void substitutionsQuery.refetch()}
                />
              ) : substitutions.length === 0 ? (
                <EmptyState
                  title="No substitution requests"
                  description="Cover arrangements requested for a specific date will appear here."
                />
              ) : (
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Lesson</Th>
                        <Th>Assigned</Th>
                        <Th>Substitute</Th>
                        <Th>Reason</Th>
                        <Th>Status</Th>
                        {canWrite ? <Th>Actions</Th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {substitutions.map((row) => (
                        <tr key={row.id}>
                          <Td className="whitespace-nowrap">{formatDate(row.date)}</Td>
                          <Td>
                            {row.slot ? (
                              <div>
                                <p className="font-medium text-slate-900">
                                  {row.slot.subject.code}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {row.slot.class.name}-{row.slot.section.name} ·{' '}
                                  {row.slot.period.name}
                                </p>
                              </div>
                            ) : (
                              '—'
                            )}
                          </Td>
                          <Td>{staffName(row.originalStaff)}</Td>
                          <Td>{staffName(row.substituteStaff)}</Td>
                          <Td className="max-w-xs">
                            <p className="line-clamp-2 text-slate-700">{row.reason}</p>
                            {row.reviewNote ? (
                              <p className="mt-1 text-xs text-slate-500">
                                Note: {row.reviewNote}
                              </p>
                            ) : null}
                          </Td>
                          <Td>
                            <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                          </Td>
                          {canWrite ? (
                            <Td>
                              {row.status === 'PENDING' ? (
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      reviewSubstitution.mutate({ id: row.id, decision: 'APPROVE' })
                                    }
                                    disabled={reviewSubstitution.isPending}
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      reviewSubstitution.mutate({ id: row.id, decision: 'REJECT' })
                                    }
                                    disabled={reviewSubstitution.isPending}
                                  >
                                    Reject
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => cancelSubstitution.mutate(row.id)}
                                    disabled={cancelSubstitution.isPending}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : null}
                            </Td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
