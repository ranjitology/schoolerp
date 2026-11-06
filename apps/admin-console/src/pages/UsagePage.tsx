import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
  statusTone,
} from '@schoolerp/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatNumber } from '../lib/format';
import type { UsageOverview, UsageSchool } from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

function sloTone(status: UsageSchool['slo']['status']) {
  if (status === 'OK') return 'success' as const;
  if (status === 'AT_RISK') return 'warning' as const;
  if (status === 'BREACH') return 'danger' as const;
  return 'neutral' as const;
}

function metricLabel(metric: string): string {
  return metric
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function UsagePage() {
  const { user } = useAuth();
  const allowed = user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING';

  const query = useQuery({
    queryKey: ['platform', 'usage'],
    queryFn: () => api.get<UsageOverview>('/platform/usage'),
    enabled: allowed,
  });

  const metrics = useMemo(() => {
    const keys = new Set<string>();
    for (const school of query.data?.bySchool ?? []) {
      for (const key of Object.keys(school.meters)) keys.add(key);
    }
    return [...keys].sort();
  }, [query.data]);

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Usage" description="Per-tenant metering." />
        <EmptyState
          title="Usage access restricted"
          description="Only super admins and billing operators can view tenant metering."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage & metering"
        description="Live entity counts and billable meters across every tenant."
      />

      {query.isLoading ? (
        <div className="data-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <TableSkeleton key={index} rows={1} columns={1} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <>
          <div className="data-grid">
            <StatCard label="Tenants" value={formatNumber(query.data.totals.schools)} />
            <StatCard label="Students" value={formatNumber(query.data.totals.students)} />
            <StatCard label="Staff" value={formatNumber(query.data.totals.staff)} />
            <StatCard
              label="Monthly recurring"
              value={formatMoney(query.data.cost.mrrMinor, query.data.cost.currency)}
              hint="Allocated plan value across active tenants"
            />
            <StatCard
              label={`Job SLO (${query.data.slo.windowDays}d)`}
              value={
                query.data.slo.overallSuccessRate === null
                  ? 'No data'
                  : `${query.data.slo.overallSuccessRate.toFixed(2)}%`
              }
              hint={`Target ${query.data.slo.targetPercent}%`}
              tone={
                query.data.slo.overallSuccessRate === null
                  ? 'default'
                  : query.data.slo.overallSuccessRate >= query.data.slo.targetPercent
                    ? 'positive'
                    : 'warning'
              }
            />
            <StatCard
              label="SLO breaches"
              value={formatNumber(query.data.slo.breach)}
              hint={`${query.data.slo.atRisk} at risk · ${query.data.slo.noData} without data`}
              tone={query.data.slo.breach > 0 ? 'danger' : 'positive'}
            />
          </div>

          {Object.keys(query.data.totals.meters).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Meter totals · {query.data.period}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(query.data.totals.meters).map(([metric, value]) => (
                    <Badge key={metric} tone="neutral">
                      {metricLabel(metric)}: {formatNumber(value)}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Usage by tenant</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {query.data.bySchool.length === 0 ? (
                <EmptyState title="No tenants yet" description="Onboard a school to see usage." />
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>School</Th>
                        <Th>Plan</Th>
                        <Th>Status</Th>
                        <Th>Data plane</Th>
                        <Th>Job SLO</Th>
                        <Th className="text-right">Avg job</Th>
                        <Th className="text-right">Monthly cost</Th>
                        <Th className="text-right">Cost / student</Th>
                        <Th className="text-right">Students</Th>
                        <Th className="text-right">Staff</Th>
                        {metrics.map((metric) => (
                          <Th key={metric} className="text-right">
                            {metricLabel(metric)}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.bySchool.map((school) => (
                        <tr key={school.id}>
                          <Td>
                            <p className="font-medium text-slate-900">{school.name}</p>
                            <p className="font-mono text-xs text-slate-500">{school.slug}</p>
                          </Td>
                          <Td>{school.planCode ?? '—'}</Td>
                          <Td>
                            <Badge tone={statusTone(school.status)}>{school.status}</Badge>
                          </Td>
                          <Td>
                            <Badge tone="neutral">{school.dataPlane}</Badge>
                          </Td>
                          <Td>
                            <Badge tone={sloTone(school.slo.status)}>{school.slo.status}</Badge>
                            <p className="mt-1 text-xs text-slate-500">
                              {school.slo.successRate === null
                                ? 'No finished jobs'
                                : `${school.slo.successRate.toFixed(2)}% · ${school.slo.jobs.failed} failed`}
                            </p>
                          </Td>
                          <Td className="text-right tabular-nums">
                            {school.slo.avgDurationMs === null
                              ? '—'
                              : `${formatNumber(school.slo.avgDurationMs)} ms`}
                            {school.slo.p95DurationMs === null ? null : (
                              <p className="text-xs text-slate-500">
                                p95 {formatNumber(school.slo.p95DurationMs)} ms
                              </p>
                            )}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {formatMoney(school.cost.monthlyMinor, school.cost.currency)}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {formatMoney(school.cost.perStudentMinor, school.cost.currency)}
                          </Td>
                          <Td className="text-right tabular-nums">{formatNumber(school.students)}</Td>
                          <Td className="text-right tabular-nums">{formatNumber(school.staff)}</Td>
                          {metrics.map((metric) => (
                            <Td key={metric} className="text-right tabular-nums">
                              {formatNumber(school.meters[metric] ?? 0)}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
