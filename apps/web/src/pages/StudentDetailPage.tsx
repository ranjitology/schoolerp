import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney } from '../lib/format';
import type { StudentLedger, StudentRow } from '../lib/types';
import { ErrorPanel } from '../components/Feedback';
import { Modal } from '../components/Modal';

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const studentQuery = useQuery({
    queryKey: ['student', id],
    queryFn: () => api.get<StudentRow>(`/students/${id}`),
    enabled: Boolean(id),
  });

  const ledgerQuery = useQuery({
    queryKey: ['student-ledger', id],
    queryFn: () => api.get<StudentLedger>(`/fees/students/${id}/ledger`),
    enabled: Boolean(id) && hasPermission('fees:read'),
  });

  const archive = useMutation({
    mutationFn: () => api.delete(`/students/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['students'] });
      navigate('/students', { replace: true });
    },
    onError: (error) => {
      setActionError(error instanceof ApiError ? error.message : 'Could not archive this student');
    },
  });

  if (studentQuery.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (studentQuery.isError) {
    return <ErrorPanel error={studentQuery.error} onRetry={() => void studentQuery.refetch()} />;
  }

  const student = studentQuery.data;
  if (!student) return null;

  return (
    <div>
      <PageHeader
        title={student.fullName ?? `${student.firstName} ${student.lastName}`.trim()}
        description={`${student.className ?? 'Unassigned'} · Section ${student.sectionName ?? '—'} · Admission ${student.admissionNo}`}
        actions={
          <>
            <Link to="/students">
              <Button variant="ghost" size="sm">
                Back to students
              </Button>
            </Link>
            {hasPermission('students:write') ? (
              <Button variant="outline" size="sm" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label="Status">
                <Badge tone={statusTone(student.status)}>{student.status}</Badge>
              </Row>
              <Row label="Gender">{student.gender.toLowerCase()}</Row>
              <Row label="Date of birth">{formatDate(student.dateOfBirth)}</Row>
              <Row label="Admission date">{formatDate(student.admissionDate)}</Row>
              <Row label="Roll number">{student.rollNo ?? '—'}</Row>
              <Row label="Phone">{student.phone ?? '—'}</Row>
              <Row label="Email">{student.email ?? '—'}</Row>
              <Row label="Previous school">{student.previousSchool ?? '—'}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Guardians</CardTitle>
          </CardHeader>
          <CardContent>
            {!student.guardians || student.guardians.length === 0 ? (
              <p className="text-sm text-slate-500">No guardian recorded.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {student.guardians.map((guardian, index) => (
                  <li key={guardian.id ?? index} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{guardian.fullName}</p>
                      {guardian.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {guardian.relation.toLowerCase()} · {guardian.phone}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {student.documents && student.documents.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-slate-900">Documents</h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {student.documents.map((document) => (
                    <li key={document.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="text-slate-700">{document.title}</span>
                      <Badge tone="neutral">{document.kind}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {hasPermission('fees:read') ? (
        <Card className="mt-6">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Fee ledger</CardTitle>
            <Badge tone="info">{ledgerQuery.data?.invoices.length ?? 0} invoices</Badge>
          </CardHeader>
          <CardContent>
            {ledgerQuery.isLoading ? (
              <Skeleton className="h-40" />
            ) : ledgerQuery.isError ? (
              <ErrorPanel error={ledgerQuery.error} onRetry={() => void ledgerQuery.refetch()} />
            ) : !ledgerQuery.data || ledgerQuery.data.invoices.length === 0 ? (
              <EmptyState title="No invoices" description="Generate invoices from the Fees page to bill this student." />
            ) : (
              <>
                <div className="data-grid mb-5">
                  <StatCard label="Billed" value={formatMoney(ledgerQuery.data.summary.totalBilledMinor)} />
                  <StatCard label="Paid" value={formatMoney(ledgerQuery.data.summary.totalPaidMinor)} />
                  <StatCard
                    label="Outstanding"
                    value={formatMoney(ledgerQuery.data.summary.outstandingMinor)}
                    tone={ledgerQuery.data.summary.outstandingMinor > 0 ? 'warning' : 'positive'}
                  />
                  <StatCard
                    label="Advance"
                    value={formatMoney(ledgerQuery.data.summary.advanceMinor)}
                    tone="positive"
                  />
                </div>
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Invoice</Th>
                        <Th>Issued</Th>
                        <Th>Due</Th>
                        <Th className="text-right">Total</Th>
                        <Th className="text-right">Paid</Th>
                        <Th className="text-right">Outstanding</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerQuery.data.invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <Td className="font-mono text-xs">{invoice.number}</Td>
                          <Td>{formatDate(invoice.issueDate)}</Td>
                          <Td>{formatDate(invoice.dueDate)}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(invoice.totalMinor)}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(invoice.paidMinor)}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(invoice.outstandingMinor)}</Td>
                          <Td>
                            <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Modal
        open={confirmArchive}
        title="Archive this student?"
        description="The record is hidden from lists and portals but retained for audit and fee history. This is a soft delete."
        onClose={() => setConfirmArchive(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate()}>
              Archive student
            </Button>
          </>
        }
      >
        {actionError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionError}
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Archive <strong>{student.fullName}</strong>? You can still find archived records in the
            audit trail.
          </p>
        )}
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-800">{children}</dd>
    </div>
  );
}
