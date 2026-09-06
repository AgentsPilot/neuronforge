/**
 * Revenue, net of refunds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `refunded_amount` appeared ZERO times in the stats route, and the two ways a
 * refund shows up broke the number in opposite directions:
 *
 *   · a PARTIAL refund leaves `status = 'succeeded'`, so the whole original
 *     amount went on counting as revenue;
 *   · a FULL refund flips `status` to 'refunded', and the query filtered on
 *     'succeeded' — so the sale VANISHED from every breakdown, as though the
 *     business had never made it.
 *
 * Widening the filter and subtracting the refund are therefore a single change:
 * either alone makes the figure worse than it is now.
 *
 * The rules live here, apart from the 1,500-line stats route, because they are
 * the arithmetic behind a number the owner reports to other people — and the
 * only part of that route worth testing on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/revenueMath
 */

export interface RevenueRow {
  amount: number | string | null;
  refunded_amount?: number | string | null;
  currency?: string | null;
  /** What the processor kept. NULL when not yet known — never assume zero. */
  processor_fee?: number | string | null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** Everything collected, before anything went back. */
export function grossRevenue(rows: RevenueRow[]): number {
  return cents(rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
}

/**
 * What the business kept, per sale.
 *
 * Floored at zero per row rather than in aggregate: an over-refund on one sale
 * is a data problem with that sale, and letting it eat another sale's revenue
 * would hide it inside a number that merely looks low.
 */
export function netRevenue(rows: RevenueRow[]): number {
  return cents(
    rows.reduce(
      (sum, row) => sum + Math.max(0, (Number(row.amount) || 0) - (Number(row.refunded_amount) || 0)),
      0
    )
  );
}

export interface CurrencyRevenue {
  currency: string;
  gross: number;
  refunds: number;
  net: number;
}

/**
 * The same figures, kept apart by currency.
 *
 * A business billing in more than one currency has no single revenue number,
 * and subtracting a ¥ refund from a £ total is arithmetic nobody asked for.
 */
export function revenueByCurrency(rows: RevenueRow[]): CurrencyRevenue[] {
  const totals: Record<string, { gross: number; refunds: number; net: number }> = {};

  for (const row of rows) {
    const currency = (row.currency || 'unknown').toUpperCase();
    const bucket = (totals[currency] ??= { gross: 0, refunds: 0, net: 0 });
    const gross = Number(row.amount) || 0;
    const refunds = Number(row.refunded_amount) || 0;

    bucket.gross += gross;
    bucket.refunds += refunds;
    bucket.net += Math.max(0, gross - refunds);
  }

  return Object.entries(totals)
    .map(([currency, figures]) => ({
      currency,
      gross: cents(figures.gross),
      refunds: cents(figures.refunds),
      net: cents(figures.net),
    }))
    .sort((a, b) => b.net - a.net);
}

/**
 * What the processor kept, across a set of payments.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REFUND COSTS MONEY
 *
 * Stripe does not return the processing fee when a payment is refunded. Return
 * ₪200 to a client and the business is down roughly ₪6.30 with nothing to show
 * for it — but with no fee recorded, the sale and the refund cancel exactly and
 * the refund books as break-even. A business with many refunds looks flat while
 * it is genuinely losing money on every one.
 *
 * UNKNOWN IS NOT ZERO. A payment whose fee has not been fetched contributes
 * nothing to this total AND is counted in `unknown`, so a caller can say "fees
 * on 40 of 52 payments" rather than quietly under-reporting the other twelve.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function processorFees(rows: RevenueRow[]): {
  total: number;
  known: number;
  unknown: number;
} {
  let total = 0;
  let known = 0;
  let unknown = 0;

  for (const row of rows) {
    if (row.processor_fee === null || row.processor_fee === undefined) {
      unknown++;
      continue;
    }
    total += Number(row.processor_fee) || 0;
    known++;
  }

  return { total: cents(total), known, unknown };
}

/**
 * What the business actually kept: net of refunds AND of what the processor took.
 *
 * The figure a P&L wants, and the one no screen in this product could show —
 * every number here was what the CLIENT paid.
 */
export function trueNetRevenue(rows: RevenueRow[], refundsIssued = 0): number {
  return cents(grossRevenue(rows) - refundsIssued - processorFees(rows).total);
}
