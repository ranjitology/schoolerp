import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Label,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
  cn,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, percent, todayIso } from '../lib/format';
import type {
  AttendanceReport,
  AttendanceSession,
  AttendanceTotals,
  Paged,
  SchoolClass,
  StudentRow,
} from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

const STATUS_OPTIONS = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'] as const;
type AttendanceStatus = (typeof STATUS_OPTIONS)[number];

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  LEAVE: 'Leave',
};

export function AttendancePage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'register' | 'summary' | 'policy'>('register');
  const [date, setDate] = useState(todayIso());
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [period, setPeriod] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [remark, setRemark] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const classesQuery = useQuery({
    queryKey: ['academics', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/academics/classes'),
  });
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const sections = useMemo(
    () => classes.find((klass) => klass.id === classId)?.sections ?? [],
    [classes, classId],
  );

  const canRead = hasPermission('attendance:read');
  const canWrite = hasPermission('attendance:write');
  const selectionReady = Boolean(classId && sectionId);

  const sessionQuery = useQuery({
    queryKey: ['attendance', 'session', { date, classId, sectionId, period }],
    queryFn: () =>
      api.get<AttendanceSession>(
        `/attendance/session${queryString({ date, classId, sectionId, period })}`,
      ),
    enabled: selectionReady && canRead,
  });

  const rosterQuery = useQuery({
    queryKey: ['students', 'roster', { classId, sectionId }],
    queryFn: () =>
      api.get<Paged<StudentRow>>(
        `/students${queryString({ classId, sectionId, pageSize: 100, status: 'ACTIVE', sort: 'rollNo', order: 'asc' })}`,
      ),
    enabled: selectionReady && canRead,
  });

  const roster = useMemo(() => rosterQuery.data?.items ?? [], [rosterQuery.data]);

  useEffect(() => {
    if (!selectionReady) {
      setStatuses({});
      setRemark({});
      return;
    }
    const next: Record<string, AttendanceStatus> = {};
    const nextRemarks: Record<string, string> = {};
    for (const record of sessionQuery.data?.records ?? []) {
      next[record.studentId] = record.status as AttendanceStatus;
      if (record.remark) nextRemarks[record.studentId] = record.remark;
    }
    for (const student of roster) {
      if (!next[student.id]) next[student.id] = 'PRESENT';
    }
    setStatuses(next);
    setRemark(nextRemarks);
  }, [selectionReady, sessionQuery.data, roster]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ summary: AttendanceTotals; replaced: boolean }>('/attendance/bulk', {
        date,
        classId,
        sectionId,
        period,
        records: roster.map((student) => ({
          studentId: student.id,
          status: statuses[student.id] ?? 'PRESENT',
          ...(remark[student.id] ? { remark: remark[student.id] } : {}),
        })),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      setMessage(
        `Attendance saved${result.replaced ? ' (replaced the earlier register)' : ''}: ${result.summary.present + result.summary.late} present of ${result.summary.total}.`,
      );
      setSubmitError(null);
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not save attendance');
    },
  });

  const counts = useMemo(() => {
    const tally: Record<AttendanceStatus, number> = {
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      HALF_DAY: 0,
      LEAVE: 0,
    };
    for (const student of roster) {
      const status = statuses[student.id] ?? 'PRESENT';
      tally[status] += 1;
    }
    return tally;
  }, [roster, statuses]);

  if (!canRead) {
    return (
      <EmptyState
        title="Attendance is not available for your role"
        description="Ask a school administrator for the attendance:read permission."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Daily and period-wise registers with low-attendance tracking"
        actions={
          <div className="flex rounded-lg border border-slate-200 bg-white p-1" role="tablist" aria-label="Attendance views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              onClick={() => setTab('register')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                tab === 'register' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              Register
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'summary'}
              onClick={() => setTab('summary')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                tab === 'summary' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              Summary
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'policy'}
              onClick={() => setTab('policy')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                tab === 'policy' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              Policy
            </button>
          </div>
        }
      />

      {tab === 'register' ? (
        <>
          <Card className="mb-4">
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="attendance-date">Date</Label>
                <input
                  id="attendance-date"
                  type="date"
                  value={date}
                  max={todayIso()}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setMessage(null);
                  }}
                  className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
              <div>
                <Label htmlFor="attendance-class">Class</Label>
                <Select
                  id="attendance-class"
                  value={classId}
                  onChange={(event) => {
                    setClassId(event.target.value);
                    setSectionId('');
                    setMessage(null);
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
                <Label htmlFor="attendance-section">Section</Label>
                <Select
                  id="attendance-section"
                  value={sectionId}
                  onChange={(event) => {
                    setSectionId(event.target.value);
                    setMessage(null);
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
              <div>
                <Label htmlFor="attendance-period">Period</Label>
                <Select
                  id="attendance-period"
                  value={period}
                  onChange={(event) => setPeriod(Number(event.target.value))}
                >
                  <option value={0}>Daily register</option>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      Period {value}
                    </option>
                  ))}
                </Select>
              </div>
            </CardContent>
          </Card>

          {!selectionReady ? (
            <EmptyState
              title="Choose a class and section"
              description="Pick the class register you want to mark for the selected date."
            />
          ) : rosterQuery.isLoading || sessionQuery.isLoading ? (
            <TableSkeleton />
          ) : rosterQuery.isError ? (
            <ErrorPanel error={rosterQuery.error} onRetry={() => void rosterQuery.refetch()} />
          ) : roster.length === 0 ? (
            <EmptyState title="No active students in this section" description="Add students first, then come back to mark attendance." />
          ) : (
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>
                    {classes.find((klass) => klass.id === classId)?.name} · Section{' '}
                    {sections.find((section) => section.id === sectionId)?.name} · {formatDate(date)}
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    {sessionQuery.data?.session
                      ? `Previously submitted ${formatDate(sessionQuery.data.session.submittedAt)}`
                      : 'Not yet submitted'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setStatuses(Object.fromEntries(roster.map((student) => [student.id, 'PRESENT' as AttendanceStatus])))
                    }
                  >
                    Mark all present
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setStatuses(Object.fromEntries(roster.map((student) => [student.id, 'ABSENT' as AttendanceStatus])))
                    }
                  >
                    Mark all absent
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((status) => (
                    <Badge key={status} tone={statusTone(status)}>
                      {STATUS_LABELS[status]}: {counts[status]}
                    </Badge>
                  ))}
                </div>
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Roll</Th>
                        <Th>Student</Th>
                        <Th>Status</Th>
                        <Th>Remark</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.map((student) => {
                        const status = statuses[student.id] ?? 'PRESENT';
                        return (
                          <tr key={student.id}>
                            <Td className="w-16 tabular-nums text-slate-500">{student.rollNo ?? '—'}</Td>
                            <Td>
                              <span className="font-medium text-slate-900">
                                {student.fullName ?? `${student.firstName} ${student.lastName}`.trim()}
                              </span>
                              <span className="block font-mono text-xs text-slate-500">{student.admissionNo}</span>
                            </Td>
                            <Td className="w-44">
                              <Select
                                aria-label={`Attendance for ${student.firstName}`}
                                value={status}
                                onChange={(event) =>
                                  setStatuses((current) => ({
                                    ...current,
                                    [student.id]: event.target.value as AttendanceStatus,
                                  }))
                                }
                                disabled={!canWrite}
                              >
                                {STATUS_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {STATUS_LABELS[value]}
                                  </option>
                                ))}
                              </Select>
                            </Td>
                            <Td className="w-64">
                              <input
                                aria-label={`Remark for ${student.firstName}`}
                                value={remark[student.id] ?? ''}
                                maxLength={200}
                                onChange={(event) =>
                                  setRemark((current) => ({ ...current, [student.id]: event.target.value }))
                                }
                                placeholder="Optional"
                                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                                disabled={!canWrite}
                              />
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>

                {message ? (
                  <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {message}
                  </p>
                ) : null}
                {submitError ? (
                  <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {submitError}
                  </p>
                ) : null}

                {canWrite ? (
                  <div className="mt-4 flex justify-end">
                    <Button loading={submit.isPending} onClick={() => submit.mutate()}>
                      Save register
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </>
      ) : tab === 'summary' ? (
        <AttendanceSummary classes={classes} canRead={canRead} />
      ) : (
        <AttendancePolicyPanel canWrite={canWrite} />
      )}
    </div>
  );
}

interface AttendancePolicy {
  lateCountsPresent: boolean;
  halfDayWeight: number;
  excludeLeaveFromDenominator: boolean;
  lowAttendanceThreshold: number;
}

function AttendancePolicyPanel({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AttendancePolicy | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['attendance', 'policy'],
    queryFn: () => api.get<AttendancePolicy>('/attendance/policy'),
  });

  const save = useMutation({
    mutationFn: (policy: AttendancePolicy) => api.put<AttendancePolicy>('/attendance/policy', policy),
    onSuccess: (policy) => {
      setDraft(policy);
      setMessage('Attendance policy saved.');
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });

  const policy = draft ?? query.data ?? null;

  if (query.isLoading) return <TableSkeleton rows={3} columns={2} />;
  if (query.isError) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (!policy) return null;

  function update(patch: Partial<AttendancePolicy>) {
    setDraft({ ...policy, ...patch } as AttendancePolicy);
    setMessage(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance policy</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          These rules feed the daily totals, low-attendance flags and portal summaries.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={policy.lateCountsPresent}
            disabled={!canWrite}
            onChange={(event) => update({ lateCountsPresent: event.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">Late counts as present</span>
            <span className="block text-xs text-slate-500">
              A late student still contributes a full present day to the attendance percentage.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={policy.excludeLeaveFromDenominator}
            disabled={!canWrite}
            onChange={(event) => update({ excludeLeaveFromDenominator: event.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">Exclude leave from denominator</span>
            <span className="block text-xs text-slate-500">
              Approved leave does not lower a student&apos;s attendance percentage.
            </span>
          </span>
        </label>

        <div className="form-grid">
          <div>
            <Label htmlFor="halfDayWeight">Half-day weight</Label>
            <input
              id="halfDayWeight"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={policy.halfDayWeight}
              disabled={!canWrite}
              onChange={(event) => update({ halfDayWeight: Number(event.target.value) })}
              className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <p className="mt-1 text-xs text-slate-500">0 = absent, 0.5 = half day, 1 = full day.</p>
          </div>
          <div>
            <Label htmlFor="lowAttendanceThreshold">Low attendance threshold (%)</Label>
            <input
              id="lowAttendanceThreshold"
              type="number"
              min={0}
              max={100}
              step={1}
              value={policy.lowAttendanceThreshold}
              disabled={!canWrite}
              onChange={(event) => update({ lowAttendanceThreshold: Number(event.target.value) })}
              className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <p className="mt-1 text-xs text-slate-500">Students below this value are flagged in reports.</p>
          </div>
        </div>

        {message ? (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
        {save.isError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {save.error instanceof ApiError ? save.error.message : 'Could not save the policy'}
          </p>
        ) : null}

        {canWrite ? (
          <div className="flex justify-end">
            <Button loading={save.isPending} onClick={() => save.mutate(policy)}>
              Save policy
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">You need attendance:write to change these rules.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceSummary({ classes, canRead }: { classes: SchoolClass[]; canRead: boolean }) {
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const to = todayIso();
  const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['attendance', 'summary', { classId, sectionId, from, to }],
    queryFn: () =>
      api.get<AttendanceReport>(
        `/attendance/summary${queryString({
          from,
          to,
          classId: classId || undefined,
          sectionId: sectionId || undefined,
        })}`,
      ),
    enabled: canRead,
  });

  const sections = classes.find((klass) => klass.id === classId)?.sections ?? [];
  const data = query.data;
  const lowIds = new Set((data?.lowAttendance ?? []).map((row) => row.studentId));

  return (
    <div>
      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="summary-class">Class</Label>
            <Select
              id="summary-class"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId('');
              }}
            >
              <option value="">All classes</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="summary-section">Section</Label>
            <Select id="summary-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)} disabled={!classId}>
              <option value="">All sections</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <p className="text-xs text-slate-500">
              Last 30 days · {formatDate(from)} to {formatDate(to)}
            </p>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? null : (
        <>
          <div className="data-grid mb-4">
            <SummaryCard label="Overall attendance" value={percent(data.overall.attendancePercent)} tone="positive" />
            <SummaryCard label="Present" value={data.overall.present + data.overall.late} />
            <SummaryCard label="Absent" value={data.overall.absent} tone="danger" />
            <SummaryCard
              label={`Below ${data.policy.lowAttendanceThreshold}%`}
              value={data.lowAttendance.length}
              tone={data.lowAttendance.length > 0 ? 'warning' : 'positive'}
            />
          </div>

          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Leave</Th>
                  <Th className="text-right">Attendance</Th>
                  <Th>Flag</Th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((row) => (
                  <tr key={row.studentId}>
                    <Td>
                      <span className="font-medium text-slate-900">{row.name}</span>
                      <span className="block font-mono text-xs text-slate-500">{row.admissionNo}</span>
                    </Td>
                    <Td>
                      {row.className} · {row.sectionName}
                    </Td>
                    <Td className="text-right tabular-nums">{row.summary.present + row.summary.late}</Td>
                    <Td className="text-right tabular-nums">{row.summary.absent}</Td>
                    <Td className="text-right tabular-nums">{row.summary.leave}</Td>
                    <Td className="text-right tabular-nums font-medium">{percent(row.summary.attendancePercent)}</Td>
                    <Td>
                      {lowIds.has(row.studentId) ? <Badge tone="danger">Low</Badge> : <Badge tone="success">OK</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'positive' | 'danger' | 'warning';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'danger'
        ? 'text-rose-600'
        : tone === 'warning'
          ? 'text-amber-600'
          : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}
