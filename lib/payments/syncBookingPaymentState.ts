/**
 * Bring a booking's `payment_status` back in line with its money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The authority for this is a DATABASE TRIGGER — `propagate_refund_to_booking`,
 * sibling of the invoice one — because a refund issued from the Stripe dashboard
 * has no request behind it and no application code to run. That is the only
 * mechanism that covers all four refund paths.
 *
 * So why does this exist?
 *
 *   1. Until the migration is applied, nothing maintains this state and a
 *      refund from the money list still leaves the booking reading `paid`.
 *   2. A route that has just refunded needs to know the resulting state in
 *      order to answer with it, and reading it back is one round trip either
 *      way.
 *
 * It computes exactly what the trigger computes, from the same rows, so running
 * both is a no-op rather than a disagreement. If the two ever drift, the trigger
 * is right — it sees refunds this code never will.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/syncBookingPaymentState
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { bookingPaymentState, type BookingPaymentState } from './bookingPaymentState';

const logger = createLogger({ module: 'SyncBookingPaymentState' });

/**
 * Every settled payment against a booking, however it is attached.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking's money hangs off it two different ways. A website or landing-page
 * sale writes `booking_id` on the transaction. An INVOICE raised for a booking
 * does not — the transaction carries `invoice_id` and the booking sits on the
 * invoice.
 *
 * Reading only the direct link made an invoice-paid booking look like it had
 * never been paid, so this function returned `unpaid` and wrote nothing. A
 * PARTIAL refund survived that by accident (the booking should stay `paid`
 * either way), but a FULL refund of an invoice-paid booking would never have
 * marked the booking refunded — and the delete guard would have gone on
 * refusing to remove it, saying "refund the payment first" about money already
 * returned.
 *
 * `propagate_refund_to_booking` gets this right in SQL with a LEFT JOIN and a
 * COALESCE. This is the same question asked from application code.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function settledForBooking(bookingId: string, userId: string) {
  const { data: invoices } = await supabaseServer
    .from('payment_invoices')
    .select('id')
    .eq('user_id', userId)
    .eq('booking_id', bookingId);

  const invoiceIds = (invoices ?? []).map(row => row.id as string);

  const queries = [
    supabaseServer
      .from('payment_transactions')
      .select('id, amount, refunded_amount, status')
      .eq('user_id', userId)
      .eq('booking_id', bookingId)
      .in('status', ['succeeded', 'refunded']),
  ];

  if (invoiceIds.length > 0) {
    queries.push(
      supabaseServer
        .from('payment_transactions')
        .select('id, amount, refunded_amount, status')
        .eq('user_id', userId)
        .in('invoice_id', invoiceIds)
        .in('status', ['succeeded', 'refunded'])
    );
  }

  const results = await Promise.all(queries);

  // Deduped on id: a transaction can carry both links, and counting it twice
  // would double the booking's collected total and make a full refund read as
  // partial forever.
  const seen = new Set<string>();
  const rows: { amount: number | string; refunded_amount?: number | string | null; status: string }[] = [];

  for (const result of results) {
    for (const row of result.data ?? []) {
      /*
       * A row with no id cannot be recognised as a duplicate, so it is kept.
       *
       * Treating `undefined` as a seen key collapsed every row after the first
       * into one — the dedup silently became "take one payment", which is the
       * exact bug this function exists to fix.
       */
      if (!row.id) {
        rows.push(row);
        continue;
      }
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }

  return rows;
}

export async function syncBookingPaymentState(
  bookingId: string,
  userId: string
): Promise<BookingPaymentState> {
  const state = bookingPaymentState(await settledForBooking(bookingId, userId));

  // Nothing settled against this booking: its status belongs to whatever put it
  // there. An invoice marked paid by hand carries no transaction, and
  // overwriting that with `pending` would lose the fact that money arrived.
  if (state.status === 'unpaid') return state;

  /*
   * Only `paid` or `refunded` are written.
   *
   * `payment_status` is read across the scheduling code as pending | paid |
   * refunded, and a fourth value would silently drop partially refunded
   * bookings out of every reader that compares against those three. A booking
   * still holding money is `paid`, which is true.
   */
  const { error } = await supabaseServer
    .from('scheduling_bookings')
    .update({
      payment_status: state.status === 'refunded' ? 'refunded' : 'paid',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('user_id', userId);

  if (error) {
    // Not fatal, and never allowed to fail a refund: the money has already
    // moved, and the trigger will settle this the next time anything touches
    // the transaction.
    logger.warn({ err: error, bookingId }, 'Could not update the booking payment status');
  }

  return state;
}

/**
 * The bookings behind a set of payments, for a refund that spanned several.
 *
 * Usually one — a booking's payments all belong to that booking — but a refund
 * issued against an invoice can reach a booking this caller never named.
 */
export async function syncBookingsForTransactions(
  transactionIds: string[],
  userId: string
): Promise<void> {
  if (transactionIds.length === 0) return;

  const { data } = await supabaseServer
    .from('payment_transactions')
    .select('booking_id, invoice_id')
    .eq('user_id', userId)
    .in('id', transactionIds);

  const bookingIds = new Set<string>();
  const invoiceIds: string[] = [];

  for (const row of data ?? []) {
    if (row.booking_id) bookingIds.add(row.booking_id);
    else if (row.invoice_id) invoiceIds.push(row.invoice_id);
  }

  // A payment can be attached to its booking through the invoice instead of
  // directly, depending on which surface sold it.
  if (invoiceIds.length > 0) {
    const { data: invoices } = await supabaseServer
      .from('payment_invoices')
      .select('booking_id')
      .eq('user_id', userId)
      .in('id', invoiceIds);

    for (const invoice of invoices ?? []) {
      if (invoice.booking_id) bookingIds.add(invoice.booking_id);
    }
  }

  for (const bookingId of bookingIds) {
    await syncBookingPaymentState(bookingId, userId);
  }
}
