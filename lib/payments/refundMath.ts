/**
 * Refund arithmetic. No I/O, no Stripe, no database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Separated out because this is where money bugs live, and because it is the
 * only part of the refund path that can be tested exhaustively without mocking
 * anything.
 *
 * Two units are in play and they are easy to confuse. Postgres stores
 * DECIMAL(10,2) in MAJOR units — 12.50 is twelve pounds fifty. Stripe works
 * exclusively in MINOR units — 1250. Every conversion between them is a chance
 * to be out by a factor of a hundred, in a system that moves real money.
 *
 * `Math.round(amount * 100)` — which the existing refund route uses — is wrong
 * twice over. It assumes every currency has two decimal places, and it goes
 * through a float. Neither assumption survives contact with a real currency
 * list.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

/**
 * Currencies with no minor unit: ¥1000 is 1000, not 100000.
 *
 * Getting this wrong overcharges by 100x. Stripe rejects the excess on a refund,
 * so the visible symptom is a refund that mysteriously fails — but on a CHARGE
 * the same mistake would go through.
 *
 * Source: Stripe's zero-decimal currency list.
 */
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/**
 * Currencies with three decimal places. Stripe requires the last digit to be
 * zero for these, so amounts are rounded to the nearest ten minor units.
 */
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/** How many minor units make one major unit of this currency. */
export function minorUnitsPerMajor(currency: string): number {
  const code = currency.trim().toLowerCase();
  if (ZERO_DECIMAL.has(code)) return 1;
  if (THREE_DECIMAL.has(code)) return 1000;
  return 100;
}

/**
 * Major units to the integer Stripe expects.
 *
 * Rounded rather than truncated, and rounded on a value already scaled to an
 * integer domain: 19.99 * 100 is 1998.9999999999998 in IEEE-754, and truncating
 * that returns 1998 — a penny short on every such refund, silently.
 */
export function toMinorUnits(amount: number, currency: string): number {
  const factor = minorUnitsPerMajor(currency);

  // The `toFixed` is not decoration. `1.005 * 100` is 100.49999999999999, so a
  // bare Math.round returns 100 and quietly loses a cent — the multiplication
  // has already pushed the value below the halfway point before rounding ever
  // sees it. Collapsing the representation error first means the rounding
  // decision is made on the number the caller actually meant.
  const scaled = Number((amount * factor).toFixed(4));
  const minor = Math.round(scaled);

  // Stripe requires three-decimal amounts to end in zero.
  if (factor === 1000) return Math.round(minor / 10) * 10;

  return minor;
}

/** The integer back to major units, for storing alongside the rest of the schema. */
export function fromMinorUnits(minor: number, currency: string): number {
  const factor = minorUnitsPerMajor(currency);
  // Fixed to the currency's own precision, so repeated conversions cannot
  // accumulate a trailing float error.
  return Number((minor / factor).toFixed(factor === 1 ? 0 : factor === 1000 ? 3 : 2));
}

/**
 * What is still refundable on a transaction.
 *
 * Computed in MINOR units throughout. Doing it in major units means comparing
 * floats, and `100 - 33.33 - 33.33 - 33.34` is 0.000000000000014 rather than 0 —
 * which would leave a transaction eternally one hundredth of a penny refundable
 * and let a fourth refund through.
 *
 * Never negative: an over-refunded row is broken data, and reporting a negative
 * remainder would invite callers to do arithmetic on it.
 */
export function remainingRefundableMinor(
  transactionAmount: number,
  refundedSoFar: number,
  currency: string
): number {
  const total = toMinorUnits(transactionAmount, currency);
  const used = toMinorUnits(refundedSoFar, currency);
  return Math.max(total - used, 0);
}

export type RefundStatus = 'none' | 'partial' | 'full';

/**
 * The refund status implied by an amount refunded.
 *
 * Mirrors `recompute_transaction_refund_state()` in
 * 20260828b_payment_refund_ledger.sql. The database is authoritative — this
 * exists so the API can predict what the trigger will decide without a round
 * trip, and the two must not diverge.
 */
export function deriveRefundStatus(
  transactionAmount: number,
  refundedTotal: number,
  currency: string
): RefundStatus {
  const total = toMinorUnits(transactionAmount, currency);
  const used = toMinorUnits(refundedTotal, currency);

  if (used <= 0) return 'none';
  if (used >= total) return 'full';
  return 'partial';
}

export type RefundAmountError =
  | 'NOT_POSITIVE'
  | 'EXCEEDS_REMAINING'
  | 'NOTHING_REMAINING';

export type RefundAmountDecision =
  | { ok: true; amountMinor: number; amountMajor: number }
  | { ok: false; error: RefundAmountError; remainingMinor: number };

/**
 * Validate and normalise a requested refund amount.
 *
 * An omitted amount means "everything still owed", which is what a full refund
 * actually is — NOT the transaction's original amount. Sending the original
 * amount after a partial refund is the bug in the current `refund_full` path:
 * it asks Stripe for more than remains, and records a full refund whatever
 * Stripe does with it.
 *
 * This is a convenience and a guard, not the guarantee. The real one is the
 * row-locking trigger in the database — two concurrent requests can both pass
 * this function.
 */
export function resolveRefundAmount(
  transactionAmount: number,
  refundedSoFar: number,
  currency: string,
  requestedMajor?: number | null
): RefundAmountDecision {
  const remainingMinor = remainingRefundableMinor(transactionAmount, refundedSoFar, currency);

  if (remainingMinor <= 0) {
    return { ok: false, error: 'NOTHING_REMAINING', remainingMinor: 0 };
  }

  if (requestedMajor === undefined || requestedMajor === null) {
    return {
      ok: true,
      amountMinor: remainingMinor,
      amountMajor: fromMinorUnits(remainingMinor, currency),
    };
  }

  const requestedMinor = toMinorUnits(requestedMajor, currency);

  if (requestedMinor <= 0) {
    return { ok: false, error: 'NOT_POSITIVE', remainingMinor };
  }

  if (requestedMinor > remainingMinor) {
    return { ok: false, error: 'EXCEEDS_REMAINING', remainingMinor };
  }

  return {
    ok: true,
    amountMinor: requestedMinor,
    amountMajor: fromMinorUnits(requestedMinor, currency),
  };
}
