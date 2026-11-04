import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Table,
  TableWrap,
  Td,
  Th,
} from '@schoolerp/ui';
import { api, queryString } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Paged, PlatformAuditRow } from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const query = useQuery({
    queryKey: ['platform', 'audit', { page, action, entity, schoolId, from, to }],
    queryFn: () =>
      api.get<Paged<PlatformAuditRow>>(
        `/platform/audit${queryString({
          page,
          pageSize: 50,
          action: action || undefined,
          entity: entity || undefined,
          schoolId: schoolId || undefined,
          from: from ? new Date(`${from}T00:00:00Z`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59Z`).toISOString() : undefined,
        })}`,
      ),
  });

  function applyFilters(): void {
    setPage(1);
    void query.refetch();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform audit"
        description="Control-plane actions: logins, tenant changes, announcements and impersonation."
      />

      <Card>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="audit-action">Action</Label>
              <Input
                id="audit-action"
                placeholder="platform.login"
                value={action}
                onChange={(event) => setAction(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="audit-entity">Entity</Label>
              <Input
                id="audit-entity"
                placeholder="School"
                value={entity}
                onChange={(event) => setEntity(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="audit-school">School ID</Label>
              <Input
                id="audit-school"
                placeholder="UUID"
                value={schoolId}
                onChange={(event) => setSchoolId(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="audit-from">From</Label>
              <Input
                id="audit-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="audit-to">To</Label>
              <Input
                id="audit-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={applyFilters}>Apply filters</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No audit entries" description="Adjust the filters or wait for operator activity." />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Tenant</Th>
                  <Th>Actor</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-slate-600">{formatDateTime(entry.createdAt)}</Td>
                    <Td>
                      <span className="font-mono text-xs">{entry.action}</span>
                    </Td>
                    <Td>
                      {entry.entity}
                      {entry.entityId ? (
                        <span className="ml-1 font-mono text-[11px] text-slate-400">
                          {entry.entityId.slice(0, 8)}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="font-mono text-xs text-slate-500">
                      {entry.schoolId ? entry.schoolId.slice(0, 8) : '—'}
                    </Td>
                    <Td className="text-slate-600">
                      {entry.platformUser?.email ?? entry.platformUserId ?? 'system'}
                    </Td>
                    <Td className="font-mono text-xs text-slate-500">{entry.ip ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? 50}
            total={query.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
