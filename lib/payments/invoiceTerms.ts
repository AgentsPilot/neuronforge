/**
 * The payment terms an invoice was written under, where code needs to know.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE
 *
 * A booking's invoice is due on the day of the appointment — that is its whole
 * rule, and the words are written onto the invoice for the client to read. The
 * overdue chase has to recognise that rule to know when NOT to chase.
 *
 * It cannot live beside the code that writes it: `BookingLifecycleService`
 * already imports `PaymentReminderService`, so the reader importing the writer
 * would close a cycle. And it must not be typed out twice — a string agreed in
 * two files is a string that disagrees in two files, which this codebase has
 * already been bitten by once, when a cancellation reason was spelled one way
 * by the route that wrote it and another by the query that looked for it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/invoiceTerms
 */

/**
 * An invoice raised for a booking, payable on the day the service happens.
 *
 * Written onto the invoice by `BookingLifecycleService` and read by the overdue
 * scan. Anything else — `due_on_receipt`, or the N-day terms a quote carries —
 * is a deadline the client actually agreed to, and is chased on its own date
 * whatever the appointment is doing.
 */
export const SERVICE_DATE_TERMS = 'Due on service date';

/** An invoice whose deadline IS the appointment, rather than an agreed date. */
export function isServiceDateInvoice(invoice: {
  booking_id?: string | null;
  payment_terms?: string | null;
}): boolean {
  return Boolean(invoice.booking_id) && invoice.payment_terms === SERVICE_DATE_TERMS;
}

/**
 * Should this overdue invoice be left alone because its session has not
 * happened yet?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Moving an appointment does not move its invoice, so a session pushed from
 * October to November leaves a bill dated October — overdue the next day, and
 * the client chased for a session a month away.
 *
 * The date is deliberately not moved to fix that: a client can reschedule from
 * their own link, with no limit, so a deadline that followed the appointment
 * would let anyone defer their own bill indefinitely. Holding the CHASE instead
 * fixes the harm and leaves the agreed date alone.
 *
 * Narrow on purpose. Only the service-date rule qualifies; `due_on_receipt` and
 * a quote's N-day terms are deadlines the client agreed to, and are chased on
 * their own date whatever the appointment is doing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function waitsForItsSession(
  invoice: { booking_id?: string | null; payment_terms?: string | null },
  bookingsStillAhead: Set<string>
): boolean {
  return isServiceDateInvoice(invoice) && bookingsStillAhead.has(invoice.booking_id as string);
}
