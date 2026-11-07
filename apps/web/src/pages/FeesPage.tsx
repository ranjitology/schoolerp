import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
import { formatDate, formatMoney, percent, todayIso } from '../lib/format';
import {
  cachedFeeSummary,
  getCachedInvoices,
  getCachedStudents,
  paginateCachedDefaulters,
  paginateCachedInvoices,
  searchCachedStudents,
  withOfflineFallback,
} from '../lib/offline';
import type { Defaulter, FeeSummary, InvoiceRow, Paged } from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

type Tab = 'overview' | 'invoices' | 'defaulters';

export function FeesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [collectOpen, setCollectOpen] = useState(false);

  const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = todayIso();

  const summaryQuery = useQuery({
    queryKey: ['fees', 'summary', from, to],
    queryFn: () =>
      withOfflineFallback(
        () => api.get<FeeSummary>(`/fees/summary${queryString({ from, to })}`),
        async () => cachedFeeSummary(await getCachedInvoices({ limit: 5000 }), from, to),
      ),
    enabled: hasPermission('fees:read'),
  });

  if (!hasPermission('fees:read')) {
    return (
      <EmptyState
        title="Fees are not available for your role"
        description="Ask a school administrator for the fees:read permission."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Fees"
        description="Billing, collection and outstanding balances"
        actions={
          hasPermission('fees:collect') ? (
            <Button size="sm" onClick={() => setCollectOpen(true)}>
              Collect payment
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1" role="tablist" aria-label="Fee views">
        {(
          [
            ['overview', 'Overview'],
            ['invoices', 'Invoices'],
            ['defaulters', 'Defaulters'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              tab === value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        summaryQuery.isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : summaryQuery.isError ? (
          <ErrorPanel error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} />
        ) : summaryQuery.data ? (
          <FeeOverview summary={summaryQuery.data} />
        ) : null
      ) : null}

      {tab === 'invoices' ? <InvoicesTab /> : null}
      {tab === 'defaulters' ? <DefaultersTab from={from} /> : null}

      <CollectPaymentModal
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        onCollected={() => {
          setCollectOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['fees'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          void queryClient.invalidateQueries({ queryKey: ['student-ledger'] });
        }}
      />
    </div>
  );
}

function FeeOverview({ summary }: { summary: FeeSummary }) {
  return (
    <div className="space-y-6">
      <div className="data-grid">
        <SummaryTile label="Billed" value={formatMoney(summary.ledger.totalBilledMinor)} />
        <SummaryTile label="Collected" value={formatMoney(summary.ledger.totalPaidMinor)} tone="positive" />
        <SummaryTile
          label="Outstanding"
          value={formatMoney(summary.ledger.outstandingMinor)}
          tone={summary.ledger.outstandingMinor > 0 ? 'warning' : 'positive'}
        />
        <SummaryTile
          label="Overdue"
          value={formatMoney(summary.overdue.amountMinor)}
          hint={`${summary.overdue.count} invoices`}
          tone={summary.overdue.count > 0 ? 'danger' : 'positive'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Collection rate</CardTitle>
            <p className="mt-1 text-sm text-slate-500">All live invoices</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-slate-900">{percent(summary.ledger.collectionPercent)}</p>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={Math.round(summary.ledger.collectionPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Collection rate"
            >
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, summary.ledger.collectionPercent)}%` }}
              />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Net due</dt>
                <dd className="font-medium text-slate-900">{formatMoney(summary.ledger.netDueMinor)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Advance credit</dt>
                <dd className="font-medium text-slate-900">{formatMoney(summary.ledger.advanceMinor)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments this period</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {formatDate(summary.from)} – {formatDate(summary.to)}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Collected</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {formatMoney(summary.period.collectedMinor)}
                </p>
                <p className="text-xs text-slate-500">{summary.period.paymentCount} receipts</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Expenses</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {formatMoney(summary.period.expensesMinor)}
                </p>
                <p className="text-xs text-slate-500">{summary.period.expenseCount} entries</p>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">Net</p>
              <p className="text-lg font-semibold text-slate-900">{formatMoney(summary.period.netMinor)}</p>
            </div>
            {summary.byMethod.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {summary.byMethod.map((method) => (
                  <li key={method.method} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{method.method.replaceAll('_', ' ')}</span>
                    <span className="font-medium text-slate-900">
                      {formatMoney(method.amountMinor)}{' '}
                      <span className="text-xs font-normal text-slate-500">({method.count})</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InvoicesTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['fees', 'invoices', { page, status, search }],
    queryFn: () =>
      withOfflineFallback(
        () =>
          api.get<Paged<InvoiceRow>>(
            `/fees/invoices${queryString({
              page,
              pageSize: 25,
              status: status || undefined,
              q: search || undefined,
            })}`,
          ),
        async () =>
          paginateCachedInvoices(
            await getCachedInvoices({
              status: status || undefined,
              search: search || undefined,
              limit: 5000,
            }),
            { page, pageSize: 25, status, search },
          ),
      ),
  });

  return (
    <Card>
      <CardContent>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label htmlFor="invoice-search">Search</Label>
            <Input
              id="invoice-search"
              type="search"
              placeholder="Invoice number or student"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label htmlFor="invoice-status">Status</Label>
            <Select
              id="invoice-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="ISSUED">Issued</option>
              <option value="PARTIALLY_PAID">Partially paid</option>
              <option value="PAID">Paid</option>
              <option value="DRAFT">Draft</option>
              <option value="VOID">Void</option>
            </Select>
          </div>
        </div>

        {query.isLoading ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No invoices found" description="Generate invoices for a class to start billing." />
        ) : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Student</Th>
                    <Th>Issued</Th>
                    <Th>Due</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Outstanding</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.items.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50">
                      <Td className="font-mono text-xs">{invoice.number}</Td>
                      <Td>
                        {invoice.student ? (
                          <Link to={`/students/${invoice.student.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                            {invoice.student.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <span className="block text-xs text-slate-500">
                          {invoice.student?.className ?? ''} {invoice.student?.sectionName ?? ''}
                        </span>
                      </Td>
                      <Td>{formatDate(invoice.issueDate)}</Td>
                      <Td>{formatDate(invoice.dueDate)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(invoice.totalMinor)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(invoice.paidMinor)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(invoice.outstandingMinor)}</Td>
                      <Td>
                        <Badge tone={statusTone(invoice.status)}>{invoice.status.replaceAll('_', ' ')}</Badge>
                      </Td>
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
      </CardContent>
    </Card>
  );
}

function DefaultersTab({ from }: { from: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['fees', 'defaulters', { page, from }],
    queryFn: () =>
      withOfflineFallback(
        () =>
          api.get<Paged<Defaulter>>(
            `/fees/defaulters${queryString({ page, pageSize: 25, asOf: todayIso(), minOverdueDays: 1 })}`,
          ),
        async () =>
          paginateCachedDefaulters(
            await getCachedInvoices({ limit: 5000 }),
            todayIso(),
            1,
            page,
            25,
          ),
      ),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outstanding balances</CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Students with invoices overdue by at least one day · window from {formatDate(from)}
        </p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No defaulters" description="Every issued invoice is either paid or not yet due." />
        ) : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Guardian</Th>
                    <Th>Invoices</Th>
                    <Th>Oldest due</Th>
                    <Th className="text-right">Overdue days</Th>
                    <Th className="text-right">Outstanding</Th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.items.map((row) => (
                    <tr key={row.studentId}>
                      <Td>
                        <Link to={`/students/${row.studentId}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {row.name}
                        </Link>
                        <span className="block text-xs text-slate-500">
                          {row.className} · {row.sectionName} · {row.admissionNo}
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-sm">{row.guardianName ?? '—'}</span>
                        <span className="block text-xs text-slate-500">{row.guardianPhone ?? row.phone ?? ''}</span>
                      </Td>
                      <Td className="tabular-nums">{row.invoiceCount}</Td>
                      <Td>{formatDate(row.oldestDueDate)}</Td>
                      <Td className="text-right tabular-nums">{row.maxOverdueDays}</Td>
                      <Td className="text-right font-medium tabular-nums text-rose-700">
                        {formatMoney(row.outstandingMinor)}
                      </Td>
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
      </CardContent>
    </Card>
  );
}

interface SearchHit {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  class: { name: string };
  section: { name: string };
}

function CollectPaymentModal({
  open,
  onClose,
  onCollected,
}: {
  open: boolean;
  onClose: () => void;
  onCollected: () => void;
}) {
  const [search, setSearch] = useState('');
  const [student, setStudent] = useState<SearchHit | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ['student-search', search],
    queryFn: () =>
      withOfflineFallback(
        () =>
          api.get<SearchHit[]>(
            `/students/search${queryString({ q: search, limit: 8 })}`,
          ),
        async () =>
          searchCachedStudents(
            await getCachedStudents({ search, limit: 500 }),
            search,
            8,
          ),
      ),
    enabled: open && search.trim().length >= 2 && !student,
  });

  const collect = useMutation({
    mutationFn: () => {
      const amountMinor = Math.round(Number(amount) * 100);
      if (!student || !Number.isFinite(amountMinor) || amountMinor < 1) {
        throw new Error('Choose a student and enter a valid amount');
      }
      return api.post('/fees/payments', {
        studentId: student.id,
        amountMinor,
        method,
        paidAt: new Date().toISOString(),
        ...(reference ? { reference } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: () => {
      setStudent(null);
      setAmount('');
      setReference('');
      setSearch('');
      setError(null);
      onCollected();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'Payment failed');
    },
  });

  function close() {
    setStudent(null);
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Collect a payment"
      description="Payments allocate oldest invoices first. A receipt number is generated server-side."
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button loading={collect.isPending} onClick={() => collect.mutate()} disabled={!student || !amount}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {student ? (
          <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {student.firstName} {student.lastName}
              </p>
              <p className="text-xs text-slate-600">
                {student.admissionNo} · {student.class.name} {student.section.name}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStudent(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div>
            <Label htmlFor="payment-student">Student</Label>
            <Input
              id="payment-student"
              type="search"
              placeholder="Search by name or admission number"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {searchQuery.data && search.trim().length >= 2 ? (
              <ul className="mt-2 max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {searchQuery.data.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-slate-500">No students found</li>
                ) : (
                  searchQuery.data.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => setStudent(hit)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span>
                          <span className="font-medium text-slate-900">
                            {hit.firstName} {hit.lastName}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {hit.admissionNo} · {hit.class.name} {hit.section.name}
                          </span>
                        </span>
                        <span className="text-xs text-brand-700">Select</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        )}

        <div className="form-grid">
          <div>
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="payment-method">Method</Label>
            <Select id="payment-method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="ESEWA">eSewa</option>
              <option value="KHALTI">Khalti</option>
              <option value="CHEQUE">Cheque</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="payment-reference">Reference (optional)</Label>
          <Input
            id="payment-reference"
            value={reference}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Bank slip, cheque or wallet reference"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'danger'
          ? 'text-rose-600'
          : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
