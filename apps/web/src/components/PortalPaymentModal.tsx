import { useEffect, useState } from 'react';
import { Badge, Button, Label, Select, statusTone } from '@schoolerp/ui';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { ChildCard, PaymentIntentRow } from '../lib/types';
import { Modal } from './Modal';

type PortalInvoice = ChildCard['fees']['invoices'][number];

const PROVIDERS = [
  { value: 'mock', label: 'Mock (local testing)' },
  { value: 'esewa', label: 'eSewa' },
  { value: 'khalti', label: 'Khalti' },
  { value: 'stripe', label: 'Card (Stripe)' },
  { value: 'bank', label: 'Bank transfer' },
];

export function PortalPaymentModal({
  open,
  child,
  invoice,
  onClose,
  onPaid,
}: {
  open: boolean;
  child: ChildCard;
  invoice: PortalInvoice | null;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [provider, setProvider] = useState('mock');
  const [intent, setIntent] = useState<PaymentIntentRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invoiceId = invoice?.id ?? null;
  useEffect(() => {
    setIntent(null);
    setMessage(null);
    setError(null);
    setBusy(false);
  }, [invoiceId]);

  function close() {
    setIntent(null);
    setMessage(null);
    setError(null);
    setBusy(false);
    onClose();
  }

  if (!invoice) return null;
  const activeInvoice = invoice;

  async function startCheckout() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await api.post<PaymentIntentRow>('/portal/payments/checkout', {
        studentId: child.student.id,
        invoiceId: activeInvoice.id,
        provider,
        returnUrl: window.location.href,
      });
      setIntent(response);
      if (response.checkoutUrl) {
        setMessage('Payment page created. Open it in a new tab to finish the payment.');
      } else if (provider === 'mock') {
        setMessage('Mock checkout created. Complete the test payment below.');
      } else {
        setMessage(
          'This payment gateway is not configured for the school yet. Please contact the school office.',
        );
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the payment');
    } finally {
      setBusy(false);
    }
  }

  async function completeMock() {
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/portal/payments/intents/${intent.id}/confirm`);
      setMessage('Payment recorded. Your invoice balance has been updated.');
      onPaid();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not complete the payment');
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      const latest = await api.get<PaymentIntentRow>(`/portal/payments/intents/${intent.id}`);
      setIntent(latest);
      if (latest.status === 'SUCCEEDED') {
        setMessage('Payment confirmed. Your invoice balance has been updated.');
        onPaid();
      } else {
        setMessage(`Payment status: ${latest.status}. If you have just paid, try again in a moment.`);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not refresh the payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Pay invoice ${invoice.number}`}
      description={`${child.student.name} · outstanding ${formatMoney(invoice.outstandingMinor)}`}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          {!intent ? (
            <Button onClick={() => void startCheckout()} loading={busy}>
              Start payment
            </Button>
          ) : null}
          {intent?.checkoutUrl ? (
            <a className="inline-flex" href={intent.checkoutUrl} target="_blank" rel="noreferrer">
              <Button variant="outline">Open payment page</Button>
            </a>
          ) : null}
          {intent && provider === 'mock' && intent.status !== 'SUCCEEDED' ? (
            <Button onClick={() => void completeMock()} loading={busy}>
              Complete test payment
            </Button>
          ) : null}
          {intent && provider !== 'mock' ? (
            <Button variant="outline" onClick={() => void refreshStatus()} loading={busy}>
              Check status
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
          <div>
            <dt className="text-xs text-slate-500">Invoice</dt>
            <dd className="font-medium text-slate-900">{invoice.number}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Due date</dt>
            <dd className="font-medium text-slate-900">{invoice.dueDate}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Balance</dt>
            <dd className="font-medium text-slate-900">{formatMoney(invoice.outstandingMinor)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Status</dt>
            <dd>
              <Badge tone={statusTone(invoice.status)}>{invoice.status}</Badge>
            </dd>
          </div>
        </dl>

        {!intent ? (
          <div>
            <Label htmlFor="portal-payment-provider">Payment method</Label>
            <Select
              id="portal-payment-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              {PROVIDERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-slate-500">
              Gateway availability depends on the school&apos;s payment configuration. The mock
              method only works outside production.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-slate-700">
              Intent <span className="font-mono text-xs">{intent.id.slice(0, 8)}…</span> ·{' '}
              {formatMoney(intent.amountMinor, intent.currency)}
            </p>
            <Badge tone={statusTone(intent.status)}>{intent.status}</Badge>
          </div>
        )}

        {message ? (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
