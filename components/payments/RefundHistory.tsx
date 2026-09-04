'use client';

/**
 * Every refund against one payment, from the ledger.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `payment_refunds` records the amount, the currency, the REASON, which surface
 * it came from and when it succeeded — and until now nothing read it. A payment
 * showing "-₪150 refunded" could not say when, why, or whether that was one
 * refund or three.
 *
 * The transaction's own columns cannot answer this: they hold a summary, so two
 * refunds collapse into one number and only the most recent reason survives.
 *
 * Failed and pending refunds are shown too, and labelled. A refund that did not
 * go through is money the owner believes they returned and did not — the single
 * most useful row on this list when it exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { describeRefundReason } from '@/lib/payments/refundReasons';

interface LedgerRow {
  id: string;
  amount: number | string;
  currency: string;
  status: string;
  reason: string | null;
  source: string;
  failure_message: string | null;
  succeeded_at: string | null;
  created_at: string;
}

interface Props {
  transactionId: string;
  t: (key: string) => string;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string) => string;
}

const STATUS_DOT: Record<string, string> = {
  succeeded: 'bg-emerald-500',
  pending: 'bg-amber-500',
  failed: 'bg-red-500',
  canceled: 'bg-slate-300',
};

export function RefundHistory({ transactionId, t, formatCurrency, formatDate }: Props) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/payments/refunds?list=1&transaction_id=${transactionId}`)
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (cancelled) return;
        setRows(body?.success ? (body.data?.refunds ?? []) : []);
      })
      .catch(() => {
        // An unreadable history is not worth an error banner over a payment the
        // rest of this drawer is describing correctly.
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-[12px] text-[var(--v2-text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }

  // Nothing to say. A payment that was never refunded should not carry an empty
  // "refunds" heading.
  if (!rows || rows.length === 0) return null;

  return (
    <div className="border-t border-[var(--v2-border)] pt-2">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--v2-text-muted)]">
        {t('payments.refund.history')}
      </p>

      {rows.map(row => (
        <div key={row.id} className="flex items-start gap-2 py-1 text-[12px]">
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[row.status] ?? 'bg-slate-300'}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="tabular-nums text-[var(--v2-text-primary)]">
                {formatCurrency(Number(row.amount), row.currency)}
              </span>
              <bdi className="text-[var(--v2-text-muted)]">
                {formatDate(row.succeeded_at ?? row.created_at)}
              </bdi>
              {/* Only when it is not the ordinary case — a succeeded refund
                  needs no label, a failed one is the whole point. */}
              {row.status !== 'succeeded' && (
                <span className="text-[var(--v2-text-muted)]">
                  {t(`payments.refund.status.${row.status}`)}
                </span>
              )}
            </div>

            {/* WHY, labelled and in the reader's language.
                A recognised reason is translated; anything else is shown as the
                owner wrote it, because their own words are the record. Labelled
                either way — an unlabelled fragment under an amount reads as a
                note to nobody. */}
            {row.reason && (
              <bdi className="block text-[var(--v2-text-muted)]">
                <span className="text-[var(--v2-text-muted)]">
                  {t('payments.refund.reason_label_short')}:{' '}
                </span>
                {describeRefundReason(row.reason, t)}
              </bdi>
            )}

            {row.status === 'failed' && row.failure_message && (
              <bdi className="block text-red-600">{row.failure_message}</bdi>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
