import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
  statusTone,
} from '@schoolerp/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';
import type { PayrollRunDetail, PayrollRunRow } from '../lib/types';
import { ErrorPanel, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function PayrollPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => api.get<PayrollRunRow[]>('/payroll/runs'),
  });

  const createRun = useMutation({
    mutationFn: () => api.post<PayrollRunRow>('/payroll/runs', { year, month }),
    onSuccess: () => {
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
    },
  });

  const processRun = useMutation({
    mutationFn: (id: string) => api.post<PayrollRunRow>(`/payroll/runs/${id}/process`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['payroll'] }),
  });

  const runs = runsQuery.data ?? [];
  const latest = runs[0];

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Monthly payroll runs, payslip generation and disbursement"
        actions={
          hasPermission('payroll:write') ? (
            <Button onClick={() => setCreateOpen(true)}>New payroll run</Button>
          ) : undefined
        }
      />

      <div className="mb-6">
        <StatGrid>
          <StatCard label="Payroll runs" value={runs.length} />
          <StatCard
            label="Latest period"
            value={latest ? `${MONTHS[latest.month - 1]} ${latest.year}` : '—'}
          />
          <StatCard
            label="Latest total"
            value={latest ? formatMoney(latest.totalMinor) : '—'}
            tone="positive"
          />
          <StatCard
            label="Payslips in latest run"
            value={latest?.payslipCount ?? 0}
            hint={latest ? latest.status : undefined}
          />
        </StatGrid>
      </div>

      {processRun.isError ? <ErrorPanel error={processRun.error} /> : null}
      {runsQuery.isLoading ? (
        <TableSkeleton columns={6} />
      ) : runsQuery.isError ? (
        <ErrorPanel error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
      ) : runs.length === 0 ? (
        <EmptyState
          title="No payroll runs yet"
          description="Create a monthly run, generate payslips and process it when ready."
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Payslips</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th>Processed</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <Td className="font-medium text-slate-900">
                    {MONTHS[run.month - 1]} {run.year}
                  </Td>
                  <Td className="tabular-nums">{run.payslipCount ?? 0}</Td>
                  <Td className="tabular-nums">{formatMoney(run.totalMinor)}</Td>
                  <Td>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </Td>
                  <Td>{formatDateTime(run.processedAt)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(run.id)}>
                        View
                      </Button>
                      {hasPermission('payroll:write') && run.status !== 'PAID' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={processRun.isPending}
                          onClick={() => processRun.mutate(run.id)}
                        >
                          Process
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New payroll run"
        description="Create a draft run for a calendar month."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createRun.isPending}
              onClick={() => createRun.mutate()}
            >
              {createRun.isPending ? 'Creating…' : 'Create run'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="payroll-year">Year</Label>
            <Input
              id="payroll-year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="payroll-month">Month</Label>
            <Select
              id="payroll-month"
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {MONTHS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {createRun.isError ? (
          <p role="alert" className="mt-3 text-sm text-rose-600">
            {createRun.error instanceof Error ? createRun.error.message : 'Could not create run'}
          </p>
        ) : null}
      </Modal>

      <PayrollDetailModal
        runId={detailId}
        canWrite={hasPermission('payroll:write')}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

function PayrollDetailModal({
  runId,
  canWrite,
  onClose,
}: {
  runId: string | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const runQuery = useQuery({
    queryKey: ['payroll', 'run', runId],
    queryFn: () => api.get<PayrollRunDetail>(`/payroll/runs/${runId}`),
    enabled: Boolean(runId),
  });

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ generated: number }>('/payroll/payslips/generate', {
        payrollRunId: runId,
        includeInactive: false,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll'] });
    },
  });

  const run = runQuery.data;

  return (
    <Modal
      open={Boolean(runId)}
      onClose={onClose}
      wide
      title={run ? `Payroll ${MONTHS[run.month - 1]} ${run.year}` : 'Payroll run'}
      description={run ? `${run.payslips.length} payslips · ${run.status}` : 'Loading…'}
      footer={
        <>
          {canWrite && run ? (
            <Button
              variant="outline"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Generating…' : 'Generate payslips'}
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {runQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : runQuery.isError ? (
        <ErrorPanel error={runQuery.error} onRetry={() => void runQuery.refetch()} />
      ) : !run || run.payslips.length === 0 ? (
        <EmptyState
          title="No payslips"
          description="Generate payslips to compute net pay for each staff member."
        />
      ) : (
        <>
          {generate.isError ? (
            <p className="mb-3 text-sm text-rose-600">{generate.error.message}</p>
          ) : null}
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Staff</Th>
                  <Th>Base</Th>
                  <Th>Allowances</Th>
                  <Th>Deductions</Th>
                  <Th>Net</Th>
                </tr>
              </thead>
              <tbody>
                {run.payslips.map((slip) => (
                  <tr key={slip.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{slip.staffName}</p>
                      <p className="text-xs text-slate-500">{slip.employeeNo}</p>
                    </Td>
                    <Td className="tabular-nums">{formatMoney(slip.baseMinor)}</Td>
                    <Td className="tabular-nums">{formatMoney(slip.allowancesMinor)}</Td>
                    <Td className="tabular-nums">{formatMoney(slip.deductionsMinor)}</Td>
                    <Td className="tabular-nums font-medium">{formatMoney(slip.netMinor)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}
    </Modal>
  );
}
