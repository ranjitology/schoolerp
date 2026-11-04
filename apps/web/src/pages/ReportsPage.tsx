import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
  cn,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, percent, todayIso } from '../lib/format';
import type {
  ReportAttendance,
  ReportEnrollment,
  ReportFees,
  ReportModules,
  ReportOverview,
  ReportPayroll,
} from '../lib/types';
import { ErrorPanel, StatGrid, TableSkeleton } from '../components/Feedback';

type Tab = 'overview' | 'enrollment' | 'attendance' | 'fees' | 'modules' | 'payroll';

export function ReportsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayIso());

  const canRead = hasPermission('analytics:read');
  const canExport = hasPermission('analytics:export');
  const canPayroll = hasPermission('payroll:read');

  const overviewQuery = useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: () => api.get<ReportOverview>('/reports/overview'),
    enabled: canRead,
  });
  const enrollmentQuery = useQuery({
    queryKey: ['reports', 'enrollment'],
    queryFn: () => api.get<ReportEnrollment>('/reports/enrollment'),
    enabled: canRead && tab === 'enrollment',
  });
  const attendanceQuery = useQuery({
    queryKey: ['reports', 'attendance', from, to],
    queryFn: () => api.get<ReportAttendance>(`/reports/attendance${queryString({ from, to })}`),
    enabled: canRead && tab === 'attendance',
  });
  const feesQuery = useQuery({
    queryKey: ['reports', 'fees', from, to],
    queryFn: () => api.get<ReportFees>(`/reports/fees${queryString({ from, to })}`),
    enabled: canRead && tab === 'fees',
  });
  const modulesQuery = useQuery({
    queryKey: ['reports', 'modules'],
    queryFn: () => api.get<ReportModules>('/reports/modules'),
    enabled: canRead && tab === 'modules',
  });
  const payrollQuery = useQuery({
    queryKey: ['reports', 'payroll'],
    queryFn: () => api.get<ReportPayroll>('/reports/payroll'),
    enabled: canPayroll && tab === 'payroll',
  });

  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['enrollment', 'Enrollment'],
    ['attendance', 'Attendance'],
    ['fees', 'Fees'],
    ['modules', 'Modules'],
  ];
  if (canPayroll) tabs.push(['payroll', 'Payroll']);

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Reports" description="Analytics and exports" />
        <EmptyState
          title="Analytics not available"
          description="Your role does not have permission to view reports."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Enrollment, attendance, finance and module analytics"
        actions={
          canExport ? (
            <>
              <Button variant="outline" onClick={() => void api.download('/reports/export?report=enrollment', 'enrollment.csv')}>
                Export enrollment
              </Button>
              <Button variant="outline" onClick={() => void api.download('/reports/export?report=fees', 'fees.csv')}>
                Export fees
              </Button>
            </>
          ) : undefined
        }
      />

      <SavedReportsCard
        current={{ report: tab, from, to }}
        canExport={canExport}
        onLoad={(config) => {
          setTab(config.report);
          if (config.from) setFrom(config.from);
          if (config.to) setTo(config.to);
        }}
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {tabs.map(([value, label]) => (
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

      {tab === 'attendance' || tab === 'fees' ? (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="report-from">From</Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="max-w-[170px]"
            />
          </div>
          <div>
            <Label htmlFor="report-to">To</Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="max-w-[170px]"
            />
          </div>
        </div>
      ) : null}

      {tab === 'overview' ? (
        overviewQuery.isLoading ? (
          <TableSkeleton columns={4} />
        ) : overviewQuery.isError ? (
          <ErrorPanel error={overviewQuery.error} onRetry={() => void overviewQuery.refetch()} />
        ) : overviewQuery.data ? (
          <OverviewTab data={overviewQuery.data} />
        ) : null
      ) : null}

      {tab === 'enrollment' ? (
        enrollmentQuery.isLoading ? (
          <TableSkeleton columns={4} />
        ) : enrollmentQuery.isError ? (
          <ErrorPanel error={enrollmentQuery.error} onRetry={() => void enrollmentQuery.refetch()} />
        ) : enrollmentQuery.data ? (
          <EnrollmentTab data={enrollmentQuery.data} />
        ) : null
      ) : null}

      {tab === 'attendance' ? (
        attendanceQuery.isLoading ? (
          <TableSkeleton columns={4} />
        ) : attendanceQuery.isError ? (
          <ErrorPanel error={attendanceQuery.error} onRetry={() => void attendanceQuery.refetch()} />
        ) : attendanceQuery.data ? (
          <AttendanceTab data={attendanceQuery.data} />
        ) : null
      ) : null}

      {tab === 'fees' ? (
        feesQuery.isLoading ? (
          <TableSkeleton columns={4} />
        ) : feesQuery.isError ? (
          <ErrorPanel error={feesQuery.error} onRetry={() => void feesQuery.refetch()} />
        ) : feesQuery.data ? (
          <FeesTab data={feesQuery.data} />
        ) : null
      ) : null}

      {tab === 'modules' ? (
        modulesQuery.isLoading ? (
          <TableSkeleton columns={4} />
        ) : modulesQuery.isError ? (
          <ErrorPanel error={modulesQuery.error} onRetry={() => void modulesQuery.refetch()} />
        ) : modulesQuery.data ? (
          <ModulesTab data={modulesQuery.data} />
        ) : null
      ) : null}

      {tab === 'payroll' ? (
        payrollQuery.isLoading ? (
          <TableSkeleton columns={4} />
        ) : payrollQuery.isError ? (
          <ErrorPanel error={payrollQuery.error} onRetry={() => void payrollQuery.refetch()} />
        ) : (
          <PayrollTab data={payrollQuery.data} />
        )
      ) : null}
    </div>
  );
}

interface SavedReportConfig {
  report: Tab;
  from?: string;
  to?: string;
  classId?: string;
}

interface SavedReport {
  id: string;
  name: string;
  config: SavedReportConfig;
  isDefault: boolean;
  createdAt: string;
}

function SavedReportsCard({
  current,
  canExport,
  onLoad,
}: {
  current: SavedReportConfig;
  canExport: boolean;
  onLoad: (config: SavedReportConfig) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['reports', 'saved'],
    queryFn: () => api.get<SavedReport[]>('/reports/saved'),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post<SavedReport>('/reports/saved', {
        name,
        config: {
          report: current.report,
          ...(current.from ? { from: current.from } : {}),
          ...(current.to ? { to: current.to } : {}),
        },
        isDefault: false,
      }),
    onSuccess: () => {
      setName('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Could not save this view'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/saved/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] }),
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Saved reports</CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          Save the current tab and date range, then reload or export it later.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="saved-report-name">Name this view</Label>
            <Input
              id="saved-report-name"
              value={name}
              maxLength={80}
              placeholder={`${current.report} · ${current.from ?? 'all time'}`}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            loading={save.isPending}
            disabled={name.trim().length < 2}
            onClick={() => save.mutate()}
          >
            Save current view
          </Button>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {query.isLoading ? (
          <TableSkeleton rows={2} columns={3} />
        ) : query.isError ? (
          <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">No saved reports yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data?.map((saved) => (
              <li
                key={saved.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{saved.name}</p>
                  <p className="text-xs text-slate-500">
                    {saved.config.report}
                    {saved.config.from ? ` · ${saved.config.from} → ${saved.config.to ?? 'today'}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onLoad(saved.config)}>
                    Load
                  </Button>
                  {canExport ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void api.download(
                          `/reports/saved/${saved.id}/export`,
                          `${saved.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.csv`,
                        )
                      }
                    >
                      Export
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={remove.isPending}
                    onClick={() => remove.mutate(saved.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewTab({ data }: { data: ReportOverview }) {
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard
          label="Active students"
          value={data.students}
          hint={`${data.studentGrowthPercent.toFixed(1)}% growth`}
          tone="positive"
        />
        <StatCard label="Staff" value={data.staff} />
        <StatCard label="Collected this month" value={formatMoney(data.collectedThisMonthMinor)} />
        <StatCard
          label="Outstanding"
          value={formatMoney(data.outstandingMinor)}
          tone={data.outstandingMinor > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Attendance rate" value={percent(data.attendanceRate)} />
        <StatCard label="Pending admissions" value={data.pendingAdmissions} />
      </StatGrid>
      <Card>
        <CardHeader>
          <CardTitle>Receivables aging</CardTitle>
        </CardHeader>
        <CardContent>
          <AgingBars rows={data.aging} />
        </CardContent>
      </Card>
    </div>
  );
}

function EnrollmentTab({ data }: { data: ReportEnrollment }) {
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Students" value={data.students} />
        <StatCard label="Classes" value={data.classes} />
        <StatCard label="Sections" value={data.sections} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By status</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleCounts rows={data.byStatus} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By gender</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleCounts rows={data.byGender} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Class and section distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrap className="rounded-none border-0">
            <Table>
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Section</Th>
                  <Th>Students</Th>
                </tr>
              </thead>
              <tbody>
                {data.byClassSection.map((row) => (
                  <tr key={`${row.classId}-${row.sectionId}`}>
                    <Td className="font-medium text-slate-900">{row.className}</Td>
                    <Td>{row.sectionName}</Td>
                    <Td className="tabular-nums">{row.students}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceTab({ data }: { data: ReportAttendance }) {
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Records" value={data.total} />
        <StatCard label="Present" value={data.present} tone="positive" />
        <StatCard label="Attendance rate" value={percent(data.rate)} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By status</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleCounts rows={data.byStatus} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Daily trend</CardTitle>
          </CardHeader>
          <CardContent>
            {data.daily.length === 0 ? (
              <p className="text-sm text-slate-500">No attendance in this range.</p>
            ) : (
              <div className="space-y-2">
                {data.daily.slice(-14).map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-24 text-xs text-slate-500">{day.date}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, day.rate)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-xs tabular-nums text-slate-600">
                      {percent(day.rate)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FeesTab({ data }: { data: ReportFees }) {
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Collected" value={formatMoney(data.collectedMinor)} tone="positive" />
        <StatCard label="Billed" value={formatMoney(data.billedMinor)} />
        <StatCard
          label="Outstanding"
          value={formatMoney(data.outstandingMinor)}
          tone={data.outstandingMinor > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Expenses" value={formatMoney(data.expensesMinor)} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly collections</CardTitle>
          </CardHeader>
          <CardContent>
            {data.series.length === 0 ? (
              <p className="text-sm text-slate-500">No collections in this range.</p>
            ) : (
              <div className="space-y-2">
                {data.series.map((point) => {
                  const max = Math.max(...data.series.map((row) => row.value), 1);
                  return (
                    <div key={point.period} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-slate-500">{point.period}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${Math.max(2, (point.value / max) * 100)}%` }}
                        />
                      </div>
                      <span className="w-28 text-right text-xs tabular-nums text-slate-600">
                        {formatMoney(point.value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleCounts rows={data.methods} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Outstanding aging</CardTitle>
        </CardHeader>
        <CardContent>
          <AgingBars rows={data.aging} />
        </CardContent>
      </Card>
    </div>
  );
}

function ModulesTab({ data }: { data: ReportModules }) {
  return (
    <StatGrid>
      <StatCard label="Library titles" value={data.libraryBooks} hint={`${data.libraryIssued} on loan`} />
      <StatCard label="Transport routes" value={data.transportRoutes} />
      <StatCard
        label="Hostel beds"
        value={data.hostelBeds}
        hint={`${data.hostelOccupied} occupied`}
      />
      <StatCard label="Inventory items" value={data.inventoryItems} />
      <StatCard label="Message threads" value={data.messageThreads} />
    </StatGrid>
  );
}

function PayrollTab({ data }: { data: ReportPayroll | undefined }) {
  if (!data || !data.latest) {
    return <EmptyState title="No payroll data" description="Create and process a payroll run first." />;
  }
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard
          label="Latest period"
          value={`${data.latest.run.month}/${data.latest.run.year}`}
        />
        <StatCard label="Gross" value={formatMoney(data.latest.grossMinor)} />
        <StatCard label="Deductions" value={formatMoney(data.latest.deductionsMinor)} />
        <StatCard label="Net" value={formatMoney(data.latest.netMinor)} tone="positive" />
      </StatGrid>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>Period</Th>
              <Th>Payslips</Th>
              <Th>Total</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((run) => (
              <tr key={run.id}>
                <Td>
                  {run.month}/{run.year}
                </Td>
                <Td className="tabular-nums">{run.payslipCount ?? 0}</Td>
                <Td className="tabular-nums">{formatMoney(run.totalMinor)}</Td>
                <Td>
                  <Badge tone="neutral">{run.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}

function SimpleCounts({ rows }: { rows: { key: string; count: number }[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No data.</p>;
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <span className="w-32 truncate text-xs text-slate-600">{row.key.replaceAll('_', ' ')}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-400"
              style={{ width: `${Math.max(2, (row.count / total) * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right text-xs tabular-nums text-slate-600">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function AgingBars({ rows }: { rows: { label: string; amountMinor: number; count: number }[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing outstanding.</p>;
  const max = Math.max(...rows.map((row) => row.amountMinor), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-24 text-xs text-slate-600">{row.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${Math.max(2, (row.amountMinor / max) * 100)}%` }}
            />
          </div>
          <span className="w-32 text-right text-xs tabular-nums text-slate-600">
            {formatMoney(row.amountMinor)} ({row.count})
          </span>
        </div>
      ))}
    </div>
  );
}
