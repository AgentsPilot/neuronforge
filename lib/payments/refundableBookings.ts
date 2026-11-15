/**
 * Which of a client's bookings still have money that could come back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOR THE CLIENT'S OWN PORTAL, so it answers in bookings rather than in
 * payments. A client asking for their money back is thinking "the session I
 * cancelled", not "transaction a876d569". The money behind a booking is this
 * module's problem, not theirs.
 *
 * SCOPED FROM THE TOKEN AND NOTHING ELSE. Both ids come from the booking the
 * portal has already proved the caller holds — `/api/book/manage/[token]`
 * verifies the token's email against the booking's contact before anything
 * else runs. Nothing here accepts an id from the browser, so a client cannot
 * name a booking that is not theirs.
 *
 * TWO QUERIES, NOT N+1. `resolveRefundTargets` answers one booking at a time
 * and would mean a round trip per booking on a page a client is waiting for.
 * The same two facts it uses — a transaction carries either `booking_id` or an
 * `invoice_id` whose invoice carries one — are read here in bulk instead.
 *
 * THE MATHS IS NOT REIMPLEMENTED. `remainingRefundableMinor` is the same
 * function the refund path uses, and it mirrors `refund_guard_before()` in the
 * database. A number computed any other way here would eventually disagree
 * with the one that actually governs.
 *
 * @module lib/payments/refundableBookings
 */

import { OPEN_REFUND_REQUEST_STATUSES } from '@/lib/repositories/RefundRequestRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { fromMinorUnits, remainingRefundableMinor } from './refundMath';

const logger = createLogger({ module: 'RefundableBookings' });

/** A booking the client could ask for money back on. */
export interface RefundableBooking {
  bookingId: string;
  /** The service as the client knows it. Never an id. */
  title: string;
  /** When it is or was, ISO. Null for something sold without a date. */
  startTime: string | null;
  /** Still refundable, in major units, in this booking's own currency. */
  refundable: number;
  currency: string;
  /** What they actually paid, so the client can recognise the booking. */
  paid: number;
  /**
   * When the money left their account, ISO. The client's own strongest memory
   * of a payment, and what this list is ordered by.
   */
  paidAt: string | null;
  /**
   * When they already asked about this one, ISO, or null.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * MARKED, NOT HIDDEN.
   *
   * The database refuses a second open request per booking — a partial unique
   * index, see 20261121 — so asking twice was already impossible. It just
   * failed at the END: the client picked the booking, chose an amount, typed a
   * reason, pressed send and was told no.
   *
   * Dropping the row instead would be worse. Somebody who has just asked goes
   * looking for that payment, cannot find it, and has no way to tell whether
   * their request went through or the business removed it. The row stays and
   * says what happened to it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  requestedAt: string | null;
  /**
   * The invoice they were sent, if one was raised.
   *
   * The best identifier on the row by some distance: eight bookings on this
   * account share the name "בדיקת תוכנית תשלומים", several share an amount,
   * and none shares an invoice number — which the client has already read in
   * an email from the business ("חשבונית INV-00024 על סך ₪100").
   */
  invoiceNumber: string | null;
  /**
   * How many settled payments sit behind this booking.
   *
   * More than one is ordinary — a deposit and a balance, a plan's periods —
   * and it means no caller may offer a single-click refund: which payment the
   * money comes out of is a decision, and the refund dialog is where it is
   * made. `RefundModal` already knows how to ask.
   */
  payments: number;
  /**
   * Every one of those payments can be refunded through the processor.
   *
   * False means at least part of this has to be returned by hand — a bank
   * transfer, cash — and the platform only RECORDS that it happened. The
   * button must then say so ("mark as returned", not "refund"), and the
   * client must not be told money is on its way back when somebody still has
   * to send it.
   */
  viaProcessor: boolean;
}

/** Statuses that mean money arrived. `refunded` is included because a partly
 *  refunded payment still has a remainder. */
const SETTLED = ['succeeded', 'refunded'];

/** The embedded service name, however PostgREST chose to shape it. */
function serviceName(d?: {
  service?: { service_name?: string | null } | Array<{ service_name?: string | null }> | null;
}): string {
  const s = d?.service;
  if (!s) return '';
  const one = Array.isArray(s) ? s[0] : s;
  return one?.service_name ?? '';
}

export async function refundableBookingsFor(params: {
  userId: string;
  contactId: string;
}): Promise<RefundableBooking[]> {
  const { userId, contactId } = params;
  if (!contactId) return [];

  /* Every payment this client has made to this business. One query. */
  const { data: txs, error } = await supabaseServer
    .from('payment_transactions')
    .select('id, amount, refunded_amount, currency, status, booking_id, invoice_id, paid_at, stripe_payment_intent_id, stripe_charge_id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .in('status', SETTLED);

  if (error) {
    /* The portal still renders; the client simply is not offered the form.
       Refusing to show a page because one panel failed is the worse answer. */
    logger.error({ err: error, contactId }, 'Could not read this client payments');
    return [];
  }

  const rows = txs ?? [];
  if (rows.length === 0) return [];

  /*
   * The invoice hop.
   *
   * A website sale writes `booking_id` straight onto the transaction. An
   * INVOICE raised for a booking does not — the transaction carries
   * `invoice_id` and the booking sits on the invoice. Matching only
   * `booking_id` is the bug `resolveRefundTargets` documents: it reported "no
   * settled payment" for every invoice-paid booking.
   */
  const invoiceIds = [
    ...new Set(
      rows.map(r => (r as { invoice_id?: string | null }).invoice_id).filter(Boolean) as string[]
    ),
  ];

  const bookingOfInvoice = new Map<string, string>();

  const numberOfInvoice = new Map<string, string>();

  if (invoiceIds.length > 0) {
    const { data: invoices, error: invoiceError } = await supabaseServer
      .from('payment_invoices')
      .select('id, booking_id, invoice_number')
      .eq('user_id', userId)
      .in('id', invoiceIds);

    if (invoiceError) {
      logger.error({ err: invoiceError, contactId }, 'Could not read the invoices behind these payments');
    }

    for (const inv of invoices ?? []) {
      const r = inv as { id: string; booking_id?: string | null; invoice_number?: string | null };
      if (r.booking_id) bookingOfInvoice.set(r.id, r.booking_id);
      if (r.invoice_number) numberOfInvoice.set(r.id, r.invoice_number);
    }
  }

  /* Sum what remains, per booking. */
  const byBooking = new Map<
    string,
    {
      minor: number;
      paid: number;
      currency: string;
      paidAt: string | null;
      invoiceNumber: string | null;
      /* How many settled payments answer to this booking, and whether every
         one of them can be reached through the processor. See the interface. */
      payments: number;
      viaProcessor: boolean;
    }
  >();

  for (const row of rows) {
    const tx = row as {
      amount: number;
      refunded_amount?: number | null;
      currency: string;
      booking_id?: string | null;
      invoice_id?: string | null;
      paid_at?: string | null;
      stripe_payment_intent_id?: string | null;
      stripe_charge_id?: string | null;
    };

    const bookingId =
      tx.booking_id ?? (tx.invoice_id ? bookingOfInvoice.get(tx.invoice_id) : undefined);

    /* Money with no booking behind it — a loose invoice, a product. It is
       refundable, but this list answers in bookings and has nothing to call
       it. The owner's own dialog still reaches it. */
    if (!bookingId) continue;

    const remaining = remainingRefundableMinor(
      Number(tx.amount ?? 0),
      Number(tx.refunded_amount ?? 0),
      tx.currency
    );

    const seen = byBooking.get(bookingId);
    /*
     * One currency per booking, which the database already guarantees: the
     * refund trigger refuses a refund in any currency but the payment's own,
     * so two payments on one booking cannot disagree. Taking the first is
     * therefore safe, and summing across currencies — which CLAUDE.md forbids
     * outright — cannot arise.
     */
    const invoiceNumber = tx.invoice_id ? (numberOfInvoice.get(tx.invoice_id) ?? null) : null;
    const paidAt = tx.paid_at ?? null;

    /*
     * CAN THIS MONEY GO BACK THE WAY IT CAME?
     *
     * The same test `RefundService` makes before it calls Stripe: a payment
     * with neither a payment intent nor a charge was never through a
     * processor, so a refund is the business returning it by hand and the
     * platform RECORDING that — which is a different sentence on a button and
     * a different promise to the client.
     *
     * ANDed across the booking's payments: if any part of it has to be
     * returned by hand, the whole thing cannot be presented as automatic.
     */
    const txViaProcessor = Boolean(tx.stripe_payment_intent_id || tx.stripe_charge_id);

    byBooking.set(bookingId, {
      minor: (seen?.minor ?? 0) + remaining,
      paid: (seen?.paid ?? 0) + Number(tx.amount ?? 0),
      currency: seen?.currency ?? tx.currency,
      /* The most recent payment on this booking: what the client remembers
         doing, and what the list is ordered by. */
      paidAt:
        seen?.paidAt && paidAt ? (seen.paidAt > paidAt ? seen.paidAt : paidAt) : (paidAt ?? seen?.paidAt ?? null),
      /* The first invoice number found. A booking billed in stages has
         several; naming one the client has actually seen beats naming none. */
      invoiceNumber: seen?.invoiceNumber ?? invoiceNumber,
      payments: (seen?.payments ?? 0) + 1,
      viaProcessor: (seen?.viaProcessor ?? true) && txViaProcessor,
    });
  }

  const withMoney = [...byBooking.entries()].filter(([, v]) => v.minor > 0);
  if (withMoney.length === 0) return [];

  /* And what to call them. */
  /*
   * THE NAME IS NOT ON THIS TABLE, and is not called what it looks like.
   *
   * `scheduling_bookings` carries `service_id`; the words live on
   * `scheduling_services`, and the column there is `service_name`, not `name`.
   * Both mistakes were made writing this, and both failed the same way: naming
   * a column that is not there makes PostgREST reject the WHOLE select, so the
   * titles AND the dates came back empty and read as "these bookings have no
   * date" rather than as a failed query. Checked against the live table
   * (CLAUDE.md § Supabase Patterns).
   */
  const { data: bookings, error: bookingError } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, start_time, status, service:scheduling_services(service_name)')
    .eq('user_id', userId)
    .in('id', withMoney.map(([id]) => id));

  /* Logged, not swallowed. The first version ignored this, so a rejected
     select rendered as "these bookings have no date" — a wrong answer that
     looked like data rather than like a failure. */
  if (bookingError) {
    logger.error({ err: bookingError, contactId }, 'Could not name this client bookings');
  }

  type BookingDetail = {
    id: string;
    start_time?: string | null;
    /* PostgREST returns an embed as an object, or an array when it cannot
       prove the relationship is to-one. Both are handled rather than assumed. */
    service?: { service_name?: string | null } | Array<{ service_name?: string | null }> | null;
  };

  /*
   * Anything already asked about, by the SAME predicate the unique index uses.
   *
   * `('submitted', 'awaiting_owner')` is copied from
   * `idx_refund_requests_one_open_per_booking` deliberately. If the two ever
   * disagree the client is shown a row they can select and the insert then
   * refuses it — which is the exact failure this exists to remove.
   */
  const { data: openRequests, error: requestError } = await supabaseServer
    .from('refund_requests')
    .select('booking_id, created_at')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .in('status', OPEN_REFUND_REQUEST_STATUSES as unknown as string[])
    .not('booking_id', 'is', null);

  if (requestError) {
    /* Logged, not swallowed: unseen, every row would offer itself again and
       the refusal would move back to the end of the form. */
    logger.error({ err: requestError, contactId }, 'Could not read open refund requests');
  }

  const askedAt = new Map<string, string>(
    (openRequests ?? []).map(r => {
      const row = r as { booking_id: string; created_at: string };
      return [row.booking_id, row.created_at] as const;
    })
  );

  const detail = new Map<string, BookingDetail>(
    (bookings ?? []).map(b => {
      const r = b as BookingDetail;
      return [r.id, r] as const;
    })
  );

  return withMoney
    .map(([bookingId, money]) => {
      const d = detail.get(bookingId);
      return {
        bookingId,
        title: serviceName(d),
        startTime: d?.start_time ?? null,
        refundable: fromMinorUnits(money.minor, money.currency),
        currency: money.currency,
        paid: money.paid,
        paidAt: money.paidAt,
        requestedAt: askedAt.get(bookingId) ?? null,
        invoiceNumber: money.invoiceNumber,
        payments: money.payments,
        viaProcessor: money.viaProcessor,
      };
    })
    /*
     * BY WHEN THEY PAID, not when the booking is.
     *
     * Sorting on `start_time` buried every dateless booking at the bottom —
     * a package container, anything sold from a quote — and on the live
     * account those are most of them, including the payment plan a client is
     * most likely to be asking about. Somebody wanting money back is thinking
     * of the payment they made, so that is the order.
     */
    .sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''));
}
