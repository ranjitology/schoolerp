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
import { formatNumber } from '../lib/format';
import type { UsageOverview } from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

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
            {Object.entries(query.data.totals.meters)
              .slice(0, 1)
              .map(([metric, value]) => (
                <StatCard
                  key={metric}
                  label={metricLabel(metric)}
                  value={formatNumber(value)}
                  hint={`Metered for ${query.data.period}`}
                />
              ))}
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
