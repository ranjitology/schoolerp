import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
import { formatDateTime, formatMoney, formatNumber } from '../lib/format';
import type { PlatformStats } from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

export function DashboardPage() {
  const { user } = useAuth();
  const canSeeStats = user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING';

  const query = useQuery({
    queryKey: ['platform', 'stats'],
    queryFn: () => api.get<PlatformStats>('/platform/stats'),
    enabled: canSeeStats,
  });

  if (!canSeeStats) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Welcome, ${user?.fullName ?? 'operator'}`}
          description="Support workspace for tenant troubleshooting."
        />
        <EmptyState
          title="Support access"
          description="Your role can browse schools and announcements. Aggregate billing statistics and the control-plane audit log are limited to super admins and billing."
          action={
            <Link className="text-sm font-medium text-brand-700 underline" to="/schools">
              Open the school directory
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Tenant health, subscription plans and recent control-plane activity."
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
            <StatCard label="Tenants" value={formatNumber(query.data.totalSchools)} hint="Excluding deleted tenants" />
            <StatCard
              label="Active"
              value={formatNumber(query.data.schools.ACTIVE ?? 0)}
              tone="positive"
              hint={`${query.data.schools.TRIAL ?? 0} on trial`}
            />
            <StatCard label="Students" value={formatNumber(query.data.students)} hint="Across all tenants" />
            <StatCard label="Staff" value={formatNumber(query.data.staff)} hint="Across all tenants" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Tenant status</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED'].map((status) => (
                    <li key={status} className="flex items-center justify-between gap-3">
                      <Badge tone={statusTone(status)}>{status.toLowerCase()}</Badge>
                      <span className="font-medium tabular-nums text-slate-900">
                        {formatNumber(query.data.schools[status] ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Plans</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Plan</Th>
                        <Th>Interval</Th>
                        <Th className="text-right">Price</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.plans.map((plan) => (
                        <tr key={plan.code}>
                          <Td>
                            <span className="font-medium text-slate-900">{plan.name}</span>
                            <span className="ml-2 font-mono text-xs text-slate-500">{plan.code}</span>
                          </Td>
                          <Td>{plan.interval}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(plan.priceMinor, plan.currency)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <CardTitle>Recent platform activity</CardTitle>
              <Link to="/audit" className="text-sm font-medium text-brand-700 underline">
                Full audit log
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {query.data.recentAudit.length === 0 ? (
                <EmptyState title="No platform activity yet" />
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>When</Th>
                        <Th>Action</Th>
                        <Th>Entity</Th>
                        <Th>Actor</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.recentAudit.map((entry) => (
                        <tr key={entry.id}>
                          <Td className="whitespace-nowrap text-slate-600">{formatDateTime(entry.createdAt)}</Td>
                          <Td>
                            <span className="font-mono text-xs">{entry.action}</span>
                          </Td>
                          <Td>{entry.entity}</Td>
                          <Td className="text-slate-600">{entry.platformUserId ?? 'system'}</Td>
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
