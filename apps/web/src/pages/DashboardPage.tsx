import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
  Skeleton,
  StatCard,
  statusTone,
} from '@schoolerp/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, percent } from '../lib/format';
import type { ChildCard, DashboardMe, TimetableSlot } from '../lib/types';
import { ErrorPanel } from '../components/Feedback';
import { PortalPaymentModal } from '../components/PortalPaymentModal';

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function DashboardPage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['dashboard', 'me'],
    queryFn: () => api.get<DashboardMe>('/dashboard/me'),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <div className="data-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (query.isError) {
    return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  if (!data) return null;

  if (data.children && data.children.length > 0) {
    return <PortalDashboard data={data} />;
  }

  const overview = data.overview;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good day, ${firstName(data.fullName || user?.fullName || '')}`}
        description={`${user?.schoolName ?? 'Your school'} · ${formatDate(new Date())}`}
        actions={
          <>
            <Link to="/attendance">
              <Button variant="outline" size="sm">
                Mark attendance
              </Button>
            </Link>
            <Link to="/students">
              <Button size="sm">Open students</Button>
            </Link>
          </>
        }
      />

      {!overview ? (
        <EmptyPanelForRole role={data.role} />
      ) : (
        <>
          <div className="data-grid">
            <StatCard label="Active students" value={overview.counts.students} hint="Across all classes" />
            <StatCard label="Active staff" value={overview.counts.staff} hint={`${overview.counts.classes} classes`} />
            <StatCard
              label="Attendance today"
              value={percent(overview.attendance.today.attendancePercent)}
              hint={`${overview.attendance.today.present + overview.attendance.today.late} of ${overview.attendance.today.total} marked`}
              tone={
                overview.attendance.today.attendancePercent >= overview.policy.lowAttendanceThreshold
                  ? 'positive'
                  : 'warning'
              }
            />
            <StatCard
              label="Fees outstanding"
              value={formatMoney(overview.fees.outstandingMinor)}
              hint={`${overview.fees.overdueInvoices} overdue invoices`}
              tone={overview.fees.outstandingMinor > 0 ? 'warning' : 'positive'}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Attendance trend</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">Last seven days across the school</p>
                </div>
                <Badge tone="brand">Threshold {overview.policy.lowAttendanceThreshold}%</Badge>
              </CardHeader>
              <CardContent>
                {overview.attendance.trend.length === 0 ? (
                  <EmptyState title="No attendance marked yet" description="Attendance trends appear once teachers submit a class register." />
                ) : (
                  <div className="h-64" role="img" aria-label="Attendance percentage for the last seven days">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={overview.attendance.trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#1b6ff5" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#1b6ff5" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value: string) => value.slice(5)}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          formatter={(value) => [`${value}%`, 'Attendance']}
                        />
                        <Area
                          type="monotone"
                          dataKey="attendancePercent"
                          stroke="#1b6ff5"
                          strokeWidth={2}
                          fill="url(#attendanceFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fee collection</CardTitle>
                <p className="mt-1 text-sm text-slate-500">This month</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Collected</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {formatMoney(overview.fees.monthCollectedMinor)}
                  </p>
                  <p className="text-xs text-slate-500">{overview.fees.monthPaymentCount} receipts</p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Collection rate</span>
                    <span className="font-medium text-slate-700">{percent(overview.fees.collectionPercent)}</span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-valuenow={Math.round(overview.fees.collectionPercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Fee collection rate"
                  >
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(100, overview.fees.collectionPercent)}%` }}
                    />
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Billed</dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      {formatMoney(overview.fees.totalBilledMinor)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Paid</dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      {formatMoney(overview.fees.totalPaidMinor)}
                    </dd>
                  </div>
                </dl>
                <Link to="/fees" className="block">
                  <Button variant="outline" size="sm" className="w-full">
                    Review fees
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Latest notices</CardTitle>
                <Link to="/notices" className="text-sm font-medium text-brand-700 hover:underline">
                  View all
                </Link>
              </CardHeader>
              <CardContent>
                {overview.notices.length === 0 ? (
                  <p className="text-sm text-slate-500">No notices published yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {overview.notices.map((notice) => (
                      <li key={notice.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{notice.title}</p>
                          <p className="text-xs text-slate-500">
                            {notice.publishedAt ? formatDate(notice.publishedAt) : 'Draft'}
                          </p>
                        </div>
                        <Badge tone={priorityTone(notice.priority)}>{notice.priority}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Upcoming exams</CardTitle>
                <Badge tone="info">{overview.exams.length}</Badge>
              </CardHeader>
              <CardContent>
                {overview.exams.length === 0 ? (
                  <p className="text-sm text-slate-500">No exams scheduled.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {overview.exams.map((exam) => (
                      <li key={exam.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{exam.name}</p>
                          <p className="text-xs text-slate-500">
                            {exam.startsOn ? formatDate(exam.startsOn) : 'Date to be announced'} · {exam.type}
                          </p>
                        </div>
                        <Badge tone={statusTone(exam.status)}>{exam.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {data.timetable && data.timetable.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>My timetable</CardTitle>
                <p className="mt-1 text-sm text-slate-500">This week</p>
              </CardHeader>
              <CardContent>
                <WeekTimetable slots={data.timetable} />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function PortalDashboard({ data }: { data: DashboardMe }) {
  const queryClient = useQueryClient();
  const children = data.children ?? [];
  const [selectedId, setSelectedId] = useState(children[0]?.student.id ?? '');
  const selected = children.find((child) => child.student.id === selectedId) ?? children[0];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'me'] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${firstName(data.fullName)}`}
        description="Your children, attendance, fees and results in one place."
      />
      {children.length > 1 ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px]">
              <Label htmlFor="portal-child">Viewing child</Label>
              <Select
                id="portal-child"
                value={selected?.student.id ?? ''}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {children.map((child) => (
                  <option key={child.student.id} value={child.student.id}>
                    {child.student.name} · {child.student.className}-
                    {child.student.sectionName}
                  </option>
                ))}
              </Select>
            </div>
            <p className="pb-2 text-xs text-slate-500">
              Showing one child at a time so attendance, fees and results stay readable.
            </p>
          </CardContent>
        </Card>
      ) : null}
      {selected ? <ChildPanel key={selected.student.id} child={selected} onPaid={refresh} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Notices</CardTitle>
        </CardHeader>
        <CardContent>
          {data.notices.length === 0 ? (
            <p className="text-sm text-slate-500">No notices for you right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.notices.map((notice) => (
                <li key={notice.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{notice.title}</p>
                    <Badge tone={priorityTone(notice.priority)}>{notice.priority}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{notice.body}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(notice.publishedAt ?? notice.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChildPanel({ child, onPaid }: { child: ChildCard; onPaid: () => void }) {
  const [payingInvoice, setPayingInvoice] = useState<ChildCard['fees']['invoices'][number] | null>(
    null,
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{child.student.name}</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            {child.student.className} · Section {child.student.sectionName} · Roll{' '}
            {child.student.rollNo ?? '—'}
          </p>
        </div>
        <Badge tone={statusTone(child.student.status)}>{child.student.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="data-grid">
          <StatCard
            label="Attendance (90 days)"
            value={percent(child.attendance.attendancePercent)}
            hint={`${child.attendance.present + child.attendance.late} present of ${child.attendance.total}`}
            tone={child.attendance.attendancePercent >= 75 ? 'positive' : 'danger'}
          />
          <StatCard
            label="Fees outstanding"
            value={formatMoney(child.fees.outstandingMinor)}
            hint={`${child.fees.invoices.length} invoices`}
            tone={child.fees.outstandingMinor > 0 ? 'warning' : 'positive'}
          />
          <StatCard label="Results" value={child.results.length} hint="Recent marks" />
          <StatCard label="Homework" value={child.homework.length} hint="Due soon" />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Invoices</h3>
          {child.fees.invoices.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No invoices have been issued.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {child.fees.invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">{invoice.number}</p>
                    <p className="text-xs text-slate-500">
                      Due {formatDate(invoice.dueDate)} · {formatMoney(invoice.totalMinor)} ·{' '}
                      {invoice.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-600">
                      {invoice.outstandingMinor > 0
                        ? `${formatMoney(invoice.outstandingMinor)} due`
                        : 'Paid'}
                    </span>
                    {invoice.outstandingMinor > 0 ? (
                      <Button size="sm" onClick={() => setPayingInvoice(invoice)}>
                        Pay now
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PortalPaymentModal
          open={payingInvoice !== null}
          child={child}
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
          onPaid={() => {
            setPayingInvoice(null);
            onPaid();
          }}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Recent results</h3>
            {child.results.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No marks published yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {child.results.slice(0, 5).map((result) => (
                  <li key={result.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-slate-600">
                      {result.exam} · {result.subject}
                    </span>
                    <span className="font-medium text-slate-900">
                      {result.isAbsent ? 'Absent' : `${result.marksObtained}/${result.maxMarks}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Upcoming homework</h3>
            {child.homework.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nothing due right now.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {child.homework.slice(0, 5).map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-slate-600">
                      {task.subject} · {task.title}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(task.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {child.timetable.length > 0 ? <WeekTimetable slots={child.timetable} /> : null}
      </CardContent>
    </Card>
  );
}

function WeekTimetable({ slots }: { slots: TimetableSlot[] }) {
  const byDay = new Map<number, TimetableSlot[]>();
  for (const slot of slots) {
    const list = byDay.get(slot.dayOfWeek) ?? [];
    list.push(slot);
    byDay.set(slot.dayOfWeek, list);
  }
  const today = new Date().getDay() === 0 ? 7 : new Date().getDay();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].filter((day) => byDay.has(day) || day === today).map((day) => (
        <div key={day} className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {DAY_NAMES[day]} {day === today ? '· Today' : ''}
          </p>
          {(byDay.get(day) ?? []).length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">No periods scheduled</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {(byDay.get(day) ?? []).map((slot) => (
                <li key={slot.id} className="text-sm">
                  <span className="font-medium text-slate-800">{slot.subject}</span>
                  <span className="text-xs text-slate-500">
                    {' '}
                    · {slot.period.startTime}–{slot.period.endTime}
                    {slot.room ? ` · ${slot.room}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyPanelForRole({ role }: { role: string }) {
  return (
    <Card>
      <EmptyState
        title="Your dashboard is ready"
        description={`Signed in as ${role.toLowerCase().replaceAll('_', ' ')}. Ask your school administrator to grant dashboard reporting access if you expected school-wide statistics.`}
        action={
          <Link to="/notices">
            <Button variant="outline" size="sm">
              Read notices
            </Button>
          </Link>
        }
      />
    </Card>
  );
}

function priorityTone(priority: string): 'danger' | 'warning' | 'info' | 'neutral' {
  if (priority === 'URGENT' || priority === 'HIGH') return 'danger';
  if (priority === 'NORMAL') return 'info';
  return 'neutral';
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
