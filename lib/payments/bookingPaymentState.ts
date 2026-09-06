/**
 * What a booking's money adds up to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three places answered "has this booking been paid, and has it been refunded"
 * differently, and they disagreed in a way the owner could see:
 *
 *   · the booking refund route read ONE transaction's `refund_status` and set
 *     `scheduling_bookings.payment_status` from it — so refunding a single
 *     period of a twelve-period plan marked the whole booking refunded;
 *   · the delete guard read `payment_status === 'refunded'`, which only that
 *     route ever writes, so money refunded from the money list left the booking
 *     reading `paid` and the guard refused to delete it, saying "refund the
 *     payment first" about money already returned;
 *   · the money list derived its own totals from the transactions and was right.
 *
 * This is the money list's answer, extracted, so the other two can share it.
 *
 * A PURE FUNCTION over rows the caller has already fetched. It performs no
 * queries: the callers have different reasons to be reading transactions
 * already, and a helper that fetched its own would double every call.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/bookingPaymentState
 */

export interface BookingPaymentRow {
  amount: number | string;
  refunded_amount?: number | string | null;
  /** `succeeded` and `refunded` both mean the money arrived. */
  status: string;
}

export type BookingPaymentStatus =
  /** No settled money against this booking. */
  | 'unpaid'
  /** Money arrived and none has gone back. */
  | 'paid'
  /** Some has gone back, some has not. */
  | 'partially_refunded'
  /** Everything collected has been returned. */
  | 'refunded';

export interface BookingPaymentState {
  /** Everything that ever settled, refunds included. */
  collected: number;
  /** Everything given back. */
  refunded: number;
  /** What the business is still holding. */
  netHeld: number;
  status: BookingPaymentStatus;
}

/** Both are money that arrived; only one of them still is. */
const SETTLED = new Set(['succeeded', 'refunded']);

/**
 * Rounded to the cent because these are sums of decimals.
 *
 * Without it `200 - 66.67 - 66.67 - 66.66` leaves 0.000000000004 and the booking
 * reads `partially_refunded` forever — the exact shape of bug that makes a fully
 * refunded plan undeletable.
 */
const cents = (value: number) => Math.round(value * 100) / 100;

export function bookingPaymentState(rows: BookingPaymentRow[]): BookingPaymentState {
  let collected = 0;
  let refunded = 0;

  for (const row of rows) {
    if (!SETTLED.has(row.status)) continue;
    collected += Number(row.amount) || 0;
    refunded += Number(row.refunded_amount ?? 0) || 0;
  }

  collected = cents(collected);
  refunded = cents(refunded);
  const netHeld = cents(collected - refunded);

  if (collected <= 0) return { collected: 0, refunded: 0, netHeld: 0, status: 'unpaid' };
  if (refunded <= 0) return { collected, refunded, netHeld, status: 'paid' };

  /*
   * `>=` rather than `===`. A refund can exceed what this platform recorded as
   * collected — a payment refunded from the Stripe dashboard against a charge
   * whose transaction was never fully written — and treating that as "partial"
   * would leave a booking permanently unrefundable and undeletable.
   */
  return {
    collected,
    refunded,
    netHeld: Math.max(0, netHeld),
    status: refunded >= collected ? 'refunded' : 'partially_refunded',
  };
}

/**
 * Can this booking be deleted, as far as money is concerned?
 *
 * Deleting a booking that holds money orphans the record of it. Deleting one
 * whose money has all gone back is fine — nothing is owed and nothing is held.
 */
export function bookingHoldsMoney(rows: BookingPaymentRow[]): boolean {
  return bookingPaymentState(rows).netHeld > 0;
}
