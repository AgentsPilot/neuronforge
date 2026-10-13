'use client';

/**
 * The eight money figures that are not one of the three headline ones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Nothing here was deleted from the page — it was demoted. A bookkeeper
 * reconciling a month still needs the collection rate and the processor fees;
 * an owner asking how the month went does not need them above the fold.
 *
 * Uniform tiles ON PURPOSE. These were five colour-coded cards (emerald, blue,
 * orange, purple, rose) which read as five different KINDS of thing when they
 * are all the same kind: one ratio or total about money this period. The colour
 * was carrying no information, so it is gone, and the one signal that IS real
 * (something needs attention) is carried by the value's own tone.
 *
 * EVERY RATE REFUSES TO ANSWER WHEN ITS DENOMINATOR IS ZERO. Nobody tried to
 * pay is not a 100% success rate; no invoices sent is not perfect collection;
 * no money collected is not a 0% refund rate. Each shows a dash, which says
 * "no rate" without implying a clean record the business has not earned.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PERFORMANCE_THRESHOLDS } from '@/lib/business-os/reports/constants';

export interface FinancialDetailProps {
  /** Charges accepted, refunded ones included. The success rate's numerator. */
  charged: number;
  failed: number;
  invoicesPaid: number;
  invoicesSent: number;
  overdueAmount: number;
  overdueCount: number;
  refunded: number;
  /** Collected BEFORE refunds, so the refund ratio cannot exceed 100%. */
  gross: number;
  /** What the processor kept on money it later returned. */
  refundFeesKept: number;
  averageInvoice: number;
  plansPaid: number;
  plansOutstanding: number;
  /**
   * Money quoted and undecided: proposals at 'sent' or 'viewed'.
   *
   * The fourth money state, and the one this page used to omit entirely — a
   * business with a quote out for 20,000 read identically to one with none.
   * Drafts are excluded upstream: nothing is waiting on a document the client
   * has never seen.
   */
  quoted: number;
  quotedCount: number;
  /**
   * What clients ORDERED in the period, priced from the service, paid or not.
   *
   * `booked_value_period`. A fifth money measure and the only one on an
   * order basis rather than a payment one, which is why its note says so:
   * bookings created in the period, cancelled ones excluded, at list price.
   */
  ordered: number;
  money: (amount: number) => string;
}

export function FinancialDetail(p: FinancialDetailProps) {
  const { t } = useLanguage();

  const attempted = p.charged + p.failed;
  const collectionRate = p.invoicesSent > 0 ? p.invoicesPaid / p.invoicesSent : null;
  const refundRate = p.gross > 0 ? p.refunded / p.gross : null;

  const tiles: { key: string; label: string; value: string; note: string; alarm?: boolean }[] = [
    /*
     * The COUNT of failures, not a success rate.
     *
     * ────────────────────────────────────────────────────────────────────────
     * This tile said "Success rate · 100% · 19 of 19 transactions", and an
     * owner reading it asked what it meant. Fairly: it is the card processor's
     * authorisation rate, it reads 100% on almost every account almost always,
     * and on the rare account where it does not, the number still does not say
     * which payment failed or what to do.
     *
     * A ratio whose informative state is "100%" is carrying no information. The
     * same data inverted does: zero failed payments is a clear all-clear, and
     * any other figure is a thing to go and look at. Same two numbers from the
     * same route, phrased as the question the owner actually has.
     * ────────────────────────────────────────────────────────────────────────
     */
    {
      key: 'failed',
      label: t('reports.tile_failed'),
      value: String(p.failed),
      note: t('reports.of_attempts').replace('{n}', String(attempted)),
      // Any failure at all is worth a look. There is no acceptable number of
      // payments that did not go through.
      alarm: p.failed > 0,
    },
    {
      key: 'collection',
      label: t('reports.tile_collection'),
      // Capped at 100: an overdue invoice counts as sent, so the ratio is sound,
      // but a late backfill can briefly put paid ahead of sent.
      value: collectionRate === null ? '—' : `${Math.min(100, Math.round(collectionRate * 100))}%`,
      note: `${p.invoicesPaid} ${t('reports.of')} ${p.invoicesSent} ${t('reports.invoices_paid')}`,
      alarm: collectionRate !== null && collectionRate < PERFORMANCE_THRESHOLDS.COLLECTION_RATE_GOOD,
    },
    {
      key: 'late',
      label: t('reports.tile_late'),
      value: p.money(p.overdueAmount),
      note: `${p.overdueCount} ${t('reports.overdue_invoices')}`,
      alarm: p.overdueCount > PERFORMANCE_THRESHOLDS.OUTSTANDING_WARNING,
    },
    {
      key: 'refund',
      label: t('reports.tile_refund'),
      value: refundRate === null ? '—' : `${Math.round(refundRate * 100)}%`,
      /*
       * The fee is part of what the refund cost. Stripe keeps its processing fee
       * on refunded money, so a full refund leaves the business down the fee as
       * well as the sale. Named only when there is one.
       */
      note:
        p.refundFeesKept > 0
          ? `${p.money(p.refunded)} ${t('reports.refunded')} · ${p.money(p.refundFeesKept)} ${t('reports.fees_kept')}`
          : `${p.money(p.refunded)} ${t('reports.refunded')}`,
      alarm: refundRate !== null && refundRate > PERFORMANCE_THRESHOLDS.REFUND_RATE_GOOD,
    },
    {
      key: 'average',
      label: t('reports.average_invoice'),
      value: p.money(p.averageInvoice),
      note: t('reports.per_paid_invoice'),
    },
    {
      key: 'plans',
      label: t('reports.tile_plans'),
      value: p.money(p.plansPaid + p.plansOutstanding),
      note: `${p.money(p.plansPaid)} ${t('reports.paid')} · ${p.money(p.plansOutstanding)} ${t('reports.owed')}`,
    },
    {
      key: 'ordered',
      label: t('reports.tile_ordered'),
      value: p.money(p.ordered),
      note: t('reports.ordered_note'),
    },
    {
      key: 'quoted',
      label: t('reports.tile_quoted'),
      value: p.money(p.quoted),
      note: t('reports.proposals_n').replace('{n}', String(p.quotedCount)),
      // Not an alarm at any value. A quote out is a good thing; it is simply
      // undecided, and nothing here is late or lost.
    },
  ];

  return (
    <div className="px-[18px] py-4 border-t border-[var(--v2-border)] bg-[var(--v2-bg)]">
      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {tiles.map(tile => (
          <div
            key={tile.key}
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[11px] px-3 py-2.5"
          >
            <div className="text-[11.5px] font-semibold text-[var(--v2-text-muted)]">{tile.label}</div>
            <div
              className={`text-[18px] font-bold tracking-[-0.02em] tabular-nums mt-0.5 ${
                tile.alarm ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--v2-text-primary)]'
              }`}
            >
              {tile.value}
            </div>
            <div className="text-[11.5px] text-[var(--v2-text-muted)] tabular-nums">{tile.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
