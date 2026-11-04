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
  Select,
  StatCard,
  Table,
  TableWrap,
  Td,
  Th,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import type { BillingInvoice, BillingOverview, BillingSubscription } from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

export function BillingPage() {
  const { user } = useAuth();
  const allowed = user?.role === 'SUPER_ADMIN' || user?.role === 'BILLING';
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [dunningAsOf, setDunningAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<BillingInvoice | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [planTarget, setPlanTarget] = useState<BillingSubscription | null>(null);
  const [planId, setPlanId] = useState('');
  const [planReason, setPlanReason] = useState('');

  const query = useQuery({
    queryKey: ['platform', 'billing'],
    queryFn: () => api.get<BillingOverview>('/platform/billing'),
    enabled: allowed,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'billing'] });
  }

  const runInvoices = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<{
        period: string;
        dryRun: boolean;
        invoicesCreated: number;
        invoicesSkipped: number;
        totalMinor: number;
      }>('/platform/billing/invoices/run', { period, dryRun }),
    onSuccess: (result) => {
      setMessage(
        `${result.dryRun ? 'Preview' : 'Invoice run'} for ${result.period}: ${
          result.invoicesCreated
        } invoice(s), ${formatMoney(result.totalMinor)}, ${result.invoicesSkipped} skipped.`,
      );
      refresh();
    },
  });

  const runDunning = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<{
        asOf: string;
        dryRun: boolean;
        checked: number;
        escalated: number;
        reminders: number;
        suspended: number;
      }>('/platform/billing/dunning/run', { asOf: dunningAsOf, dryRun }),
    onSuccess: (result) => {
      setMessage(
        `${result.dryRun ? 'Preview' : 'Dunning run'} as of ${result.asOf}: ${result.checked} open invoice(s), ${
          result.reminders
        } reminder(s), ${result.escalated} escalation(s), ${result.suspended} suspension(s).`,
      );
      refresh();
    },
  });

  const markPaid = useMutation({
    mutationFn: (invoiceId: string) =>
      api.post<{ subscriptionRestored: boolean }>(
        `/platform/billing/invoices/${invoiceId}/paid`,
        {},
      ),
    onSuccess: (result) => {
      setMessage(
        result.subscriptionRestored
          ? 'Invoice marked paid and the subscription was restored to active.'
          : 'Invoice marked paid.',
      );
      refresh();
    },
  });

  const voidInvoice = useMutation({
    mutationFn: () =>
      api.post(`/platform/billing/invoices/${voidTarget?.id}/void`, { reason: voidReason }),
    onSuccess: () => {
      setMessage('Invoice voided.');
      setVoidTarget(null);
      setVoidReason('');
      refresh();
    },
  });

  const changePlan = useMutation({
    mutationFn: () =>
      api.patch<{
        changed: boolean;
        invoice: { number: string; amountMinor: number; currency: string } | null;
      }>(`/platform/schools/${planTarget?.schoolId}/plan`, {
        planId,
        prorate: true,
        ...(planReason ? { reason: planReason } : {}),
      }),
    onSuccess: (result) => {
      setMessage(
        result.invoice
          ? `Plan changed. Proration invoice ${result.invoice.number} for ${formatMoney(
              result.invoice.amountMinor,
              result.invoice.currency,
            )} created.`
          : 'Plan changed with no proration invoice.',
      );
      setPlanTarget(null);
      setPlanId('');
      setPlanReason('');
      refresh();
    },
  });

  const actionError =
    runInvoices.error ??
    runDunning.error ??
    markPaid.error ??
    voidInvoice.error ??
    changePlan.error;

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing" description="Subscriptions and platform invoices." />
        <EmptyState
          title="Billing access restricted"
          description="Only super admins and billing operators can view revenue and invoices."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Subscriptions, recurring revenue and platform invoices across every tenant."
      />

      <Card>
        <CardHeader>
          <CardTitle>Billing automation</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Invoice runs are idempotent per tenant and month. Dunning escalates overdue invoices
            through reminders, past due and suspension.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="invoice-period">Invoice period</Label>
              <Input
                id="invoice-period"
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={runInvoices.isPending}
                  onClick={() => runInvoices.mutate(true)}
                >
                  Preview run
                </Button>
                <Button
                  size="sm"
                  loading={runInvoices.isPending}
                  onClick={() => runInvoices.mutate(false)}
                >
                  Run invoices
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="dunning-date">Dunning as of</Label>
              <Input
                id="dunning-date"
                type="date"
                value={dunningAsOf}
                onChange={(event) => setDunningAsOf(event.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={runDunning.isPending}
                  onClick={() => runDunning.mutate(true)}
                >
                  Preview dunning
                </Button>
                <Button
                  size="sm"
                  loading={runDunning.isPending}
                  onClick={() => runDunning.mutate(false)}
                >
                  Run dunning
                </Button>
              </div>
            </div>
          </div>

          {message ? (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {actionError instanceof ApiError ? actionError.message : 'Billing action failed'}
            </p>
          ) : null}
        </CardContent>
      </Card>

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
            <StatCard
              label="Active subscriptions"
              value={formatNumber(query.data.summary.active)}
              hint={`${query.data.summary.trialing} on trial`}
              tone="positive"
            />
            <StatCard
              label="Monthly recurring revenue"
              value={formatMoney(query.data.summary.mrrMinor)}
              hint="Yearly plans normalised to monthly"
            />
            <StatCard
              label="Outstanding invoices"
              value={formatMoney(query.data.summary.outstandingMinor)}
              tone={query.data.summary.outstandingMinor > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Past due"
              value={formatNumber(query.data.summary.pastDue)}
              tone={query.data.summary.pastDue > 0 ? 'danger' : 'default'}
            />
          </div>

          <Card>
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
                      <Th>Limits</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.plans.map((plan) => (
                      <tr key={plan.id}>
                        <Td>
                          <span className="font-medium text-slate-900">{plan.name}</span>
                          <span className="ml-2 font-mono text-xs text-slate-500">{plan.code}</span>
                        </Td>
                        <Td>{plan.interval}</Td>
                        <Td className="text-right tabular-nums">
                          {formatMoney(plan.priceMinor, plan.currency)}
                        </Td>
                        <Td className="max-w-xs truncate font-mono text-xs text-slate-500">
                          {JSON.stringify(plan.limits)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Subscriptions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {query.data.subscriptions.length === 0 ? (
                <EmptyState title="No subscriptions" description="Onboard a school to create one." />
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>School</Th>
                        <Th>Plan</Th>
                        <Th>Status</Th>
                        <Th>Period end</Th>
                        <Th>Renewal</Th>
                        <Th className="text-right">Action</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.subscriptions.map((subscription) => (
                        <tr key={subscription.id}>
                          <Td>
                            <p className="font-medium text-slate-900">{subscription.schoolName}</p>
                            <p className="font-mono text-xs text-slate-500">{subscription.schoolSlug}</p>
                          </Td>
                          <Td>{subscription.planName}</Td>
                          <Td>
                            <Badge tone={statusTone(subscription.status)}>{subscription.status}</Badge>
                          </Td>
                          <Td>{formatDate(subscription.currentPeriodEnd)}</Td>
                          <Td className="text-slate-600">
                            {subscription.cancelAtPeriodEnd ? 'Cancels at period end' : 'Auto-renews'}
                          </Td>
                          <Td className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPlanTarget(subscription);
                                setPlanId('');
                                setPlanReason('');
                              }}
                            >
                              Change plan
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Platform invoices</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {query.data.invoices.length === 0 ? (
                <EmptyState
                  title="No invoices yet"
                  description="Issued platform invoices will appear here."
                />
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Number</Th>
                        <Th>School</Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Status</Th>
                        <Th>Due</Th>
                        <Th>Paid</Th>
                        <Th className="text-right">Action</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <Td className="font-mono text-xs">{invoice.number}</Td>
                          <Td>{invoice.schoolName}</Td>
                          <Td className="text-right tabular-nums">
                            {formatMoney(invoice.amountMinor, invoice.currency)}
                          </Td>
                          <Td>
                            <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
                          </Td>
                          <Td>{formatDate(invoice.dueAt)}</Td>
                          <Td>{formatDate(invoice.paidAt)}</Td>
                          <Td>
                            {invoice.status === 'OPEN' ? (
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  loading={markPaid.isPending}
                                  onClick={() => markPaid.mutate(invoice.id)}
                                >
                                  Mark paid
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setVoidTarget(invoice);
                                    setVoidReason('');
                                  }}
                                >
                                  Void
                                </Button>
                              </div>
                            ) : null}
                          </Td>
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

      <Modal
        open={Boolean(voidTarget)}
        title={`Void invoice ${voidTarget?.number ?? ''}`}
        description="Voiding keeps the invoice for audit but removes it from the outstanding balance."
        onClose={() => setVoidTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={voidInvoice.isPending}
              disabled={voidReason.trim().length < 3}
              onClick={() => voidInvoice.mutate()}
            >
              Void invoice
            </Button>
          </>
        }
      >
        <Label htmlFor="void-reason">Reason</Label>
        <Input
          id="void-reason"
          value={voidReason}
          onChange={(event) => setVoidReason(event.target.value)}
          placeholder="Duplicate run, tenant credit, …"
        />
      </Modal>

      <Modal
        open={Boolean(planTarget)}
        title={`Change plan · ${planTarget?.schoolName ?? ''}`}
        description="The unused value of the current plan is credited and any difference is invoiced immediately."
        onClose={() => setPlanTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={changePlan.isPending}
              disabled={!planId}
              onClick={() => changePlan.mutate()}
            >
              Change plan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="plan-target">New plan</Label>
            <Select
              id="plan-target"
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
            >
              <option value="">Select a plan</option>
              {query.data?.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} · {plan.interval} · {formatMoney(plan.priceMinor, plan.currency)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="plan-reason">Reason (optional)</Label>
            <Input
              id="plan-reason"
              value={planReason}
              onChange={(event) => setPlanReason(event.target.value)}
              placeholder="Upgrade, downgrade, retention offer…"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
