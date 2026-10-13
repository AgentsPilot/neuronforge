/**
 * The money for ONE meeting of a package, read off the meeting itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * A package sold by quote hangs off a service priced 0 with `sale_mode`
 * 'proposal' — the price lives in the quote, not in the service. The drawer
 * builds every session's payment from the service, and its ladder reads:
 *
 *     quoted money  →  free service  →  service price > 0  →  nothing
 *
 * A package's SESSION falls through all four. It is not a quoted job:
 * `isQuotedJob` excludes anything with a `parent_booking_id`, deliberately,
 * because the quote belongs to the container and not to each meeting. So the
 * next rung catches it — `servicePrice === 0` — and it is declared FREE.
 *
 * On the reporting account the first meeting of a six-session course was
 * marked held on 13/10, which raised and emailed an invoice for ₪74.99, and
 * the client paid it the same day. The row said "took place" and nothing else:
 * no amount, no "paid", and no refund in its menu, because the menu offers one
 * only where there is money to return. The owner could watch an invoice go out
 * and never see it come back in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE A SESSION'S MONEY ACTUALLY IS
 *
 * Two places, both keyed on the session's own booking id, both already fetched
 * with the booking row:
 *
 *   · `payment_plan_installments` — written once when the quote is accepted,
 *     one row per meeting. This is what the client AGREED to pay for this
 *     meeting, and it exists from acceptance, before any invoice is raised.
 *   · `payment_invoices` — raised when the meeting is marked held. This is what
 *     the client was actually BILLED, and it carries the refund.
 *
 * The installment is preferred for the amount because it is the agreement; the
 * invoice is the authority on what happened to it. The booking's own
 * `payment_status` stays the authority on whether the money arrived, as it is
 * everywhere else in the drawer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SessionPayment } from '@/components/crm/contact-drawer/types';

/** One `payment_plan_installments` row, as the booking query embeds it. */
export interface SessionPeriod {
  amount: number | string;
  currency?: string | null;
  status: string;
  invoice_id?: string | null;
}

/** One `payment_invoices` row, as the booking query embeds it. */
export interface SessionInvoice {
  id: string;
  status: string;
  amount?: number | string | null;
  due_date: string | null;
  sent_at: string | null;
  refunded_at?: string | null;
}

export interface PackageSessionMoney {
  /** Set only on a package's session. Nothing else may take this path. */
  parentBookingId?: string | null;
  /** `scheduling_bookings.payment_status`, the authority on arrival. */
  paymentStatus?: string | null;
  paymentId?: string | null;
  /** The fallback currency: the service's, used only if nothing better exists. */
  currency: string;
  periods?: SessionPeriod[];
  invoice?: SessionInvoice | null;
  /** `refunded_total`, which covers both invoices and plan transactions. */
  refundedTotal?: number | string | null;
  paidAt?: string;
}

const money = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const arrivalOf = (status: string | null | undefined): SessionPayment['status'] => {
  if (status === 'paid') return 'paid';
  if (status === 'refunded') return 'refunded';
  return 'pending';
};

/**
 * @returns the meeting's own payment, or `null` when this booking is not a
 *          package session or carries no money of its own — in which case the
 *          caller's existing ladder decides, exactly as before.
 */
export function packageSessionPayment(input: PackageSessionMoney): SessionPayment | null {
  if (!input.parentBookingId) return null;

  const period = input.periods?.[0];
  const invoice = input.invoice ?? null;
  const settled = input.paymentStatus === 'paid' || input.paymentStatus === 'refunded';

  /*
   * ONLY WHERE THERE IS A PAYMENT FACT TO STATE.
   *
   * An invoice means this meeting has been billed; a paid or refunded status
   * means money has moved. Either way there is something true to say.
   *
   * A meeting still ahead has NEITHER: on a package billed after each meeting
   * its installment is written at acceptance, so the sum is known, but nobody
   * has been asked for it and nobody owes it yet. Printing "₪75 · awaiting
   * payment" against five future dates would invent five debts — and on a
   * package paid up front there is no per-meeting money at all, the container
   * holds the whole sum.
   */
  if (!invoice && !settled) return null;

  /*
   * What was BILLED, falling back to what was agreed. The invoice is the
   * charge the client actually received; the installment is the figure from
   * the quote, which stands in for it where an invoice is paid but its amount
   * did not come back with the row.
   */
  const amount = money(invoice?.amount) || money(period?.amount);
  if (amount <= 0) return null;

  const refunded = money(input.refundedTotal);

  return {
    id: input.paymentId || undefined,
    amount,
    currency: period?.currency || input.currency,
    /*
     * A refund is a fact about the money, not about the booking: a partial one
     * never moves `payment_status`, so the status alone would still read
     * "paid" with no sign that half of it went back. The amount carries that,
     * and the row subtracts it before offering to return any more.
     */
    status: refunded > 0 && refunded >= amount ? 'refunded' : arrivalOf(input.paymentStatus),
    paidAt: input.paidAt,
    refundedAmount: refunded || undefined,
    refundedAt: invoice?.refunded_at || undefined,
    invoicedAmount: money(invoice?.amount) || undefined,
    invoiceId: invoice?.id,
    invoiceStatus: invoice?.status as SessionPayment['invoiceStatus'],
    invoiceDueDate: invoice?.due_date || undefined,
    invoiceSentAt: invoice?.sent_at || undefined,
  };
}
