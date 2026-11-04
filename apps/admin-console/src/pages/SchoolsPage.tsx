import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
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
import { api, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatNumber } from '../lib/format';
import type { Paged, SchoolRow } from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';

export function SchoolsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['platform', 'schools', { page, search, status }],
    queryFn: () =>
      api.get<Paged<SchoolRow>>(
        `/platform/schools${queryString({
          page,
          pageSize: 25,
          q: search || undefined,
          status: status || undefined,
        })}`,
      ),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schools"
        description="Every tenant on the platform, with plan, status and student counts."
        actions={
          user?.role === 'SUPER_ADMIN' ? (
            <Link to="/schools/new">
              <Button>Onboard school</Button>
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="school-search">Search</Label>
              <Input
                id="school-search"
                type="search"
                placeholder="School name or subdomain"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <Label htmlFor="school-status">Status</Label>
              <Select
                id="school-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option value="TRIAL">Trial</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No schools match"
          description="Adjust the filters or onboard a new tenant."
          action={
            user?.role === 'SUPER_ADMIN' ? (
              <Link to="/schools/new">
                <Button variant="outline" size="sm">
                  Onboard school
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>School</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Students</Th>
                  <Th>Trial ends</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((school) => (
                  <tr
                    key={school.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/schools/${school.id}`)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') navigate(`/schools/${school.id}`);
                    }}
                  >
                    <Td>
                      <Link
                        to={`/schools/${school.id}`}
                        className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {school.name}
                      </Link>
                      <p className="font-mono text-xs text-slate-500">{school.slug}</p>
                    </Td>
                    <Td>{school.plan?.name ?? '—'}</Td>
                    <Td>
                      <Badge tone={statusTone(school.status)}>{school.status}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(school._count.students)}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{formatDate(school.trialEndsAt)}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{formatDate(school.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? 25}
            total={query.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
